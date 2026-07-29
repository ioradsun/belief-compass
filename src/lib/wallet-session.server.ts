/**
 * Wallet sessions — server side.
 *
 * Mints and verifies HMAC-signed session tokens that bind a request to a wallet
 * the caller has proven (by signature) that they control. Any server function
 * that writes rows keyed by `wallet` must call `assertWalletOwnership` first.
 */
import { SESSION_TTL_MS } from "@/lib/wallet-session";

function secret(): string {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.INGEST_RUN_SECRET;
  if (!s) throw new Error("Wallet sessions are not configured.");
  return s;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

export async function mintSessionToken(wallet: string): Promise<{ token: string; exp: number }> {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = b64url(enc.encode(JSON.stringify({ w: wallet.toLowerCase(), exp })));
  return { token: `${payload}.${await hmac(payload)}`, exp };
}

/** The wallet this token proves control of, or null when invalid/expired. */
export async function walletFromToken(token: string | null | undefined): Promise<string | null> {
  if (!token || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  let expected: string;
  try {
    expected = await hmac(payload);
  } catch {
    return null;
  }
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as {
      w?: string;
      exp?: number;
    };
    if (!body.w || !body.exp || body.exp < Date.now()) return null;
    return String(body.w).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Throw unless the caller proved control of `wallet` — either directly, or via
 * a wallet they verifiably linked to it (the POV trading-wallet link).
 */
export async function assertWalletOwnership(
  wallet: string,
  token: string | null | undefined,
): Promise<string> {
  const target = wallet.toLowerCase();
  const signer = await walletFromToken(token);
  if (!signer) throw new Error("Verify your wallet before saving beliefs.");
  if (signer === target) return target;

  const { serviceClient } = await import("@/lib/supabase-clients");
  const { data: links } = await serviceClient()
    .from("wallet_links")
    .select("connected_wallet")
    .eq("connected_wallet", signer)
    .eq("linked_wallet", target)
    .not("verified_at", "is", null)
    .limit(1);
  if (!links?.length) throw new Error("This wallet isn't linked to that account.");
  return target;
}
