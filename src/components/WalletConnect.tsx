import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { WagmiProvider, useAccount, useDisconnect } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, useConnectModal } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

import { wagmiConfig, walletProvider } from "@/lib/wagmi";
import { CONNECT_EVENT, DISCONNECT_EVENT, requestConnect, requestDisconnect } from "@/lib/connect-bridge";
import { PovOnConnect } from "@/components/wallet/PovOnConnect";

// Isolated query client for wagmi to avoid interfering with the app's router-level client.
const wagmiQueryClient = new QueryClient();

/** Secondary provider — never in the eager bundle. */
const PrivyStack = lazy(() => import("@/components/wallet/PrivyStack"));

/**
 * PRIMARY: wagmi + RainbowKit. It owns the connect modal, wallet detection and
 * mobile deep-links for Coinbase Wallet and MetaMask, and feeds the connected
 * account into wagmi so every `useAccount` / `useSignMessage` call site keeps
 * working unchanged. Privy remains available as a secondary provider.
 */
export function WalletProviders({ children }: { children: ReactNode }) {
  // SSR and first paint always render the RainbowKit stack; if this browser
  // opted into Privy we swap after mount (Privy is browser-only anyway).
  const [provider, setProvider] = useState<"rainbowkit" | "privy">("rainbowkit");
  useEffect(() => setProvider(walletProvider()), []);

  if (provider === "privy") {
    return (
      <QueryClientProvider client={wagmiQueryClient}>
        <Suspense fallback={null}>
          <PrivyStack>{children}</PrivyStack>
        </Suspense>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={wagmiQueryClient}>
      <WagmiProvider config={wagmiConfig}>
        <RainbowKitProvider
          modalSize="compact"
          theme={darkTheme({ accentColor: "#5b8cff", borderRadius: "medium" })}
        >
          {children}
          <PovOnConnect />
          <RainbowKitBridge />
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}

/**
 * Single owner of session changes for the RainbowKit path: any surface can ask
 * for connect / sign out through the bridge events without importing wallet UI.
 */
function RainbowKitBridge() {
  const { openConnectModal } = useConnectModal();
  const { isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  useEffect(() => {
    const onOpen = () => {
      if (isConnected) return;
      openConnectModal?.();
    };
    const onOut = () => {
      try {
        disconnect();
      } catch {
        /* already disconnected */
      }
    };
    window.addEventListener(CONNECT_EVENT, onOpen);
    window.addEventListener(DISCONNECT_EVENT, onOut);
    return () => {
      window.removeEventListener(CONNECT_EVENT, onOpen);
      window.removeEventListener(DISCONNECT_EVENT, onOut);
    };
  }, [openConnectModal, isConnected, disconnect]);

  return null;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Client-only, dependency-light connect control. Connect and sign out both go
 * through the bridge so whichever provider is mounted stays in sync.
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
