/**
 * PROJECTION — INSIDER ACTIVITY: "what just happened (on this side)?"
 *
 * The simplest projection, and the first to migrate: a chronological FILTER over
 * the same Insider history, not a bespoke engine. A YES/NO rail is
 * `activity(signals, { marketId, side: "YES" })`; a market's full activity is the
 * same call without a side.
 *
 * PARITY WITH TODAY'S RAILS. This reproduces exactly what the current tape does:
 *   • market scope   — `buildTape` queries `market_id in (…)`; here `marketId`.
 *   • side scope      — `buildTape` does `q.eq("side", side)`, which EXCLUDES
 *                       null-side market-wide rows; so a side query keeps only
 *                       rows whose side matches (a market opening / two-sided
 *                       transition is not repeated inside a side column).
 *   • order           — newest first, with an id tiebreak, exactly the sort
 *                       `groupLiveRows` emits (src/lib/live-tape).
 * No ranking, no personalization, no editorializing — that is Now's job.
 */
import type { InsiderActivity, InsiderActivityQuery, InsiderSignal } from "../types";

/** Newest first; stable id tiebreak — the exact order `groupLiveRows` produces. */
function byRecencyThenId(a: InsiderSignal, b: InsiderSignal): number {
  if (a.occurredAt < b.occurredAt) return 1;
  if (a.occurredAt > b.occurredAt) return -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function activity(
  signals: readonly InsiderSignal[],
  query: InsiderActivityQuery,
): InsiderActivity {
  const scoped = signals.filter((s) => {
    if (s.marketId !== query.marketId) return false;
    // A side query keeps only that side — null-side (market-wide) rows are
    // excluded, matching the server's `eq("side", side)`.
    if (query.side != null && s.side !== query.side) return false;
    return true;
  });
  scoped.sort(byRecencyThenId);
  const limited = query.limit != null ? scoped.slice(0, query.limit) : scoped;
  return {
    marketId: query.marketId,
    side: query.side ?? null,
    signals: limited,
  };
}
