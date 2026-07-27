/**
 * Incremental position application — the ONLY path that advances trade-driven
 * wallet_beliefs state from canonical trade events.
 *
 * Per wallet-market pair it: loads the CURRENT position once, reads only the
 * canonical events AFTER the cursor (never full history), folds them with the
 * untouched domain reducer, evaluates with current prices, and commits once via
 * the narrow apply_position_events RPC (lock + optimistic version + cursor guard).
 *
 * Exactly once: identity + canonical order decide everything. Overlap replays are
 * no-ops; late/out-of-order events and version conflicts mark the pair dirty for
 * the targeted rebuilder rather than corrupting state.
 *
 * full_history_reads_hot_path = 0: this module never loads a pair's whole trade
 * history. Full refolds live only in rebuild-position.server.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluate, emptyRow, type BeliefRow } from "@/domain/domain";
import {
  foldEvents,
  reducerStateHash,
  type TradeEventForApply,
  type PositionCursor,
  NULL_CURSOR,
} from "@/lib/positions/position-core";
import { transitionKind, type EconSide } from "@/lib/market-state/read-model";

type SB = SupabaseClient;

const PENDING_READ_LIMIT = 500; // bound the incremental read; overflow ⇒ rebuild
const MAX_VERSION_RETRIES = 4;
const PAIR_CONCURRENCY = 6;

export interface ApplyMetrics {
  pairs_received: number;
  events_applied: number;
  events_replayed: number;
  events_pending: number;
  events_out_of_order: number;
  positions_created: number;
  positions_updated: number;
  positions_marked_dirty: number;
  version_conflicts: number;
  application_failures: number;
  full_history_reads_hot_path: number; // MUST stay 0
  events_per_commit_total: number;
  commits: number;
}

const zeroMetrics = (): ApplyMetrics => ({
  pairs_received: 0,
  events_applied: 0,
  events_replayed: 0,
  events_pending: 0,
  events_out_of_order: 0,
  positions_created: 0,
  positions_updated: 0,
  positions_marked_dirty: 0,
  version_conflicts: 0,
  application_failures: 0,
  full_history_reads_hot_path: 0,
  events_per_commit_total: 0,
  commits: 0,
});

interface LoadedPosition {
  exists: boolean;
  row: BeliefRow;
  cursor: PositionCursor;
  version: number;
  needsRebuild: boolean;
  appliedCount: number;
  priorStanceSide: EconSide;
}

function dbToBeliefRow(r: Record<string, unknown>): BeliefRow {
  return {
    yes_shares: Number(r.yes_shares ?? 0),
    no_shares: Number(r.no_shares ?? 0),
    yes_cost: Number(r.yes_cost ?? 0),
    no_cost: Number(r.no_cost ?? 0),
    expressed_side: (r.expressed_side as BeliefRow["expressed_side"]) ?? "INACTIVE",
    directional_since: r.directional_since ? new Date(r.directional_since as string) : null,
    first_backed_at: r.first_backed_at ? new Date(r.first_backed_at as string) : null,
    last_trade_at: r.last_trade_at ? new Date(r.last_trade_at as string) : null,
  };
}

/** Reducer state (+ optional evaluated fields) → jsonb for the RPC. */
function stateForRpc(
  row: BeliefRow,
  evaluated: { stance: number; stance_side: string; conviction: number; days_held: number } | null,
): Record<string, unknown> {
  const s: Record<string, unknown> = {
    yes_shares: row.yes_shares,
    no_shares: row.no_shares,
    yes_cost: row.yes_cost,
    no_cost: row.no_cost,
    expressed_side: row.expressed_side,
    directional_since: row.directional_since?.toISOString() ?? "",
    first_backed_at: row.first_backed_at?.toISOString() ?? "",
    last_trade_at: row.last_trade_at?.toISOString() ?? "",
  };
  if (evaluated) {
    s.stance = evaluated.stance;
    s.stance_side = evaluated.stance_side;
    s.conviction = evaluated.conviction;
    s.days_held = evaluated.days_held;
    s.last_evaluated_at = new Date().toISOString();
  }
  return s;
}

