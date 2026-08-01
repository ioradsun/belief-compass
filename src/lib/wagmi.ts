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
export async function loadWalletConfig(): Promise<Config> {
  const { browserConnectors } = await import("@/lib/wallet-connectors");
  return createConfig({
    chains: [base],
    transports: { [base.id]: http() },
    connectors: browserConnectors(),
    ssr: true,
  });
}

/** True on phone/tablet web browsers. */
export function isMobileWeb(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1; // iPadOS
  return /Android|iPhone|iPod|iPad/i.test(ua) || touchMac;
}
