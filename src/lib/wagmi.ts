import { base } from "wagmi/chains";
import { http } from "wagmi";
import { createConfig } from "@privy-io/wagmi";

/**
 * Wallet connectivity is handled by Privy (the same stack pov.co uses): it owns
 * the connect modal, mobile deep-links and session restore, and exposes the
 * connected wallet to the app through wagmi. This config therefore declares NO
 * connectors — Privy injects them.
 */
export const wagmiConfig = createConfig({
  chains: [base],
  transports: { [base.id]: http() },
  ssr: true,
});

/** Privy app id — a public identifier, safe in the client bundle. */
export const PRIVY_APP_ID =
  (import.meta.env.VITE_PRIVY_APP_ID as string | undefined) ?? "cms7jy9fm00b70ci4uj19bvb5";

/** True on phone/tablet web browsers. */
export function isMobileWeb(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1; // iPadOS
  return /Android|iPhone|iPod|iPad/i.test(ua) || touchMac;
}
