/** Shared, browser-safe helpers for linking a login wallet to a trading wallet. */

export const LOCAL_LINK_PREFIX = "conviction:linked-wallet:";

/** Message the trading wallet must sign to prove ownership. */
export function linkMessage(connected: string, linked: string, nonce: string) {
  return [
    "Conviction — link wallets",
    `Trading wallet: ${linked.toLowerCase()}`,
    `Connected wallet: ${connected.toLowerCase()}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export function readLocalLink(connected: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LOCAL_LINK_PREFIX + connected.toLowerCase());
  } catch {
    return null;
  }
}

export function writeLocalLink(connected: string, linked: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_LINK_PREFIX + connected.toLowerCase(), linked.toLowerCase());
  } catch {
    /* storage unavailable */
  }
}

export function clearLocalLink(connected: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_LINK_PREFIX + connected.toLowerCase());
  } catch {
    /* storage unavailable */
  }
}
