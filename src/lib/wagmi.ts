import { base } from "wagmi/chains";
import { createConfig, http, type Config } from "wagmi";

/**
 * Wallet stack: wagmi + RainbowKit.
 *
 * Startup cost matters more than instant connect readiness: almost nobody
 * connects in the first second, but every visitor pays for whatever the wallet
 * SDKs cost at boot. So the eagerly-imported config declares NO connectors —
 * the connector graph (Coinbase / MetaMask / WalletConnect) is imported and
 * constructed only after first paint, together with the RainbowKit UI layer.
 */
export const wagmiConfig = createConfig({
  chains: [base],
  transports: { [base.id]: http() },
  connectors: [],
  ssr: true,
});

/** Build the browser config with real connectors. Client-only, post-paint. */
let configPromise: Promise<Config> | null = null;

export async function loadWalletConfig(): Promise<Config> {
  configPromise ??= (async () => {
    const { browserConnectors } = await import("@/lib/wallet-connectors");
    return createConfig({
      chains: [base],
      transports: { [base.id]: http() },
      connectors: browserConnectors(),
      ssr: true,
    });
  })();
  return configPromise;
}

/**
 * Intent warming. Idle-boot already pulls the wallet stack in the background,
 * but a visitor who hovers "Connect wallet" or reaches the decision dock is
 * about to need it NOW — start the connector + modal chunks on that signal so
 * the click never waits on a download. Safe to call repeatedly: both the config
 * promise and the dynamic import are de-duplicated.
 */
export function warmWallet(): void {
  if (typeof window === "undefined") return;
  void loadWalletConfig();
  void import("@/components/wallet/RainbowKitLayer");
}

/** Handlers to spread onto any element that precedes a wallet interaction. */
export const walletIntent = {
  onPointerEnter: warmWallet,
  onFocus: warmWallet,
  onTouchStart: warmWallet,
} as const;

/** True on phone/tablet web browsers. */
export function isMobileWeb(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1; // iPadOS
  return /Android|iPhone|iPod|iPad/i.test(ua) || touchMac;
}
