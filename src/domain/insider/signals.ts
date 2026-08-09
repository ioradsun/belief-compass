/**
 * THE INSIDER BUILDER (seam 1) — canonical activity → InsiderSignal[].
 *
 * The Insider observes canonical facts and emits signals. This is the first,
 * lowest-risk seam of that builder: it lifts already-grouped canonical activity
 * (the pure `groupLiveRows` output — bursts, sweeps, transitions, milestones,
 * standing facts) into the unified `InsiderSignal` vocabulary, with provenance.
 *
 * It is PURE and DETERMINISTIC: identical input rows always produce identical
 * signals (same ids, same order, same provenance). That is the replay/parity
 * contract every later migration step is proven against.
 *
 * WHY IT TAKES A STRUCTURAL ROW, NOT `LiveRow`. The domain must not depend on
 * `src/lib`. `ActivityFactRow` is the structural subset the builder needs; a
 * `LiveRow` (from `lib/live-tape`) satisfies it by shape, so callers pass their
 * rows straight in without the domain importing lib.
 *
 * WHY EVIDENCE IS `NO_EVIDENCE` HERE. Activity is chronological, not scored —
 * "what just happened", newest first. It deliberately does NOT compute magnitude,
 * velocity, novelty, etc.; that is the Now/Insight builders' job. `null` means
 * "not computed", never "zero", so a downstream scorer can tell the difference.
 */
import {
  NO_EVIDENCE,
  type InsiderSignal,
  type InsiderSignalKind,
  type Side,
} from "./types";

/** Version of THIS builder's output. Bump when the mapping changes (replay parity). */
export const INSIDER_BUILDER_VERSION = 1 as const;

/**
 * The structural shape the builder reads from a grouped activity row. A
 * `LiveRow` (src/lib/live-tape) is assignable to this by shape.
 */
export interface ActivityFactRow {
  /** Stable canonical key — a chain event key for singletons, a group key otherwise. */
  id: string;
  /** Row family: trade_burst | large_trade | round_trip | wallet_sweep | market_created | side_shift | believer_milestone | tribe_doubled | … */
  kind: string;
  /** Canonical `events.market_id`, as a string (LiveRow carries it as a string; "0" = market-less, e.g. a sweep). */
  marketId: string;
  side: Side | null;
  /** ISO occurrence time — the canonical `occurred_at`. */
  occurredAt: string;
  /** A continuity, not an event (a standing fact); it carries no "when". */
  timeless?: boolean;
  /** Row payload — `action` (BUY/SELL) lives here for trades. */
  payload?: Record<string, unknown> | null;
}

/**
 * Map a grouped-row family to the Insider signal kind. Deliberately conservative:
 * a trade burst is a `trade` (it does not claim a first-time entry), a timeless
 * row is `standing`. Action (BUY/SELL) is preserved in `reasonCodes`, not
 * over-claimed as entered/exited.
 */
export function insiderKindFromRow(row: ActivityFactRow): InsiderSignalKind {
  if (row.timeless) return "standing";
  switch (row.kind) {
    case "market_created":
      return "market_created";
    case "side_shift":
      return "side_flip";
    case "believer_milestone":
    case "tribe_doubled":
      return "milestone";
    // trade_burst | large_trade | round_trip | wallet_sweep and any other
    // trade-derived row: an ordinary directional trade.
    default:
      return "trade";
  }
}

function actionOf(row: ActivityFactRow): "BUY" | "SELL" | null {
  const a = row.payload?.action;
  return a === "BUY" || a === "SELL" ? a : null;
}

/**
 * Build Insider signals from grouped canonical activity rows. Pure; order is
 * preserved from the input (which `groupLiveRows` already sorts newest-first).
 */
export function signalsFromActivityRows(rows: readonly ActivityFactRow[]): InsiderSignal[] {
  return rows.map((row) => {
    const action = actionOf(row);
    const reasonCodes = [`row:${row.kind}`];
    if (action) reasonCodes.push(`action:${action}`);
    if (row.timeless) reasonCodes.push("timeless");
    const marketId = Number(row.marketId);
    return {
      id: row.id,
      marketId: Number.isFinite(marketId) ? marketId : 0,
      kind: insiderKindFromRow(row),
      side: row.side,
      occurredAt: row.occurredAt,
      // Activity does not score — evidence is left uncomputed on purpose.
      evidence: { ...NO_EVIDENCE },
      provenance: {
        sourceEventIds: [row.id],
        reasonCodes,
        builderVersion: INSIDER_BUILDER_VERSION,
      },
      // Keep the source row so a renderer keeps everything it already had.
      payload: row,
    } satisfies InsiderSignal;
  });
}
