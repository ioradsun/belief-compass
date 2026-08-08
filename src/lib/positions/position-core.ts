/**
 * Position core — pure helpers for incremental, exactly-once position state.
 *
 * Phase 3 first principle: a new canonical trade event updates exactly ONE
 * wallet-market position, incrementally, exactly once. Correctness cannot depend
 * on the 12-block overlap delivering each event once, so identity + canonical
 * ORDER (block_number ASC, log_index ASC) drive every decision here — never
 * timestamps, never "probably once".
 *
 * This module owns ONLY the decision + folding logic and a deterministic hash of
 * reducer-owned state. It reuses the untouched domain reducer (applyTrade) as the
 * behavioral source of truth — it NEVER reimplements share/cost math. ZERO IO.
 */
import { applyTrade, emptyRow, type BeliefRow, type Trade } from "@/domain/domain";
import { weiToEth } from "@/domain/money";

// ── Event shape the applier consumes (a canonical kind='trade' event) ────────
export interface TradeEventForApply {
  event_id: string; // events.id (uuid)
  source_key: string; // deterministic identity
  wallet: string;
  market_id: string;
  side: "YES" | "NO";
  action: "BUY" | "SELL";
  amount_eth: string | number; // raw wei
  shares: string | number; // raw wei
  occurred_at: string; // canonical event time (ISO)
  block_number: number;
  log_index: number;
}

/** The canonical application cursor — chain order, never a timestamp. */
export interface PositionCursor {
  event_id: string | null;
  source_key: string | null;
  block_number: number | null;
  log_index: number | null;
}

export const NULL_CURSOR: PositionCursor = {
  event_id: null,
  source_key: null,
  block_number: null,
  log_index: null,
};

export type Disposition = "apply_incrementally" | "replay" | "rebuild_required" | "invalid";

// ── Ordering (canonical chain order) ─────────────────────────────────────────
/** block_number ASC, then log_index ASC. */
export function compareChainOrder(
  a: { block_number: number; log_index: number },
  b: { block_number: number; log_index: number },
): number {
  if (a.block_number !== b.block_number) return a.block_number - b.block_number;
  return a.log_index - b.log_index;
}

/** Is the event strictly AFTER the cursor in canonical order? Null cursor ⇒ yes. */
export function isAfterCursor(
  ev: { block_number: number; log_index: number },
  cursor: PositionCursor,
): boolean {
  if (cursor.block_number == null || cursor.log_index == null) return true;
  if (ev.block_number !== cursor.block_number) return ev.block_number > cursor.block_number;
  return ev.log_index > cursor.log_index;
}

// ── Validity ─────────────────────────────────────────────────────────────────
export function isValidTradeEvent(ev: TradeEventForApply): boolean {
  return Boolean(
    ev.source_key &&
    ev.wallet &&
    ev.market_id &&
    (ev.side === "YES" || ev.side === "NO") &&
    (ev.action === "BUY" || ev.action === "SELL") &&
    ev.occurred_at &&
    Number.isFinite(ev.block_number) &&
    Number.isFinite(ev.log_index),
  );
}

/**
 * Disposition for a single event against the current position:
 *   invalid           — missing required trade data/provenance
 *   rebuild_required   — position is dirty, or event lands at/before the cursor
 *                        (late / out-of-order / restored) — never fold onto state
 *   replay             — (unused here; a strict at-or-before with matching cursor
 *                        source_key is a pure replay) see note below
 *   apply_incrementally— canonical, strictly after a clean cursor
 *
 * NOTE: at-or-before-cursor is treated as rebuild_required, NOT silently skipped,
 * unless it is the exact cursor event (an overlap replay of the last-applied
 * event), which is a pure replay → skip. Anything earlier is an ordering anomaly.
 */
export function dispositionFor(
  ev: TradeEventForApply,
  cursor: PositionCursor,
  needsRebuild: boolean,
): Disposition {
  if (!isValidTradeEvent(ev)) return "invalid";
  if (needsRebuild) return "rebuild_required";
  if (isAfterCursor(ev, cursor)) return "apply_incrementally";
  // At or before the cursor. If it IS the cursor event, it's a pure replay.
  if (cursor.source_key != null && ev.source_key === cursor.source_key) return "replay";
  if (
    cursor.block_number === ev.block_number &&
    cursor.log_index === ev.log_index &&
    cursor.source_key == null
  ) {
    return "replay";
  }
  // Strictly before the cursor, different identity → late/out-of-order.
  return "rebuild_required";
}

// ── Conversion ───────────────────────────────────────────────────────────────
/** Canonical event → domain Trade. Wei→float exactly as the poller always has. */
export function toTrade(ev: TradeEventForApply): Trade {
  return {
    side: ev.side,
    direction: ev.action,
    token_amount: weiToEth(ev.shares),
    eth_amount: weiToEth(ev.amount_eth),
    ts: new Date(ev.occurred_at),
  };
}

export interface FoldResult {
  row: BeliefRow;
  appliedCount: number;
  cursor: PositionCursor;
}

/**
 * Fold a batch of NEW events (for ONE pair) onto the current reducer state, in
 * canonical order, committing in memory. Only events strictly after the cursor
 * are applied; the rest are ignored by the caller's disposition pass. Returns the
 * final state, how many applied, and the advanced cursor. Reuses applyTrade.
 */
export function foldEvents(current: BeliefRow, events: TradeEventForApply[]): FoldResult {
  const ordered = [...events].sort(compareChainOrder);
  let row = current;
  let applied = 0;
  let cursor: PositionCursor = NULL_CURSOR;
  for (const ev of ordered) {
    row = applyTrade(row, toTrade(ev));
    applied += 1;
    cursor = {
      event_id: ev.event_id,
      source_key: ev.source_key,
      block_number: ev.block_number,
      log_index: ev.log_index,
    };
  }
  return { row, appliedCount: applied, cursor };
}

/** Full canonical refold (rebuild/reconciliation/shadow) — from empty state. */
export function refold(events: TradeEventForApply[]): FoldResult {
  return foldEvents(emptyRow(), events);
}

// ── Deterministic reducer-state hash ─────────────────────────────────────────
// Uses ONLY reducer-owned fields (never evaluated price/time fields). Normalizes
// decimals, nulls, timestamps and the last-applied identity so the hash is stable
// across environments and safe for shadow-mode / drift comparison.
const NUM = (n: number): string => {
  if (!Number.isFinite(n)) return "NaN";
  // Fixed precision collapses float noise (1e-12) without losing real precision.
  const r = Math.abs(n) < 1e-9 ? 0 : n;
  return r.toFixed(9);
};
const TS = (d: Date | null): string => (d ? new Date(d).toISOString() : "∅");

export function reducerStateHash(row: BeliefRow, lastSourceKey: string | null): string {
  const canonical = [
    NUM(row.yes_shares),
    NUM(row.no_shares),
    NUM(row.yes_cost),
    NUM(row.no_cost),
    row.expressed_side,
    TS(row.directional_since),
    TS(row.first_backed_at),
    TS(row.last_trade_at),
    lastSourceKey ?? "∅",
  ].join("|");
  return fnv1a(canonical);
}

/** FNV-1a 64-bit (as hex) — dependency-free, deterministic, well-dispersed. */
export function fnv1a(s: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}
