import { useEffect, useRef, useState, type ReactNode } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { WagmiProvider, useSetActiveWallet } from "@privy-io/wagmi";
import { WagmiProvider as PlainWagmiProvider, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { base } from "wagmi/chains";
import { wagmiConfig, PRIVY_APP_ID } from "@/lib/wagmi";

import { CONNECT_EVENT, requestConnect } from "@/lib/connect-bridge";
import { lookupPovUser } from "@/lib/pov-user.functions";
import { getWalletLink } from "@/lib/wallet-link.functions";
import { readLocalLink } from "@/lib/wallet-link";

// Isolated query client for wagmi to avoid interfering with the app's router-level client.
const wagmiQueryClient = new QueryClient();

/**
 * Privy owns the connect experience (modal, mobile deep-links, session restore)
 * and feeds the connected wallet into wagmi, so every existing `useAccount` /
 * `useSignMessage` / `useSendTransaction` call site keeps working unchanged.
 */
export function WalletProviders({ children }: { children: ReactNode }) {
  // Until a Privy app id is configured, keep the app fully renderable: wagmi
  // still provides read-only context, connect surfaces just have nothing to open.
  if (!PRIVY_APP_ID) {
    return (
      <QueryClientProvider client={wagmiQueryClient}>
        <PlainWagmiProvider config={wagmiConfig}>{children}</PlainWagmiProvider>
      </QueryClientProvider>
    );
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#5b8cff",
          walletList: [
            "coinbase_wallet",
            "metamask",
            "rainbow",
            "wallet_connect",
            "detected_wallets",
          ],
          walletChainType: "ethereum-only",
        },
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      <QueryClientProvider client={wagmiQueryClient}>
        <WagmiProvider config={wagmiConfig}>
          {children}
          <ActiveWalletSync />
          <PovOnConnect />
          <ConnectBridge />
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}


/** Opening the wallet modal from anywhere goes through the connect bridge event. */
function ConnectBridge() {
  const { ready, authenticated, login } = usePrivy();
  useEffect(() => {
    const onOpen = () => {
      if (!ready || authenticated) return;
      login();
    };
    window.addEventListener(CONNECT_EVENT, onOpen);
    return () => window.removeEventListener(CONNECT_EVENT, onOpen);
  }, [ready, authenticated, login]);
  return null;
}

/** Mirror Privy's connected wallet into wagmi so hooks see an account. */
function ActiveWalletSync() {
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const first = wallets[0];
  useEffect(() => {
    if (first) void setActiveWallet(first).catch(() => null);
  }, [first, setActiveWallet]);
  return null;
}

/**
 * When a wallet connects, look up the POV profile and focus the home feed on
 * that wallet (the "You" panel). Runs once per new address per session.
 */
function PovOnConnect() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) return;
    if (handled.current === address) return;
    handled.current = address;
    // Redirect at most once per address per tab, so Back isn't trapped.
    const key = `conviction:auto-nav:${address.toLowerCase()}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      /* storage unavailable — fall through and navigate once */
    }
    void lookupPovUser({ data: { wallet: address } }).catch(() => null);
    void (async () => {
      const local = readLocalLink(address);
      const linked =
        local ??
        (await getWalletLink({ data: { wallet: address.toLowerCase() } })
          .then((r) => r.linked)
          .catch(() => null));
      void navigate({
        to: "/",
        search: (prev: { wallet?: string; m?: number; p?: string; dna?: boolean }) => ({
          ...prev,
          wallet: linked ?? address,
        }),
        replace: true,
      });
    })();
  }, [address, isConnected, navigate]);

  return null;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Stable hook identity: the branch below is a module constant, never changes. */
function usePrivyLogout() {
  return usePrivy().logout;
}


/**
 * Client-only, dependency-light connect control. Opening the wallet modal goes
 * through the connect bridge so every account surface opens the same picker.
 */
export function WalletConnectButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { address, isConnected } = useAccount();
  // usePrivy() throws outside a PrivyProvider, so only read it when one exists.
  const logout = PRIVY_APP_ID ? usePrivyLogout() : () => {};


  const cls =
    "rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent";

  if (!mounted) {
    return (
      <button type="button" disabled className={`${cls} text-muted-foreground`}>
        Connect wallet
      </button>
    );
  }
  if (isConnected && address) {
    return (
      <button type="button" className={cls} onClick={() => void logout()} title="Disconnect">
        {short(address)}
      </button>
    );
  }
  return (
    <button type="button" className={cls} onClick={() => requestConnect()}>
      Connect wallet
    </button>
  );
}
