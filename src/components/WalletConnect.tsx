import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { WagmiProvider, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { wagmiConfig, walletProvider } from "@/lib/wagmi";
import { requestConnect, requestDisconnect } from "@/lib/connect-bridge";

// Isolated query client for wagmi to avoid interfering with the app's router-level client.
const wagmiQueryClient = new QueryClient();

/** Secondary provider — never in the eager bundle. */
const PrivyStack = lazy(() => import("@/components/wallet/PrivyStack"));
/** Connect modal + wallet artwork — its own chunk, mounted after first paint. */
const RainbowKitLayer = lazy(() => import("@/components/wallet/RainbowKitLayer"));

/**
 * PRIMARY: wagmi + RainbowKit. wagmi itself wraps the app (every `useAccount` /
 * `useSignMessage` call site depends on it), but the RainbowKit UI layer mounts
 * alongside the app rather than above it, so the connect modal, wallet artwork
 * and its stylesheet never sit on the first-paint path. Privy remains available
 * as a secondary provider.
 */
export function WalletProviders({ children }: { children: ReactNode }) {
  // SSR and first paint always render the RainbowKit stack; if this browser
  // opted into Privy we swap after mount (Privy is browser-only anyway).
  const [provider, setProvider] = useState<"rainbowkit" | "privy">("rainbowkit");
  const [walletUi, setWalletUi] = useState(false);
  useEffect(() => setProvider(walletProvider()), []);
  useEffect(() => setWalletUi(true), []);

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
        {children}
        {walletUi && (
          <Suspense fallback={null}>
            <RainbowKitLayer />
          </Suspense>
        )}
      </WagmiProvider>
    </QueryClientProvider>
  );
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
