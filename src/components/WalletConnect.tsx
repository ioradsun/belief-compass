import { useEffect, useRef, useState, type ReactNode } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { WagmiProvider, useSetActiveWallet } from "@privy-io/wagmi";
import { WagmiProvider as PlainWagmiProvider, useAccount, useDisconnect } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { base } from "wagmi/chains";
import { wagmiConfig, PRIVY_APP_ID } from "@/lib/wagmi";

import { CONNECT_EVENT, DISCONNECT_EVENT, requestConnect, requestDisconnect } from "@/lib/connect-bridge";
import { lookupPovUser } from "@/lib/pov-user.functions";
import { getWalletLink } from "@/lib/wallet-link.functions";
import { readLocalLink } from "@/lib/wallet-link";

/**
 * Privy's wagmi provider mounts PrivyWagmiConnector, which calls Privy hooks that
 * are browser-only and throw during SSR. On the server we use plain wagmi (same
 * context, renders no extra DOM), and the Privy-aware one in the browser.
 */
const Wagmi = typeof document === "undefined" ? PlainWagmiProvider : WagmiProvider;

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
        <Wagmi config={wagmiConfig}>
          {children}
          <ActiveWalletSync />
          <PovOnConnect />
          <ConnectBridge />
        </Wagmi>
      </QueryClientProvider>
    </PrivyProvider>
  );
}


/**
 * Single owner of session changes. Connect and sign out both go through here so
 * Privy (which holds the real session) and wagmi never drift apart — signing out
 * of wagmi alone used to leave Privy authenticated, after which "Connect wallet"
 * silently did nothing.
 */
function ConnectBridge() {
  const { ready, authenticated, login, logout, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const { disconnect } = useDisconnect();
  const hasWallet = wallets.length > 0;
  const wanted = useRef(false);

  useEffect(() => {
    const onOpen = () => {
      if (!ready) {
        wanted.current = true; // retry as soon as Privy finishes booting
        return;
      }
      if (!authenticated) return void login();
      if (!hasWallet) return void connectWallet();
      // Authenticated with a wallet already: nothing to open.
    };
    const onOut = () => {
      wanted.current = false;
      try {
        disconnect();
      } catch {
        /* wagmi may already be disconnected */
      }
      void logout().catch(() => null);
    };
    window.addEventListener(CONNECT_EVENT, onOpen);
    window.addEventListener(DISCONNECT_EVENT, onOut);
    return () => {
      window.removeEventListener(CONNECT_EVENT, onOpen);
      window.removeEventListener(DISCONNECT_EVENT, onOut);
    };
  }, [ready, authenticated, hasWallet, login, logout, connectWallet, disconnect]);

  // A click that landed before Privy was ready still opens the modal.
  useEffect(() => {
    if (!ready || !wanted.current) return;
    wanted.current = false;
    if (!authenticated) void login();
    else if (!hasWallet) void connectWallet();
  }, [ready, authenticated, hasWallet, login, connectWallet]);

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

/**
 * Client-only, dependency-light connect control. Connect and sign out both go
 * through the bridge so Privy and wagmi stay in sync.
 */
export function WalletConnectButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { address, isConnected } = useAccount();



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
      <button type="button" className={cls} onClick={() => requestDisconnect()} title="Sign out">
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
