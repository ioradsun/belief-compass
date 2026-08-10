/**
 * CHAIN-DERIVED PRICE — the missing input for markets we created ourselves.
 *
 * `market_state.yes_price_usd` / `no_price_usd` had exactly one writer: the POV
 * poller, copying POV's own display price. POV only indexes markets created
 * through POV, so a market created inside this app (`markets.source = 'conviction'`,
 * `pov_uuid IS NULL`) is a 404 there — FOREVER. Its price columns therefore
 * stayed NULL, and every consumer downstream reads a NULL price as zero:
 *
 *   evaluate()      → yes_value = shares × 0 = 0
 *   classifyByValue → 0/0 → INACTIVE  → believers_yes = 0
 *   conviction      → 0                → invisible to DNA, cohorts, dashboard
 *   belief-rollup   → canMark false    → yes_value_usd never written
 *
 * That is the whole bug: one absent number, silently propagated as a confident
 * zero, which is why a wallet could hold ~1 YES share and appear in no capital
 * total and no participant count.
 *
 * The chain already knows the answer. Every canonical trade carries `price` in
 * WEI PER SHARE, so the last trade on a side is that side's last observed price,
 * and `eth_usd_calibration()` converts it. This is an observation, not an
 * invention: we only ever report a price a side actually traded at, and a side
 * that has never traded stays NULL rather than borrowing the other side's number.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const WEI = 1e18;

export interface ChainPrices {
  yes: number | null;
  no: number | null;
}

/**
 * Last traded price per side, in USD. NULL for a side with no canonical trade —
 * absence of evidence must not become a price.
 */
export async function chainDerivedPrices(
  sb: SupabaseClient,
  market: number,
  ethUsd: number,
): Promise<ChainPrices> {
  if (!(ethUsd > 0)) return { yes: null, no: null };
  const { data } = await sb
    .from("events")
    .select("side, price, occurred_at")
    .eq("market_id", String(market))
    .eq("kind", "trade")
    .eq("is_canonical", true)
    .not("price", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(50);

  const out: ChainPrices = { yes: null, no: null };
  for (const r of data ?? []) {
    const side = r.side === "YES" ? "yes" : r.side === "NO" ? "no" : null;
    if (!side || out[side] != null) continue;
    const usd = (Number(r.price) / WEI) * ethUsd;
    if (Number.isFinite(usd) && usd > 0) out[side] = usd;
    if (out.yes != null && out.no != null) break;
  }
  return out;
}
