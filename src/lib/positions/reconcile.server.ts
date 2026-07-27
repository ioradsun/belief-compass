/**
 * Position reconciliation — bounded, resumable drift detection + repair.
 *
 * For a batch of pairs it recomputes the reducer-state hash from canonical events
 * (a full refold) and compares it to the stored hash. Matches are simply marked
 * reconciled; drift is repaired by rebuildPosition(). This is also the shadow-mode
 * comparison primitive: incremental state (stored) vs authoritative full refold.
 *
 * Rolling sweep: each run processes the least-recently-reconciled pairs (rebuilt_at
 * ASC, nulls first), so repeated bounded runs cover the whole table over time.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { refold, reducerStateHash, type TradeEventForApply } from "@/lib/positions/position-core";
import { rebuildPosition } from "@/lib/positions/rebuild-position.server";

type SB = SupabaseClient;
const PAGE = 1000;

export interface ReconcileMetrics {
  pairs_checked: number;
  pairs_matched: number;
  pairs_repaired: number;
  events_replayed: number;
  failures: number;
  remaining_pairs: number;
  oldest_unreconciled_at: string | null;
}

async function loadAllCanonicalEvents(
  sb: SB,
  wallet: string,
  market: number,
): Promise<TradeEventForApply[]> {
  const out: TradeEventForApply[] = [];
  let lastBlock = -1;
  let lastLog = -1;
  for (;;) {
    const { data } = await sb
      .from("events")
      .select(
        "id, source_key, wallet, market_id, side, action, amount_eth, shares, occurred_at, block_number, log_index",
      )
      .eq("is_canonical", true)
      .eq("kind", "trade")
      .eq("wallet", wallet)
      .eq("market_id", String(market))
      .or(`block_number.gt.${lastBlock},and(block_number.eq.${lastBlock},log_index.gt.${lastLog})`)
      .order("block_number", { ascending: true })
      .order("log_index", { ascending: true })
      .limit(PAGE);
    if (!data || data.length === 0) break;
    for (const r of data)
      out.push({
        event_id: r.id as string,
        source_key: r.source_key as string,
        wallet: r.wallet as string,
        market_id: String(r.market_id),
        side: r.side as "YES" | "NO",
        action: r.action as "BUY" | "SELL",
        amount_eth: r.amount_eth as string,
        shares: r.shares as string,
        occurred_at: r.occurred_at as string,
        block_number: Number(r.block_number),
        log_index: Number(r.log_index),
      });
    const last = data[data.length - 1];
    lastBlock = Number(last.block_number);
    lastLog = Number(last.log_index);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function reconcileBatch(sb: SB, limit = 200): Promise<ReconcileMetrics> {
  const m: ReconcileMetrics = {
    pairs_checked: 0,
    pairs_matched: 0,
    pairs_repaired: 0,
    events_replayed: 0,
    failures: 0,
    remaining_pairs: 0,
    oldest_unreconciled_at: null,
  };

  const { data } = await sb
    .from("wallet_beliefs")
    .select("wallet, onchain_id, state_hash, last_applied_source_key, rebuilt_at, needs_rebuild")
    .order("rebuilt_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  const pairs = data ?? [];
  if (pairs.length > 0) m.oldest_unreconciled_at = (pairs[0].rebuilt_at as string) ?? null;

  for (const p of pairs) {
    const wallet = String(p.wallet).toLowerCase();
    const market = Number(p.onchain_id);
    try {
      m.pairs_checked += 1;
      const events = await loadAllCanonicalEvents(sb, wallet, market);
      m.events_replayed += events.length;
      const fold = refold(events);
      const rebuiltHash = reducerStateHash(fold.row, fold.cursor.source_key);
      const storedHash = (p.state_hash as string) ?? null;

      if (!p.needs_rebuild && storedHash != null && storedHash === rebuiltHash) {
        m.pairs_matched += 1;
        // Mark reconciled (touch rebuilt_at) without rewriting state.
        await sb
          .from("wallet_beliefs")
          .update({ rebuilt_at: new Date().toISOString() })
          .eq("wallet", wallet)
          .eq("onchain_id", market);
      } else {
        // Drift (or never-hashed / dirty) → authoritative repair.
        const r = await rebuildPosition(sb, wallet, market);
        if (r.ok) m.pairs_repaired += 1;
        else m.failures += 1;
      }
    } catch {
      m.failures += 1;
    }
  }

  const { count } = await sb.from("wallet_beliefs").select("*", { count: "exact", head: true });
  m.remaining_pairs = Math.max(0, (count ?? 0) - m.pairs_checked);
  return m;
}