async function loadPosition(
  sb: SB,
  wallet: string,
  market: number,
): Promise<LoadedPosition | null> {
  const { data, error } = await sb
    .from("wallet_beliefs")
    .select(
      "yes_shares, no_shares, yes_cost, no_cost, expressed_side, directional_since, first_backed_at, last_trade_at, stance_side, last_applied_event_id, last_applied_source_key, last_applied_block_number, last_applied_log_index, position_version, applied_trade_count, needs_rebuild",
    )
    .eq("wallet", wallet)
    .eq("onchain_id", market)
    .maybeSingle();
  if (error) return null;
  if (!data) {
    return {
      exists: false,
      row: emptyRow(),
      cursor: NULL_CURSOR,
      version: 0,
      needsRebuild: false,
      appliedCount: 0,
      priorStanceSide: "INACTIVE",
    };
  }
  return {
    exists: true,
    row: dbToBeliefRow(data as Record<string, unknown>),
    cursor: {
      event_id: (data.last_applied_event_id as string) ?? null,
      source_key: (data.last_applied_source_key as string) ?? null,
      block_number:
        data.last_applied_block_number != null ? Number(data.last_applied_block_number) : null,
      log_index: data.last_applied_log_index != null ? Number(data.last_applied_log_index) : null,
    },
    version: Number(data.position_version ?? 0),
    needsRebuild: Boolean(data.needs_rebuild),
    appliedCount: Number(data.applied_trade_count ?? 0),
    priorStanceSide: (data.stance_side as EconSide) ?? "INACTIVE",
  };
}

/**
 * Emit a durable position-transition event when the evaluated (economic) side
 * changes. These are the canonical facts behind new-believers / side-flips in the
 * market read model — derived facts, NOT duplicate trade events. Deterministic
 * source key tied to the new position version; timed at the triggering trade's
 * canonical occurrence (never application time).
 */
async function emitTransition(
  sb: SB,
  wallet: string,
  market: number,
  prev: EconSide,
  next: EconSide,
  triggerEvent: TradeEventForApply,
  newVersion: number,
): Promise<void> {
  const kind = transitionKind(prev, next);
  if (!kind) return;
  await sb.from("events").upsert(
    {
      source_key: `system:position:${wallet}:${market}:v${newVersion}:${kind}`,
      source: "system",
      kind,
      market_id: String(market),
      wallet,
      occurred_at: triggerEvent.occurred_at,
      block_number: triggerEvent.block_number,
      log_index: triggerEvent.log_index,
      payload: {
        previous_side: prev,
        new_side: next,
        trigger_event_id: triggerEvent.event_id,
        position_version: newVersion,
      },
    },
    { onConflict: "source_key", ignoreDuplicates: true },
  );
}

/** Canonical trade events strictly AFTER the cursor, in chain order (bounded). */
async function loadPendingEvents(
  sb: SB,
  wallet: string,
  market: number,
  cursor: PositionCursor,
): Promise<TradeEventForApply[]> {
  let q = sb
    .from("events")
    .select(
      "id, source_key, wallet, market_id, side, action, amount_eth, shares, occurred_at, block_number, log_index",
    )
    .eq("is_canonical", true)
    .eq("kind", "trade")
    .eq("wallet", wallet)
    .eq("market_id", String(market));
  if (cursor.block_number != null && cursor.log_index != null) {
    // (block, log) > cursor  ⇒  block > b  OR  (block = b AND log > l)
    q = q.or(
      `block_number.gt.${cursor.block_number},and(block_number.eq.${cursor.block_number},log_index.gt.${cursor.log_index})`,
    );
  }
  const { data, error } = await q
    .order("block_number", { ascending: true })
    .order("log_index", { ascending: true })
    .limit(PENDING_READ_LIMIT + 1);
  if (error || !data) return [];
  return data.map((r) => ({
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
  }));
}

