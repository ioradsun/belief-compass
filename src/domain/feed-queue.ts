/**
 * FEED QUEUE — the running order, and the promise that it holds still.
 *
 * The server has always returned a fully sequenced feed; the client consumed it
 * one market at a time and never showed the rest. Making the order VISIBLE is
 * the point of the Feed List — but it also makes an existing behaviour visible,
 * and that behaviour is the reason this module exists rather than a `number[]`
 * in a component.
 *
 * The feed re-ranks every eight seconds. Today that reorder is invisible: only
 * `pinnedId` stops it from swapping the market under the reader's cursor. Put
 * the order on screen and the same reorder becomes rows jumping around while
 * someone is reading them. So the rule this module enforces is a single
 * sentence:
 *
 *     THE VISIBLE ORDER NEVER CHANGES WITHOUT AN EXPLICIT COMMIT.
 *
 * A new server order does not replace the list. It is held as `incoming`, and
 * whatever it adds is offered as a count — "4 new markets" — that the reader
 * chooses to accept. Freshness without instability.
 *
 * THREE CONSEQUENCES worth stating, because each one is a decision:
 *
 *   1. A MARKET THAT LEAVES THE FEED STAYS VISIBLE until the next commit. It
 *      was recommended a moment ago and it still exists; deleting the row under
 *      someone would be the same instability from the other direction.
 *
 *   2. RUNNING OFF THE END COMMITS. Reaching the last row means the reader has
 *      consumed the list, so there is nobody to disturb — the honest moment to
 *      adopt. "Caught up" then means genuinely nothing new, not merely nothing
 *      adopted.
 *
 *   3. JUMPING TO AN UNKNOWN MARKET SPLICES IT IN, right after the active one.
 *      Opening a market from search, a Live row or a position continues the
 *      running order from that point instead of abandoning it — the queue is
 *      the session, and search is an entry point into it, not a detour out.
 *
 * A PURE REORDER (same ids, new sequence) is held too, and shows no notice:
 * there is nothing new to announce, and rearranging the list under a reader is
 * exactly what this module refuses to do. It is adopted at the next commit,
 * whatever causes it.
 *
 * ZERO IO, deterministic, fully testable.
 */

export interface FeedQueue {
  /** The running order the reader can see. Only `commit` may change it. */
  readonly order: readonly number[];
  /** The market held by the center panel. */
  readonly activeId: number | null;
  /**
   * The freshest server order, not yet adopted. Null when there is nothing
   * waiting — either none has arrived, or it agreed with what is on screen.
   */
  readonly incoming: readonly number[] | null;
}

const EMPTY: readonly number[] = [];

const same = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Distinct, in first-seen order. The server can repeat an id across pages. */
function unique(ids: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * A queue from the first server order. The active market defaults to the head —
 * the feed's own top pick — unless the caller already has one in hand (a link,
 * a restored session, a market opened before the feed arrived).
 */
export function initQueue(order: readonly number[], activeId: number | null = null): FeedQueue {
  const ids = unique(order);
  const active = activeId != null && Number.isFinite(activeId) ? activeId : (ids[0] ?? null);
  // An active market outside the first order still belongs in it — the same
  // splice `jumpTo` performs, applied at the boundary where nothing precedes it.
  const withActive = active != null && !ids.includes(active) ? [active, ...ids] : ids;
  return { order: withActive, activeId: active, incoming: null };
}

/**
 * A fresh order from the server. Never replaces what is on screen.
 *
 * An empty order is ignored rather than adopted: a momentary empty response —
 * a failed enrichment, a filtered-out slice — must not be able to empty a list
 * the reader is looking at.
 */
export function receiveOrder(q: FeedQueue, latest: readonly number[]): FeedQueue {
  const ids = unique(latest);
  if (ids.length === 0) return q;
  if (q.order.length === 0) return initQueue(ids, q.activeId);
  if (same(ids, q.order)) return q.incoming ? { ...q, incoming: null } : q;
  return { ...q, incoming: ids };
}

/** Ids waiting to appear — the ones the reader has not been shown yet. */
export function arrivals(q: FeedQueue): number[] {
  if (!q.incoming) return [];
  const shown = new Set(q.order);
  return q.incoming.filter((id) => !shown.has(id));
}

/** The number behind the "N new markets" notice. Zero hides it. */
export function arrivalCount(q: FeedQueue): number {
  return arrivals(q).length;
}

/**
 * Adopt the waiting order. The reader asked for this — by tapping the notice,
 * by refreshing, or by reaching the end of the list.
 *
 * The active market is kept even when the server has dropped it (just decided,
 * just resolved), at the index it already occupied. Losing your place because a
 * market you were reading stopped being recommended is precisely the disruption
 * this module exists to prevent.
 */
export function commit(q: FeedQueue): FeedQueue {
  if (!q.incoming) return q;
  const next = [...q.incoming];
  const active = q.activeId;
  if (active != null && !next.includes(active)) {
    const wasAt = q.order.indexOf(active);
    next.splice(wasAt < 0 ? next.length : Math.min(wasAt, next.length), 0, active);
  }
  return { order: next, activeId: active, incoming: null };
}

/** Where the active market sits in the visible order; -1 when it is not in it. */
export function activeIndex(q: FeedQueue): number {
  return q.activeId == null ? -1 : q.order.indexOf(q.activeId);
}

/**
 * Select a market by id — a click in the list, a search hit, a Live row, a
 * position. An id the queue has never seen is spliced in directly after the
 * active market, so the running order continues from where the reader is
 * instead of restarting somewhere else.
 */
export function jumpTo(q: FeedQueue, id: number): FeedQueue {
  if (!Number.isFinite(id)) return q;
  if (q.order.includes(id)) return { ...q, activeId: id };
  const at = activeIndex(q);
  const order = [...q.order];
  order.splice(at < 0 ? order.length : at + 1, 0, id);
  return { ...q, order, activeId: id };
}

/**
 * The next market in the running order.
 *
 * At the end, the waiting order is adopted first — the one moment when
 * rearranging disturbs nobody — so "Next" keeps working as long as the server
 * has anything new. Only when it does not does the queue stay put, which is
 * what `isCaughtUp` then reports.
 */
export function advance(q: FeedQueue): FeedQueue {
  const at = activeIndex(q);
  if (at >= 0 && at + 1 < q.order.length) return { ...q, activeId: q.order[at + 1] };
  if (at < 0 && q.order.length > 0) return { ...q, activeId: q.order[0] };
  const merged = commit(q);
  const mergedAt = activeIndex(merged);
  if (mergedAt >= 0 && mergedAt + 1 < merged.order.length)
    return { ...merged, activeId: merged.order[mergedAt + 1] };
  return merged;
}

/** The previous market. Backwards navigation never commits — it only re-reads. */
export function retreat(q: FeedQueue): FeedQueue {
  const at = activeIndex(q);
  if (at <= 0) return q;
  return { ...q, activeId: q.order[at - 1] };
}

/**
 * True when there is nowhere forward to go: the active market is the last one
 * and nothing new is waiting. Distinct from an empty feed, which is a different
 * message entirely.
 */
export function isCaughtUp(q: FeedQueue): boolean {
  if (q.order.length === 0) return false;
  const at = activeIndex(q);
  // No located reader but markets in hand: `advance` would move to the head, so
  // there is forward motion and this is not the end of anything.
  if (at < 0) return false;
  if (at + 1 < q.order.length) return false;
  return arrivalCount(q) === 0;
}

/** A queue with nothing in it — the pre-feed state. */
export const emptyQueue: FeedQueue = { order: EMPTY, activeId: null, incoming: null };
