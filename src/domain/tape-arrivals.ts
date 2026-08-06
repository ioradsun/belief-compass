/**
 * LIVE TAPE ARRIVALS — new activity announced, not injected.
 *
 * WHAT THIS CHANGES. The tape currently inserts every row it receives. The
 * presentation scheduler paces them — one at a time, with entrances, so eight
 * events landing in one frame is not a page refresh with a transition on it —
 * but pacing is not the same as asking. A reader who has scrolled down to read
 * something is still having the list grow above them, and the realtime
 * coordinator refetches this tape on every batch of trades, throttled to 1.5
 * seconds. On a busy market that is a list that will not sit still.
 *
 * So arrivals are now GATED on whether anyone is reading:
 *
 *   NOBODY IS READING — at the top, pointer elsewhere — new rows go straight
 *   in. This is the "live conversation" the tape is for, and holding rows back
 *   from someone who is watching the top of the list would make it feel dead
 *   for no benefit.
 *
 *   SOMEONE IS READING — scrolled away, or the pointer is in the tape — new
 *   rows are held and counted. The list under their eyes does not move until
 *   they ask for it.
 *
 * ONE UPDATE PER MARKET. Twelve trades in one market inside three seconds is
 * one thing happening, not twelve. Held rows are grouped by market, newest
 * kept, and the count is of GROUPS — so the number on the banner is the number
 * of rows that will appear when it is tapped. A banner that promises eight and
 * delivers thirty is worse than no banner.
 *
 * WHY THE COUNTER IS BATCHED, and not merely thrown at React: a number that
 * ticks 1 → 2 → 3 as events land is its own kind of movement, and a reader
 * watching a counter twitch is still being interrupted. The window is long
 * enough to feel calm and short enough to still feel live.
 *
 * ZERO IO, pure, fully testable. The timing lives in the component; every
 * decision about WHAT is announced lives here.
 */

export const TAPE = {
  /**
   * How long incoming events are coalesced before the counter moves.
   *
   * Deliberately longer than the coordinator's 1.5s activity throttle, so a
   * steady stream of trades produces one counter change rather than one per
   * batch.
   */
  batchMs: 2_500,
  /** Above this the banner stops counting and says "99+". */
  displayCap: 99,
  /**
   * Distance from the top of the scroller that still counts as "at the top".
   *
   * Not zero: a reader who has nudged the list a few pixels has not started
   * reading, and treating that as engagement would hold rows back from someone
   * who is plainly watching the top.
   */
  atTopPx: 24,
} as const;

/** The minimum a row must carry for this module to reason about it. */
export interface Arrival {
  id: string;
  /** Which market the activity belongs to. Rows without one never group. */
  marketId: string;
  occurredAt: string;
}

/** What the reader is doing, as far as the tape can tell. */
export interface Engagement {
  /** The tape's scroller is at (or within `atTopPx` of) the top. */
  atTop: boolean;
  /** The pointer is inside the tape — reading, or about to click a row. */
  pointerInside: boolean;
}

/**
 * May new rows enter without being announced first?
 *
 * Only when nothing suggests anyone is reading. Note what is NOT consulted:
 * whether a market is open in the centre. The tape is a side panel and there is
 * essentially always a market open beside it, so gating on that would mean the
 * tape never updated on its own — the rule would read as caution and behave as
 * a dead feed.
 */
export function canAutoAdmit(e: Engagement): boolean {
  return e.atTop && !e.pointerInside;
}

/**
 * One update per market, newest kept, input order preserved.
 *
 * The tape arrives newest-first, so the first row seen for a market is its
 * latest state and the ones behind it are the same story earlier. Rows with no
 * market id are never grouped — they are not market activity and collapsing
 * them together would merge unrelated things.
 */
export function groupArrivals<T extends Arrival>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = r.marketId;
    if (!key) {
      out.push(r);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * How many updates are waiting — after grouping, so the number matches what
 * actually appears when the banner is tapped.
 */
export function pendingCount(rows: readonly Arrival[]): number {
  return groupArrivals(rows).length;
}

/** "1 new update" · "8 new updates" · "99+ new updates" */
export function arrivalLabel(n: number): string {
  const c = Math.max(0, Math.floor(n));
  if (c === 1) return "1 new update";
  return `${c > TAPE.displayCap ? `${TAPE.displayCap}+` : c} new updates`;
}

/**
 * Which held rows are genuinely new to the reader.
 *
 * A refetch returns rows the tape is already showing — the query merges onto an
 * immutable tail rather than replacing — so "what arrived" is the difference
 * against what is visible, never the size of the response. Without this the
 * banner would announce the whole tape every time the socket reconnected.
 */
export function unseen<T extends Arrival>(
  incoming: readonly T[],
  visibleIds: ReadonlySet<string>,
): T[] {
  return incoming.filter((r) => !visibleIds.has(r.id));
}
