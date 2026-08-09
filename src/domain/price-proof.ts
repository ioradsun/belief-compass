/**
 * price-proof — temporal ordering for the Now feed (plan §8, §9).
 *
 * THE TRUST INVARIANT: if the PI cannot establish ordering, the PI cannot tell a
 * before/after story. An event timestamp plus a 24h change does NOT prove the
 * move happened after the event — the window can predate the entry. Everything
 * that says "since then" must come through this file.
 *
 * Pure. No IO. The caller supplies an hourly-downsampled price path (see the
 * `market_price_path` RPC); this file decides whether that path actually proves
 * anything about a given moment, and refuses when it does not.
 */

/** One observed price, as captured. */
export type PriceSample = { atMs: number; price: number };

/**
 * How stale the "before" observation may be and still count as the price at the
 * moment in question. The path is hourly, and the writer runs every ~2 minutes,
 * so a sample more than ~2 hours older than the event means the history has a
 * hole in it — and a hole is not proof.
 */
export const PROOF_MAX_STALENESS_MS = 2 * 60 * 60 * 1000;

/** The path must reach at least this far past the event, or "since then" is empty. */
export const PROOF_MIN_ELAPSED_MS = 30 * 60 * 1000;

export type PriceProof = {
  /** The moment being measured from — the input we are timing. */
  sinceMs: number;
  /** Price observed at/just before that moment. */
  priceThen: number;
  /** Latest observed price in the path. */
  priceNow: number;
  atNowMs: number;
  /** Signed relative move since then: (now − then) / then. */
  relMove: number;
};

/** Newest sample at/older than `atMs`, or null when the path cannot cover it. */
export function priceAt(
  path: readonly PriceSample[] | null | undefined,
  atMs: number,
  maxStalenessMs = PROOF_MAX_STALENESS_MS,
): PriceSample | null {
  if (!path || path.length === 0 || !Number.isFinite(atMs)) return null;
  let best: PriceSample | null = null;
  for (const s of path) {
    if (!Number.isFinite(s.atMs) || !Number.isFinite(s.price) || s.price <= 0) continue;
    if (s.atMs > atMs) continue;
    if (!best || s.atMs > best.atMs) best = s;
  }
  if (!best) return null;
  return atMs - best.atMs <= maxStalenessMs ? best : null;
}

/**
 * Prove what the price did SINCE a moment, or return null.
 *
 * Null is the common, correct answer: no path, a gap around the moment, or a
 * moment so recent that "since then" has not happened yet. Callers must treat
 * null as "we cannot say", never as "nothing moved".
 */
export function priceProofSince(
  path: readonly PriceSample[] | null | undefined,
  sinceMs: number,
  nowMs: number,
): PriceProof | null {
  const then = priceAt(path, sinceMs);
  if (!then) return null;

  let latest: PriceSample | null = null;
  for (const s of path!) {
    if (!Number.isFinite(s.atMs) || !Number.isFinite(s.price) || s.price <= 0) continue;
    if (s.atMs < sinceMs) continue;
    if (!latest || s.atMs > latest.atMs) latest = s;
  }
  if (!latest) return null;
  if (latest.atMs - sinceMs < PROOF_MIN_ELAPSED_MS) return null;
  if (nowMs < latest.atMs) return null;

  return {
    sinceMs,
    priceThen: then.price,
    priceNow: latest.price,
    atNowMs: latest.atMs,
    relMove: (latest.price - then.price) / then.price,
  };
}

/** Rows returned by `market_price_path`, grouped into per-market paths. */
export function groupPricePaths(
  rows: ReadonlyArray<{ onchain_id: number | string; captured_at: string; yes_price_usd: number | string | null }>,
): Map<number, PriceSample[]> {
  const out = new Map<number, PriceSample[]>();
  for (const r of rows) {
    const id = Number(r.onchain_id);
    const price = r.yes_price_usd === null ? NaN : Number(r.yes_price_usd);
    const atMs = Date.parse(r.captured_at);
    if (!Number.isFinite(id) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(atMs)) {
      continue;
    }
    const list = out.get(id);
    if (list) list.push({ atMs, price });
    else out.set(id, [{ atMs, price }]);
  }
  for (const list of out.values()) list.sort((a, b) => a.atMs - b.atMs);
  return out;
}
