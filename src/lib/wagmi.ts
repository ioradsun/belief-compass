import { base } from "wagmi/chains";
import { createConfig, http } from "wagmi";
import { browserConnectors } from "@/lib/wallet-connectors";

/**
 * Primary wallet stack: wagmi + RainbowKit (Coinbase Wallet / Smart Wallet and
 * MetaMask are first-class there, on desktop and mobile). Privy stays available
 * as a secondary provider — see `WALLET_PROVIDER` below — but is lazy-loaded so
 * its very large dependency graph never touches the first paint.
 *
 * Connectors are constructed in the browser only: `wagmi/connectors` is stubbed
 * outside the client build because that vendor graph breaks the worker bundle.
 */
export const wagmiConfig = createConfig({
  chains: [base],
  transports: { [base.id]: http() },
  connectors: typeof window === "undefined" ? [] : browserConnectors(),
  ssr: true,
});

/** Privy app id — a public identifier, safe in the client bundle. */
export const PRIVY_APP_ID =
  (import.meta.env.VITE_PRIVY_APP_ID as string | undefined) ?? "cms7jy9fm00b70ci4uj19bvb5";

const PROVIDER_KEY = "conviction:wallet-provider";

/** Which connect provider this browser uses: RainbowKit by default. */
export function walletProvider(): "rainbowkit" | "privy" {
  if (typeof window === "undefined") return "rainbowkit";
  try {
    const url = new URL(window.location.href).searchParams.get("wallet_provider");
    if (url === "privy" || url === "rainbowkit") {
      window.localStorage.setItem(PROVIDER_KEY, url);
      return url;
    }
    return window.localStorage.getItem(PROVIDER_KEY) === "privy" ? "privy" : "rainbowkit";
  } catch {
    return "rainbowkit";
  }
}

/** Switch providers and reload — each owns its own React provider tree. */
export function setWalletProvider(next: "rainbowkit" | "privy") {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROVIDER_KEY, next);
  } catch {
    /* storage unavailable */
  }
  window.location.reload();
}

/** True on phone/tablet web browsers. */
export function isMobileWeb(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1; // iPadOS
  return /Android|iPhone|iPod|iPad/i.test(ua) || touchMac;
}
