/**
 * THE ETH/USD RATE — one reader, and it cannot fabricate a zero.
 *
 * Every USD figure in this product is an ETH figure multiplied by this number.
 * Cost basis, position worth, capital, volume, creator earnings, the ecosystem
 * report card — all of it. It is the single most load-bearing scalar in the app.
 *
 * WHAT THIS REPLACES. Eight independent reads of `calc_cache.eth_usd`, four of
 * them byte-identical copies of:
 *
 *     const { data } = await sb.from("calc_cache").select("value")
 *       .eq("key", "eth_usd").maybeSingle();
 *     return Number((data as { value?: number } | null)?.value ?? 0) || 0;
 *
 * `|| 0` is the defect, and it is not a rounding concern. Multiplying by zero
 * does not produce a slightly wrong number — it produces a CONFIDENT ZERO. Every
 * position becomes worth $0.00, every market shows no capital, every wallet
 * reads as empty, and nothing anywhere says "we could not price this". The app
 * states, with total confidence, that everyone's money is gone.
 *
 * THIS IS NOT HYPOTHETICAL. `live.functions.ts` carries the post-mortem in a
 * comment: `calc_cache` "shipped with RLS on and no anon policy, so the public
 * read returned 200 with zero rows FOR MONTHS while the stored value was
 * perfectly fine." One reader logged a warning. The other seven multiplied by
 * zero in silence. `domain/affordability` cites the same table as the reason its
 * own guard had to fail closed, and `20260805_cohort_catchup_rerun.sql` records
 * a sweep that "emitted NOTHING" for the same shape of bug on a different
 * column.
 *
 * AND THE RIGHT ANSWER WAS ALREADY WRITTEN. Eleven lines below the copy in
 * `markets.functions.ts` sits `getEthUsd`, the client-facing reader, whose
 * docstring says the rate is "null when unknown so callers show a stale or
 * unavailable state instead of a fabricated number." The rule was known,
 * stated, and implemented — for the client only. The server did the opposite,
 * in the same file.
 *
 * SO: null, never zero. A caller that cannot proceed without a rate must say so
 * to the reader. That is strictly better than an app that quietly reports every
 * balance as nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The row `calc_cache` keeps the cron-refreshed calibration under. */
const KEY = "eth_usd";

export interface EthUsdReading {
  /** Dollars per ETH. Null when we cannot price — NEVER zero. */
  rate: number | null;
  /** When the calibration last ran, for staleness display. */
  updatedAt: string | null;
  /**
   * Why there is no rate, when there is none. `blocked` means the read itself
   * returned nothing — historically an RLS grant, not a missing value — and it
   * is worth distinguishing because refreshing the calibration will not fix it.
   */
  reason: "ok" | "blocked" | "unset";
}

/**
 * Read the rate, with enough context to tell a broken grant from an empty value.
 *
 * Never throws: a pricing failure must degrade a screen, not take it down.
 */
export async function readEthUsdReading(sb: Pick<SupabaseClient, "from">): Promise<EthUsdReading> {
  type Row = { value?: number | null; updated_at?: string | null };
  let row: Row | null = null;
  try {
    const { data } = await sb
      .from("calc_cache")
      .select("value, updated_at")
      .eq("key", KEY)
      .maybeSingle();
    row = (data ?? null) as Row | null;
  } catch {
    return { rate: null, updatedAt: null, reason: "blocked" };
  }
  // No row at all: the read was denied or the key has never been written. Both
  // are "we cannot price", and neither is zero.
  if (row == null) return { rate: null, updatedAt: null, reason: "blocked" };
  const n = Number(row.value);
  const rate = Number.isFinite(n) && n > 0 ? n : null;
  return {
    rate,
    updatedAt: row.updated_at ?? null,
    reason: rate == null ? "unset" : "ok",
  };
}

/**
 * The rate, or null.
 *
 * The common case, for callers that only need the number. Prefer propagating
 * the null over substituting anything: a "—" is honest and a "$0.00" is not.
 */
export async function readEthUsd(sb: Pick<SupabaseClient, "from">): Promise<number | null> {
  return (await readEthUsdReading(sb)).rate;
}
