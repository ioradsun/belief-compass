/**
 * Targeted position rebuild — the repair path. For ONE wallet-market pair it
 * refolds the COMPLETE canonical trade history (from `events`, never the trades
 * projection — that is no longer authoritative for repair), evaluates with current
 * prices, and atomically replaces the stored state + cursor via rebuild_position.
 *
 * This is the safe answer to reorgs, late/out-of-order events and drift: never
 * invert reducer operations algebraically — rebuild from remaining canonical facts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluate } from "@/domain/domain";
import { refold, reducerStateHash, type TradeEventForApply } from "@/lib/positions/position-core";

type SB = SupabaseClient;
const PAGE = 1000;

/** Every canonical trade event for the pair, in chain order (paged). */
async function loadAllCanonicalEvents(
  sb: SB,
  wallet: string,
  market: number,
): Promise<TradeEventForApply[]> {
  const out: TradeEventForApply[] = [];
  let lastBlock = -1;
  let lastLog = -1;
  for (;;) {
    const { data, error } = await sb
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
    if (error || !data || data.length === 0) break;
    for (const r of data) {
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
    }
    const last = data[data.length - 1];
    lastBlock = Number(last.block_number);
    lastLog = Number(last.log_index);
    if (data.length < PAGE) break;
  }
  return out;
}

export interface RebuildResult {
  wallet: string;
  market: number;
  events: number;
  empty: boolean;
  ok: boolean;
  error?: string;
}

/** Rebuild one pair from canonical events. Idempotent (safe to run twice). */
export async function rebuildPosition(
  sb: SB,
  wallet: string,
  market: number,
): Promise<RebuildResult> {
  const w = wallet.toLowerCase();
  try {
    const events = await loadAllCanonicalEvents(sb, w, market);
    const fold = refold(events);
    const empty = events.length === 0;

    let evaluated: Record<string, unknown> = {};
    if (!empty) {
      const { data: ms } = await sb
        .from("market_state")
        .select("yes_price_usd, no_price_usd")
        .eq("onchain_id", market)
        .maybeSingle();
      if (ms && (ms.yes_price_usd != null || ms.no_price_usd != null)) {
        const v = evaluate(
          fold.row,
          { yesPriceUsd: Number(ms.yes_price_usd ?? 0), noPriceUsd: Number(ms.no_price_usd ?? 0) },
          new Date(),
        );
        evaluated = {
          stance: v.stance,
          stance_side: v.stance_side,
          conviction: v.conviction,
          days_held: v.days_held,
          last_evaluated_at: new Date().toISOString(),
        };
      }
    }

    const state: Record<string, unknown> = empty
      ? { expressed_side: "INACTIVE" }
      : {
          yes_shares: fold.row.yes_shares,
          no_shares: fold.row.no_shares,
          yes_cost: fold.row.yes_cost,
          no_cost: fold.row.no_cost,
          expressed_side: fold.row.expressed_side,
          directional_since: fold.row.directional_since?.toISOString() ?? "",
          first_backed_at: fold.row.first_backed_at?.toISOString() ?? "",
          last_trade_at: fold.row.last_trade_at?.toISOString() ?? "",
          last_directional_side: fold.row.last_directional_side ?? "",
          ...evaluated,
        };
    const hash = reducerStateHash(
      empty ? refold([]).row : fold.row,
      empty ? null : fold.cursor.source_key,
    );

    const res = await sb.rpc("rebuild_position", {
      p_wallet: w,
      p_market: market,
      p_state: state,
      p_cursor: empty
        ? { event_id: null, source_key: null, block_number: null, log_index: null }
        : {
            event_id: fold.cursor.event_id,
            source_key: fold.cursor.source_key,
            block_number: fold.cursor.block_number,
            log_index: fold.cursor.log_index,
          },
      p_applied_count: fold.appliedCount,
      p_state_hash: hash,
      p_empty: empty,
    });
    if (res.error)
      return {
        wallet: w,
        market,
        events: events.length,
        empty,
        ok: false,
        error: res.error.message,
      };
    // A rebuilt position changes participation → refresh the market read model.
    await sb.rpc("enqueue_market_refresh", { p_market_ids: [market], p_kind: "positions" });
    return { wallet: w, market, events: events.length, empty, ok: true };
  } catch (e) {
    return {
      wallet: w,
      market,
      events: 0,
      empty: false,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Claim + rebuild a bounded batch of dirty pairs (oldest request first). */
export async function rebuildDirtyBatch(
  sb: SB,
  limit = 100,
): Promise<{ processed: number; ok: number; failed: number; results: RebuildResult[] }> {
  const { data } = await sb
    .from("wallet_beliefs")
    .select("wallet, onchain_id, rebuild_requested_at")
    .eq("needs_rebuild", true)
    .order("rebuild_requested_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  const pairs = (data ?? []).map((r) => ({
    wallet: String(r.wallet),
    market: Number(r.onchain_id),
  }));
  const results: RebuildResult[] = [];
  let ok = 0;
  let failed = 0;
  for (const p of pairs) {
    // Idempotent rebuild — double-processing by a second worker is harmless.
    const r = await rebuildPosition(sb, p.wallet, p.market);
    results.push(r);
    if (r.ok) ok += 1;
    else {
      failed += 1;
      await sb
        .from("wallet_beliefs")
        .update({ rebuild_reason: `rebuild_failed: ${r.error ?? "unknown"}` })
        .eq("wallet", p.wallet.toLowerCase())
        .eq("onchain_id", p.market);
    }
  }
  return { processed: pairs.length, ok, failed, results };
}
