import { Suspense, useEffect, useState, type ReactNode } from "react";
import { lazyRetry } from "@/lib/lazy-retry";
import { WagmiProvider, useAccount, useReconnect } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Config } from "wagmi";

import { wagmiConfig, loadWalletConfig, walletIntent } from "@/lib/wagmi";
import {
  requestConnect,
  requestDisconnect,
  hasConnectIntent,
  CONNECT_EVENT,
} from "@/lib/connect-bridge";

// Isolated query client for wagmi to avoid interfering with the app's router-level client.
const wagmiQueryClient = new QueryClient();

/** Connect modal + wallet artwork — its own chunk, mounted after first paint. */
const RainbowKitLayer = lazyRetry(() => import("@/components/wallet/RainbowKitLayer"));

/**
 * RECONNECT WITHOUT REMOUNTING.
 *
 * wagmi's `Hydrate` runs its reconnect pass in a `useEffect` with `[]` deps —
 * mount only. Swapping the config prop therefore updates every `useAccount`
 * but never re-attempts a session restore, and the previous fix for that was a
 * `key` on `WagmiProvider`.
 *
 * That key unmounted and remounted THE ENTIRE APPLICATION about 200ms after
 * first paint, because `children` here is the whole tree. Every component's
 * state reset, every effect re-ran, every query observer re-subscribed, and
 * anything with a mount guard flashed back to its pre-mounted appearance —
 * paid by every visitor on every cold load, whether or not they ever connect.
 *
 * A one-line mutation does what the remount was faking.
 */
function ReconnectOnConnectors({ ready }: { ready: boolean }) {
  const { reconnect } = useReconnect();
  useEffect(() => {
    if (!ready) return;
    // GATED ON INTENT, not on readiness. This effect used to fire on every load,
    // waking the wallet session of every visitor before they had asked for
    // anything. See connect-bridge#hasConnectIntent: a session is restored only
    // once the reader does something that needs one.
    if (hasConnectIntent()) {
      reconnect();
      return;
    }
    const onIntent = () => reconnect();
    window.addEventListener(CONNECT_EVENT, onIntent);
    return () => window.removeEventListener(CONNECT_EVENT, onIntent);
  }, [ready, reconnect]);
  return null;
}

/**
 * wagmi wraps the app (every `useAccount` / `useSignMessage` call site depends
 * on it), but boots with a connector-free config so no wallet SDK is on the
 * first-paint path. The real connectors and RainbowKit are loaded only after a
 * reader explicitly asks to connect; browsing never downloads the wallet stack.
 *
 * The swap is now invisible: the provider is never re-keyed, so the tree below
 * it survives, and the session restore happens through wagmi's own action.
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
    // An intent may have landed before this effect attached (for example a very
    // early tap during hydration). Otherwise remain completely dormant.
    if (hasConnectIntent()) boot();
    window.addEventListener(CONNECT_EVENT, boot);
    return () => {
      cancelled = true;
      window.removeEventListener(CONNECT_EVENT, boot);
    };
  }, []);

  return (
    <QueryClientProvider client={wagmiQueryClient}>
      <WagmiProvider config={config}>
        <ReconnectOnConnectors ready={config !== wagmiConfig} />
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
      <button
        type="button"
        className={cls}
        {...walletIntent}
        onClick={() => requestDisconnect()}
        title="Sign out"
      >
        {short(address)}
      </button>
    );
  }
  return (
    <button type="button" className={cls} {...walletIntent} onClick={() => requestConnect()}>
      Connect wallet
    </button>
  );
}
