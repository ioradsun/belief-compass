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
 * SEEDED VS INVENTED. Holding a new order is only a kindness when the reader
 * HAS an order to be disturbed. There is one state where they do not, and it is
 * the common one: the page mounts with `?m=` in the URL, the active market is
 * known before any feed response, and `jumpTo` splices it into an empty queue.
 * The order is now one market long — and the first real server order was then
 * treated as a re-rank to be held, so the panel showed the market you arrived on
 * under "Now reading" and "You're at the end of this feed" beneath it. The rest
 * of the feed was fetched, sequenced, and never shown.
 *
 * So the queue records whether its order came FROM THE SERVER (`seeded`). An
 * unseeded order is a placeholder, not a reading position: the first server
 * order is adopted straight away, with the market the reader arrived on kept at
 * the head. Nothing is disturbed, because nothing was there to disturb.
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
  /**
   * True once a SERVER order has been adopted.
   *
   * False means whatever is in `order` was invented locally — the single market
   * the URL named before the feed arrived. The distinction is what stops a
   * placeholder of one from being defended as though it were a reading position.
   */
  readonly seeded: boolean;
  /**
   * PAGES FETCHED PAST THE FIRST — the reader's own progress through the feed.
   *
   * Kept apart from `order` because the two answer to different owners. `order`
   * is a RANKING the server proposed and may propose again; these are markets
   * the reader walked far enough to ask for, and a re-rank of page one has no
   * business deleting page two. Without this, `commit` — which replaces `order`
   * wholesale with the newest ranking — silently truncated the feed back to its
   * first page every time a poll landed.
   */
  readonly appended: readonly number[];
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
export function initQueue(
  order: readonly number[],
  activeId: number | null = null,
  /** See `jumpTo` — false for a ranked lens, which admits nothing unranked. */
  opts: { admit?: boolean } = {},
): FeedQueue {
  const ids = unique(order);
  const active = activeId != null && Number.isFinite(activeId) ? activeId : (ids[0] ?? null);
  /**
   * An active market outside the first order still belongs in it — the same
   * splice `jumpTo` performs, applied at the boundary where nothing precedes it.
   *
   * AND THIS IS THE PATH THAT ACTUALLY BIT. A lens change empties the queue, so
   * the next server order arrives UNSEEDED and `receiveOrder` routes it through
   * here — putting the market still on screen at the HEAD of the new ranking.
   * "Most Capital" then opened with a $2.59 market above a $259 one. Guarding
   * only `jumpTo` would have missed it.
   */
  const admit = opts.admit !== false;
  const withActive = admit && active != null && !ids.includes(active) ? [active, ...ids] : ids;
  return { order: withActive, activeId: active, incoming: null, seeded: true, appended: EMPTY };
}

/**
 * THE NEXT PAGE — markets fetched because the reader reached the end of these.
 *
 * APPENDING IS THE ONE CHANGE THAT NEEDS NO PERMISSION, and that is why this is
 * a separate verb rather than another `receiveOrder`. This module's rule is that
 * the visible order never changes without a commit, and the reason is that
 * moving a row under someone who is reading it is hostile. Adding rows BELOW
 * everything on screen moves nothing: every index the reader can see is
 * unchanged, so there is nobody to disturb and nothing to ask.
 *
 * Which is also why paging could not be built out of the existing parts. A
 * second `receiveOrder` would be held as `incoming` and adopted only at the next
 * commit — the answer to "give me more" arriving and then waiting for the reader
 * to run out of the very thing it was fetched to prevent.
 *
 * Ids already in the order are dropped rather than moved: a market's place is
 * where the reader already saw it.
 */
export function appendOrder(q: FeedQueue, more: readonly number[]): FeedQueue {
  const known = new Set(q.order);
  const add = unique(more).filter((id) => !known.has(id));
  if (add.length === 0) return q;
  return { ...q, order: [...q.order, ...add], appended: [...q.appended, ...add] };
}

/**
 * A fresh order from the server. Never replaces what is on screen.
 *
 * An empty order is ignored rather than adopted: a momentary empty response —
 * a failed enrichment, a filtered-out slice — must not be able to empty a list
 * the reader is looking at.
 */
export function receiveOrder(
  q: FeedQueue,
  latest: readonly number[],
  /** See `jumpTo` — false for a ranked lens, which admits nothing unranked. */
  opts: { admit?: boolean } = {},
): FeedQueue {
  const ids = unique(latest);
  if (ids.length === 0) return q;
  // Nothing the reader chose is on screen yet — either the queue is empty, or it
  // holds only the market the URL named. Adopt, keeping that market at the head
  // when the lens is a blend that has room for it.
  if (!q.seeded) return initQueue(ids, q.activeId, opts);
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
  /**
   * PAGE TWO SURVIVES A RE-RANK OF PAGE ONE. `incoming` is the newest ranking of
   * the FIRST page — the base feed query — so adopting it verbatim would drop
   * every market the reader paged in and hand them a queue that ends where it
   * ended an hour ago. They are re-appended in the order they were fetched,
   * which is where they already are on screen.
   */
  const inNext = new Set(next);
  for (const id of q.appended) if (!inNext.has(id)) next.push(id);
  const active = q.activeId;
  if (active != null && !next.includes(active)) {
    const wasAt = q.order.indexOf(active);
    next.splice(wasAt < 0 ? next.length : Math.min(wasAt, next.length), 0, active);
  }
  return { order: next, activeId: active, incoming: null, seeded: true, appended: q.appended };
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
export function jumpTo(
  q: FeedQueue,
  id: number,
  /**
   * Should a market the order has never seen be SPLICED INTO it?
   *
   * True for a blend: the reader opened something from search, a live row or one
   * of their positions, and the session should continue from there rather than
   * ending when the result closes. That is the whole point of an origin.
   *
   * FALSE FOR A RANKING, and this was a real defect. "Most Capital" is a promise
   * that the list descends by capital. Splicing the market being read into it
   * put a $2.59 market above a $259 one — and because a lens change empties the
   * queue first, `activeIndex` returned -1 and the splice landed at the FRONT,
   * so the very first row of a ranked lens was the one market that had not been
   * ranked at all. The reader keeps their market in centre stage either way;
   * only the playlist stays honest about its own ordering.
   */
  opts: { admit?: boolean } = {},
): FeedQueue {
  if (!Number.isFinite(id)) return q;
  if (q.order.includes(id)) return { ...q, activeId: id };
  if (opts.admit === false) {
    // Active but not a member. `advance` already handles this: with no index it
    // moves to the head of the order, so "Next" leaves the foreign market and
    // enters the ranking at the top, which is where the ranking begins.
    return { ...q, activeId: id };
  }
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
export const emptyQueue: FeedQueue = {
  order: EMPTY,
  activeId: null,
  incoming: null,
  seeded: false,
  appended: EMPTY,
};
