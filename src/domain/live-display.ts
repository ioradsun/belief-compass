/**
 * LIVE DISPLAY — the last decision the "Now" tape makes: of everything it has
 * fetched and admitted, WHICH rows to show, and IN WHAT ORDER.
 *
 * This is deliberately separate from ranking (src/domain/feed-cadence) and
 * pacing (src/domain/feed-scheduler). Those decide, upstream, what is eligible
 * and when it may animate. This decides the two things a reader actually
 * experiences at the boundary — the WINDOW and the ORDER — and it exists because
 * the tape had been conflating them, which is what made "Update" feel broken:
 *
 *   1. SELECTION ≠ ORDER. The old tape sliced the mixer's RANK order to 40 and
 *      dropped the rest — so a busy window silently threw away eligible stories,
 *      and "Update" had nothing left to give while older rows still existed. The
 *      fix the product asked for is: rank to CHOOSE the window, then show the
 *      chosen rows in TIME order. `arrangeFeed` does exactly that, and returns
 *      how many more are waiting so the tape can offer them rather than lose them.
 *
 *   2. "NOW" MUST READ AS NOW. Admitting arrivals to the top and floating
 *      timeless facts above them left the column reading 15h → 28m → 13m — a
 *      jumble, not a timeline. `orderForDisplay` restores one comprehensible
 *      temporal model: continuity first (it has no "when"), then everything else
 *      newest-first, regardless of the order rows were admitted in.
 *
 *   3. THERE ARE ONLY THREE HONEST TAIL STATES. New stories to load, older
 *      unseen stories to reveal, or genuinely nothing left — and the last one
 *      must be SAID, not shown as a frozen list. `tailState` names which one the
 *      tape is in so the UI can never look stuck.
 *
 * ZERO IO, pure, deterministic, fully testable.
 */

/** The minimum a row must carry for this module to place it. */
export interface DisplayRow {
  id: string;
  /** ISO. A `timeless` row's value is ignored — it has no place in time. */
  occurredAt: string;
  /**
   * A standing/continuity fact ("still holding YES for 43 days"). It answers
   * "who is still here", not "what just happened", so it is never sorted by time
   * and never counts against the reveal window — it is drawn during silence and
   * belongs at the top as long as it is on screen.
   */
  timeless?: boolean;
}

/**
 * How fast the tape does a FULL rebuild in the background (ms).
 *
 * The realtime socket only refreshes the tape on a new `trade`, and the delta
 * it fetches never rebuilds standing facts, milestones, market signals or
 * "showed up" — those are full-fetch only. So on a quiet chain the feed had
 * nothing to add between trades and simply stopped. This heartbeat is what keeps
 * the non-trade families and the standing reserve replenishing on their own.
 *
 * Chosen against cost: a signed-in reader's full build is a handful of reads, so
 * once every ~90s of an actively-open tab is cheap, and a hidden tab does not
 * poll at all (the query sets `refetchIntervalInBackground: false`).
 */
export const FULL_REBUILD_MS = 90_000;

/**
 * How often the query re-runs on its own timer.
 *
 * Shorter than `FULL_REBUILD_MS`, so most heartbeats stay on the cheap delta
 * path and only roughly every other one pays for a full rebuild. The realtime
 * coordinator still drives instant freshness on top of this — the interval is a
 * floor for the quiet chain the socket has nothing to say about, not the fast
 * path.
 */
export const HEARTBEAT_MS = 45_000;

/** How many rows the tape shows before the reader asks for more. */
export const INITIAL_REVEAL = 40;

/** How many more each "Show earlier" reveals from the already-ranked pool. */
export const REVEAL_PAGE = 30;

/**
 * A full rebuild is due when the last one is older than the cadence.
 *
 * `lastFullAtMs === 0` (never fetched) is due by construction, which is correct:
 * the very first fetch must be a full build, and every delta path already guards
 * on `prev.length > 0` for the same reason.
 */