/** Count canonical trade events AT OR BEFORE the cursor — for the ordering-gap check. */
async function countAtOrBefore(
  sb: SB,
  wallet: string,
  market: number,
  cursor: PositionCursor,
): Promise<number> {
  if (cursor.block_number == null || cursor.log_index == null) return 0;
  const { count } = await sb
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("is_canonical", true)
    .eq("kind", "trade")
    .eq("wallet", wallet)
    .eq("market_id", String(market))
    .or(
      `block_number.lt.${cursor.block_number},and(block_number.eq.${cursor.block_number},log_index.lte.${cursor.log_index})`,
    );
  return count ?? 0;
}

async function markDirty(sb: SB, pairs: [string, number][], reason: string): Promise<void> {
  if (pairs.length === 0) return;
  await sb.rpc("mark_positions_dirty", {
    p_pairs: pairs.map(([w, m]) => [w, String(m)]),
    p_reason: reason,
  });
}

/** Prices for evaluate(), keyed by market. Missing ⇒ evaluated fields left pending. */
async function loadPrices(
  sb: SB,
  markets: number[],
): Promise<Map<number, { yesPriceUsd: number; noPriceUsd: number }>> {
  const out = new Map<number, { yesPriceUsd: number; noPriceUsd: number }>();
  if (markets.length === 0) return out;
  const { data } = await sb
    .from("market_state")
    .select("onchain_id, yes_price_usd, no_price_usd")
    .in("onchain_id", markets);
  for (const s of data ?? []) {
    if (s.yes_price_usd != null || s.no_price_usd != null) {
      out.set(Number(s.onchain_id), {
        yesPriceUsd: Number(s.yes_price_usd ?? 0),
        noPriceUsd: Number(s.no_price_usd ?? 0),
      });
    }
  }
  return out;
}

async function applyForPair(
  sb: SB,
  wallet: string,
  market: number,
  price: { yesPriceUsd: number; noPriceUsd: number } | undefined,
  m: ApplyMetrics,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_VERSION_RETRIES; attempt++) {
    const pos = await loadPosition(sb, wallet, market);
    if (!pos) {
      m.application_failures += 1;
      return;
    }
    if (pos.needsRebuild) {
      // Dirty pairs are owned by the rebuilder — never apply incrementally.
      return;
    }

    // Ordering-gap detection (late / out-of-order / restored earlier event):
    // the number of canonical events at-or-before the cursor must equal what we
    // have applied. If a new event slipped in before the cursor, mark dirty.
    if (pos.exists) {
      const beforeCount = await countAtOrBefore(sb, wallet, market, pos.cursor);
      if (beforeCount !== pos.appliedCount) {
        m.events_out_of_order += 1;
        m.positions_marked_dirty += 1;
        await markDirty(sb, [[wallet, market]], "late_or_out_of_order_event");
        return;
      }
    }

    const pending = await loadPendingEvents(sb, wallet, market, pos.cursor);
    if (pending.length === 0) {
      m.events_replayed += 1; // nothing after the cursor ⇒ this wake was a replay
      return;
    }
    if (pending.length > PENDING_READ_LIMIT) {
      // Too many to apply in one bounded read (e.g. brand-new pair with deep
      // history) → let the rebuilder absorb the full sequence.
      m.positions_marked_dirty += 1;
      await markDirty(sb, [[wallet, market]], "pending_overflow");
      return;
    }

    m.events_pending += pending.length;
    const fold = foldEvents(pos.row, pending);
    const evaluated = price
      ? (() => {
          const v = evaluate(fold.row, price, new Date());
          return {
            stance: v.stance,
            stance_side: v.stance_side,
            conviction: v.conviction,
            days_held: v.days_held,
          };
        })()
      : null;
    const hash = reducerStateHash(fold.row, fold.cursor.source_key);

    const res = await sb.rpc("apply_position_events", {
      p_wallet: wallet,
      p_market: market,
      p_expected_version: pos.version,
      p_state: stateForRpc(fold.row, evaluated),
      p_cursor: {
        event_id: fold.cursor.event_id,
        source_key: fold.cursor.source_key,
        block_number: fold.cursor.block_number,
        log_index: fold.cursor.log_index,
      },
      p_applied_count: fold.appliedCount,
      p_state_hash: hash,
    });
    if (res.error) {
      m.application_failures += 1;
      return;
    }
    const r = (res.data ?? {}) as {
      ok?: boolean;
      conflict?: boolean;
      disposition?: string;
      new_version?: number;
    };
    if (r.conflict) {
      m.version_conflicts += 1;
      continue; // reload fresh state and retry
    }
    if (r.disposition === "rebuild_required") {
      m.positions_marked_dirty += 1;
      return;
    }
    if (r.disposition === "replay") {
      m.events_replayed += 1;
      return;
    }
    // Success.
    m.events_applied += fold.appliedCount;
    m.events_per_commit_total += fold.appliedCount;
    m.commits += 1;
    if (r.disposition === "created") m.positions_created += 1;
    else m.positions_updated += 1;

    // Emit a durable transition fact if the evaluated economic side changed.
    // Trade-driven (timed at the triggering trade's occurrence). Price-driven
    // side changes are handled by the evaluator's counts, not fabricated windows.
    if (evaluated) {
      const prev = r.disposition === "created" ? ("INACTIVE" as EconSide) : pos.priorStanceSide;
      const next = evaluated.stance_side as EconSide;
      if (transitionKind(prev, next)) {
        await emitTransition(
          sb,
          wallet,
          market,
          prev,
          next,
          pending[pending.length - 1],
          r.new_version ?? pos.version + 1,
        );
      }
    }
    return;
  }
  // Exhausted retries on version conflicts → hand to the rebuilder.
  m.positions_marked_dirty += 1;
  await markDirty(sb, [[wallet, market]], "version_conflict");
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (x: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const x = items[i++];
      await fn(x);
    }
  };
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, worker));
}

