import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { WagmiProvider, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Config } from "wagmi";

import { wagmiConfig, loadWalletConfig } from "@/lib/wagmi";
import { requestConnect, requestDisconnect } from "@/lib/connect-bridge";

// Isolated query client for wagmi to avoid interfering with the app's router-level client.
const wagmiQueryClient = new QueryClient();

/** Connect modal + wallet artwork — its own chunk, mounted after first paint. */
const RainbowKitLayer = lazy(() => import("@/components/wallet/RainbowKitLayer"));

/**
 * wagmi wraps the app (every `useAccount` / `useSignMessage` call site depends
 * on it), but boots with a connector-free config so no wallet SDK is on the
 * first-paint path. Once the browser is idle we swap in the real connectors and
 * mount the RainbowKit UI layer, both from lazily imported chunks.
 */
export function WalletProviders({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config>(wagmiConfig);
  const [walletUi, setWalletUi] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const boot = () => {
      void loadWalletConfig().then((full) => {
        if (cancelled) return;
        setConfig(full);
        setWalletUi(true);
      });
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    const id = ric ? ric(boot) : window.setTimeout(boot, 200);
    return () => {
      cancelled = true;
      if (!ric) window.clearTimeout(id as number);
    };
  }, []);

  return (
    <QueryClientProvider client={wagmiQueryClient}>
      {/* keyed so wagmi re-runs its reconnect pass once real connectors exist */}
      <WagmiProvider key={config === wagmiConfig ? "boot" : "full"} config={config}>
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
 * through the bridge so the mounted wallet layer stays in sync.
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
