import { base } from "wagmi/chains";
import { createConfig, http, type CreateConnectorFn } from "wagmi";

const projectId =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ??
  "3fbb6bba6f1de962d911bb5b5c9dd651";

/**
 * `wagmi/connectors` is imported DYNAMICALLY everywhere in this file — never at
 * module scope. Two reasons:
 *  1. Server safety: the connectors bundle must never be evaluated during SSR.
 *     It pulls in Coinbase/WalletConnect/porto SDKs, which the worker bundler
 *     mis-chunks (`ReferenceError: init_call is not defined` → every page 500s).
 *  2. First-load perf: the heavy Coinbase (~720KB) and WalletConnect (~360KB)
 *     SDKs only load when the viewer picks that wallet.
 * EIP-6963 discovery (on by default) still surfaces every installed browser
 * extension wallet; `ensureInjectedConnector()` adds the generic injected
 * connector on the client for wallets that don't announce themselves.
 */
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [],
  multiInjectedProviderDiscovery: true,
  transports: { [base.id]: http() },
  ssr: true,
});

/** wagmi connector ids for the lazily-loaded wallets (stored as recentConnectorId). */
export const LAZY_COINBASE_ID = "coinbaseWalletSDK";
export const LAZY_WALLETCONNECT_ID = "walletConnect";

export type LazyWalletKind = "coinbase" | "walletConnect";

/** True on phone/tablet web browsers (not the in-app Coinbase browser). */
export function isMobileWeb(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1; // iPadOS
  return /Android|iPhone|iPod|iPad/i.test(ua) || touchMac;
}

/**
 * Mobile-web Coinbase path. The Coinbase SDK's WalletLink relay opens the app
 * but frequently never hands a session back to iOS Safari — the app just opens.
 * WalletConnect v2 + Coinbase's universal link is the flow Coinbase itself
 * supports on mobile web: the app opens *with the pairing URI*, approves, and
 * returns an active session. `showQrModal: false` because we do the deep-link.
 */
export async function coinbaseMobileConnector(): Promise<CreateConnectorFn> {
  const { walletConnect } = await import("wagmi/connectors");
  return walletConnect({ projectId, showQrModal: false });
}

/** Universal link — opens the Coinbase app, or an install page if it's absent. */
export function coinbaseDeepLink(wcUri: string): string {
  return `https://go.cb-w.com/wc?uri=${encodeURIComponent(wcUri)}`;
}


/**
 * Client-only: register the generic injected connector once, after hydration.
 * Keeps `wagmi/connectors` out of the SSR module graph.
 */
let injectedAdded = false;
export async function ensureInjectedConnector(): Promise<void> {
  if (typeof window === "undefined" || injectedAdded) return;
  injectedAdded = true;
  try {
    const { injected } = await import("wagmi/connectors");
    const internal = wagmiConfig._internal.connectors;
    const connector = internal.setup(injected());
    internal.setState((prev) =>
      prev.some((c) => c.id === connector.id) ? prev : [...prev, connector],
    );
  } catch {
    /* discovery-based connectors still work */
  }
}


/** Dynamically import a heavy connector's SDK and return its CreateConnectorFn. */
export async function lazyConnector(kind: LazyWalletKind): Promise<CreateConnectorFn> {
  const { coinbaseWallet, walletConnect } = await import("wagmi/connectors");
  return kind === "coinbase"
    ? coinbaseWallet({ appName: "Conviction", preference: "all" })
    : // showQrModal must stay TRUE: without a modal of our own, a false here means
      // mobile users get no QR and no wallet deep-link list — the tap does nothing.
      walletConnect({ projectId, showQrModal: true });
}

/**
 * Warm the connector bundle ahead of the tap. On mobile, Coinbase's SDK opens a
 * popup/deep-link that only survives if it happens inside the user gesture — an
 * await on a ~720KB dynamic import breaks that chain and the browser blocks it.
 * Prefetching on modal open makes the later `lazyConnector` call resolve instantly.
 */
export function prefetchWalletSdks(): void {
  void import("wagmi/connectors").catch(() => null);
}

