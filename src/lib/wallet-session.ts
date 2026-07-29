/**
 * Wallet sessions — browser-safe helpers.
 *
 * A person proves they control a wallet ONCE (one signature at connect time)
 * and receives a short-lived server-signed session token. Every write keyed by
 * a wallet address carries that token, so nobody can write belief / House data
 * for a wallet they don't control.
 */

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STORE_PREFIX = "conviction:wallet-session:";

/** The message the wallet must sign to open a session. */
export function sessionMessage(wallet: string, nonce: string) {
  return [
    "Conviction — verify wallet",
    "Signing proves you control this wallet. It does not authorize any transaction.",
    `Wallet: ${wallet.toLowerCase()}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export function readSessionToken(wallet: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + wallet.toLowerCase());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; exp: number };
    if (!parsed?.token || parsed.exp < Date.now() + 60_000) return null;
    return parsed.token;
  } catch {
    return null;
  }
}

export function writeSessionToken(wallet: string, token: string, exp: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORE_PREFIX + wallet.toLowerCase(),
      JSON.stringify({ token, exp }),
    );
  } catch {
    /* storage unavailable */
  }
}

export function clearSessionToken(wallet: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORE_PREFIX + wallet.toLowerCase());
  } catch {
    /* storage unavailable */
  }
}

export function randomNonce() {
  const b = new Uint8Array(16);
  (globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