/**
 * Apply canonical trade events for the given wallet-market pairs. Unrelated pairs
 * run with bounded concurrency; each pair is processed serially (one commit).
 */
export async function applyCanonicalTradeEvents(
  sb: SB,
  pairs: { wallet: string; market: number }[],
): Promise<ApplyMetrics> {
  const m = zeroMetrics();
  const uniq = new Map<string, { wallet: string; market: number }>();
  for (const p of pairs)
    uniq.set(`${p.wallet.toLowerCase()}|${p.market}`, {
      wallet: p.wallet.toLowerCase(),
      market: p.market,
    });
  const list = [...uniq.values()];
  m.pairs_received = list.length;
  if (list.length === 0) return m;

  const prices = await loadPrices(sb, [...new Set(list.map((p) => p.market))]);
  await runPool(list, PAIR_CONCURRENCY, (p) =>
    applyForPair(sb, p.wallet, p.market, prices.get(p.market), m),
  );
  return m;
}

/**
 * Recovery: find CLEAN positions whose cursor is behind canonical history (an
 * event was persisted but its position write never happened — e.g. a crash) and
 * apply the pending events. Bounded. Also usable as standalone recovery tooling.
 */
export async function recoverPendingPositions(sb: SB, limit = 200): Promise<ApplyMetrics> {
  // Distinct wallet-market pairs that have a canonical trade event newer than the
  // position cursor. We approximate discovery via recent canonical events joined
  // to their (behind) positions; the per-pair apply re-checks precisely.
  const { data: recent } = await sb
    .from("events")
    .select("wallet, market_id")
    .eq("is_canonical", true)
    .eq("kind", "trade")
    .order("block_number", { ascending: false })
    .order("log_index", { ascending: false })
    .limit(limit * 10);
  const uniq = new Map<string, { wallet: string; market: number }>();
  for (const r of recent ?? []) {
    const w = String(r.wallet).toLowerCase();
    const key = `${w}|${r.market_id}`;
    if (!uniq.has(key)) uniq.set(key, { wallet: w, market: Number(r.market_id) });
    if (uniq.size >= limit) break;
  }
  return applyCanonicalTradeEvents(sb, [...uniq.values()]);
}