export function dueForFullRebuild(
  lastFullAtMs: number,
  nowMs: number,
  cadenceMs: number = FULL_REBUILD_MS,
): boolean {
  return nowMs - lastFullAtMs >= cadenceMs;
}

/** Newest first, by ISO string — which sorts lexicographically for a fixed format. */
function newestFirst(a: DisplayRow, b: DisplayRow): number {
  return a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0;
}

/**
 * The reader's temporal model: continuity first, then a plain reverse-chronology.
 *
 * Timeless facts keep their INPUT order (the reserve is already sorted by
 * strength, and time cannot order things that have no time); everything else is
 * newest-first. Stable within each group, so the same input always renders the
 * same column.
 */
export function orderForDisplay<T extends DisplayRow>(rows: readonly T[]): T[] {
  const timeless: T[] = [];
  const timed: T[] = [];
  for (const r of rows) (r.timeless ? timeless : timed).push(r);
  timed.sort(newestFirst);
  return [...timeless, ...timed];
}

export interface ArrangeResult<T> {
  /** What to render, in display order. */
  shown: T[];
  /** How many more timed rows exist beyond the window — the "Show earlier" count. */
  hidden: number;
}

/**
 * SELECT the window by rank, then DISPLAY it in time order.
 *
 * `rankOf` returns a candidate's position in the mixer's quality order (lower is
 * better); a row the mixer never saw — or a tape with no ranking at all — sorts
 * to the back and is chosen only by recency, which is the honest fallback for
 * "we have no quality signal here". Ties break toward the newer row so the window
 * is deterministic and leans recent.
 *
 * Timeless facts are always kept and never counted against `limit`: they are the
 * continuity the tape draws during silence, not competitors for a timeline slot.
 *
 * The chosen timed rows are then handed to `orderForDisplay`, so the window is
 * "the best `limit` stories, shown newest-first" — never the mixer's score order
 * masquerading as a timeline.
 */
export function arrangeFeed<T extends DisplayRow>(
  rows: readonly T[],
  opts: { rankOf?: (id: string) => number | undefined; limit: number },
): ArrangeResult<T> {
  const limit = Math.max(0, Math.floor(opts.limit));
  const rank = (r: T): number => {
    const v = opts.rankOf?.(r.id);
    return v == null || !Number.isFinite(v) ? Number.POSITIVE_INFINITY : v;
  };

  const timeless: T[] = [];
  const timed: T[] = [];
  for (const r of rows) (r.timeless ? timeless : timed).push(r);

  // Best first, newest as the tie-break — this is the SELECTION order, not the
  // display order.
  const bySelection = [...timed].sort((a, b) => rank(a) - rank(b) || newestFirst(a, b));
  const chosen = bySelection.slice(0, limit);
  const hidden = Math.max(0, timed.length - chosen.length);

  return { shown: orderForDisplay([...timeless, ...chosen]), hidden };
}

/**
 * The three honest terminal states, plus "still streaming".
 *
 *   more       older eligible stories exist — offer them ("Show earlier").
 *   streaming  new stories are waiting up top (the pill), or a fetch is in
 *              flight; the tail says nothing so it does not fight the top.
 *   caught_up  the reader has seen everything eligible — say so, plainly.
 *   empty      there is nothing at all yet — the caller's own empty copy.
 *
 * This is the guard against the failure the product named: a feed that has run
 * out must never look the same as one that is merely between updates.
 */
export type TailState = "more" | "streaming" | "caught_up" | "empty";

export function tailState(input: {
  /** Rows currently on screen. */
  shown: number;
  /** Older rows beyond the window, from `arrangeFeed`. */
  hidden: number;
  /** Arrivals held behind the "N New" control. */
  pending: number;
  /** A fetch is in flight; do not declare "caught up" or "empty" yet. */
  loading?: boolean;
}): TailState {
  if (input.hidden > 0) return "more";
  if (input.pending > 0 || input.loading) return "streaming";
  if (input.shown > 0) return "caught_up";
  return "empty";
}
