/**
 * Chain-derived market_state fallback.
 *
 * POV owns the display price + capital fields. When the POV API is down those
 * fields stop refreshing, and the app would keep showing an increasingly stale
 * picture. Almost everything else we display already comes from Base contract
 * events (believers, capital held, volume, activity), so during a POV outage we
 * substitute the chain-derived figures for the POV-owned money fields:
 *
 *   yes_capital_usd / no_capital_usd  <- capital_held_yes / capital_held_no
 *   money_yes_pct                     <- chain capital split
 *
 * We deliberately do NOT touch yes_price_usd / no_price_usd (POV prices those;
 * inventing a price would be worse than showing the last known one) and we do
 * NOT stamp pov_updated_at, so the moment POV recovers its own numbers win.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Only substitute once POV data is genuinely stale. */
export const POV_STALE_MS = 15 * 60 * 1000;
const MAX_MARKETS = 500;

export interface ChainFallbackResult {
  candidates: number;
  updated: number;
  error?: string;
}

export async function applyChainMarketStateFallback(
  sb: SupabaseClient,
  staleMs = POV_STALE_MS,
): Promise<ChainFallbackResult> {
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  /**
   * `capital_held_*` is ETH cost basis. Writing it straight into a column named
   * `_usd` reported a $1.92 position as $0.00 — the unit, not the number, was
   * wrong. Convert exactly once, here, and substitute nothing when we have no
   * rate to convert with.
   */
  const { data: eth } = await sb.rpc("eth_usd_calibration");
  const ethUsd = Number(eth ?? 0);
  if (!(ethUsd > 0)) return { candidates: 0, updated: 0, error: "no eth/usd calibration" };

  const { data, error } = await sb
    .from("market_state")
    .select(
      "onchain_id, pov_updated_at, capital_held_yes, capital_held_no, yes_capital_usd, no_capital_usd, money_yes_pct",
    )
    .or(`pov_updated_at.is.null,pov_updated_at.lt.${cutoff}`)
    .order("capital_held_total", { ascending: false, nullsFirst: false })
    .limit(MAX_MARKETS);

  if (error) return { candidates: 0, updated: 0, error: error.message };

  const rows = data ?? [];
  const updates: Record<string, unknown>[] = [];
  for (const r of rows) {
    const yes = Number(r.capital_held_yes ?? 0) * ethUsd;
    const no = Number(r.capital_held_no ?? 0) * ethUsd;
    const total = yes + no;
    if (!(total > 0)) continue; // no chain capital → nothing honest to show
    const pct = (yes / total) * 100;
    const same =
      Math.abs(Number(r.yes_capital_usd ?? 0) - yes) < 0.005 &&
      Math.abs(Number(r.no_capital_usd ?? 0) - no) < 0.005 &&
      Math.abs(Number(r.money_yes_pct ?? -1) - pct) < 0.01;
    if (same) continue;
    updates.push({
      onchain_id: r.onchain_id,
      yes_capital_usd: yes,
      no_capital_usd: no,
      money_yes_pct: pct,
      updated_at: new Date().toISOString(),
    });
  }

  if (updates.length === 0) return { candidates: rows.length, updated: 0 };

  const { error: upErr } = await sb
    .from("market_state")
    .upsert(updates, { onConflict: "onchain_id" });
  if (upErr) return { candidates: rows.length, updated: 0, error: upErr.message };

  return { candidates: rows.length, updated: updates.length };
}
