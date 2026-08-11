import { describe, it, expect } from "vitest";
import {
  initQueue,
  receiveOrder,
  arrivals,
  arrivalCount,
  commit,
  activeIndex,
  jumpTo,
  advance,
  retreat,
  isCaughtUp,
  emptyQueue,
  appendOrder,
  HISTORY,
  type FeedQueue,
} from "./feed-queue";

describe("the visible order never changes without a commit", () => {
  it("holds a re-rank rather than applying it", () => {
    const q = initQueue([1, 2, 3]);
    const after = receiveOrder(q, [3, 1, 2]);
    expect(after.order).toEqual([1, 2, 3]);
    expect(after.incoming).toEqual([3, 1, 2]);
  });

  it("announces nothing for a pure reorder — there is no news in it", () => {
    const q = receiveOrder(initQueue([1, 2, 3]), [3, 1, 2]);
    expect(arrivalCount(q)).toBe(0);
  });

  it("counts only what the reader has not been shown", () => {
    const q = receiveOrder(initQueue([1, 2, 3]), [9, 1, 8, 2, 3]);
    expect(arrivals(q)).toEqual([9, 8]);
    expect(arrivalCount(q)).toBe(2);
  });

  it("applies the held order only when asked", () => {
    const q = commit(receiveOrder(initQueue([1, 2, 3]), [9, 1, 8, 2, 3]));
    expect(q.order).toEqual([9, 1, 8, 2, 3]);
    expect(q.incoming).toBeNull();
  });

  it("drops the held order when the server agrees with the screen again", () => {
    const held = receiveOrder(initQueue([1, 2, 3]), [3, 1, 2]);
    expect(receiveOrder(held, [1, 2, 3]).incoming).toBeNull();
  });

  it("never lets an empty response empty a list someone is reading", () => {
    const q = initQueue([1, 2, 3]);
    expect(receiveOrder(q, []).order).toEqual([1, 2, 3]);
  });

  it("adopts the first order immediately — there is no reader to disturb yet", () => {
    const q = receiveOrder(emptyQueue, [4, 5]);
    expect(q.order).toEqual([4, 5]);
    expect(q.activeId).toBe(4);
    expect(q.incoming).toBeNull();
  });
});

describe("a market that leaves the feed keeps its row", () => {
  it("stays visible until the next commit", () => {
    // 2 was just decided, so the server stops recommending it. Deleting the row
    // under the reader is the same instability, from the other direction.
    const q = receiveOrder(initQueue([1, 2, 3]), [1, 3]);
    expect(q.order).toEqual([1, 2, 3]);
  });

  it("survives the commit when it is the one being read", () => {
    const reading = jumpTo(initQueue([1, 2, 3]), 2);
    const q = commit(receiveOrder(reading, [1, 3]));
    expect(q.activeId).toBe(2);
    expect(q.order).toContain(2);
    // …and at the place it already occupied, so nothing moves under the reader.
    expect(activeIndex(q)).toBe(1);
  });

  it("is dropped on commit when the reader had moved on", () => {
    const q = commit(receiveOrder(initQueue([1, 2, 3]), [1, 3]));
    expect(q.order).toEqual([1, 3]);
  });
});

describe("navigation keeps your place", () => {
  it("advances through the visible order", () => {
    let q = initQueue([1, 2, 3]);
    q = advance(q);
    expect(q.activeId).toBe(2);
    q = advance(q);
    expect(q.activeId).toBe(3);
  });

  it("goes back without committing anything", () => {
    const held = receiveOrder(advance(initQueue([1, 2, 3])), [9, 1, 2, 3]);
    const back = retreat(held);
    expect(back.activeId).toBe(1);
    expect(back.incoming).toEqual([9, 1, 2, 3]);
    expect(back.order).toEqual([1, 2, 3]);
  });

  it("stops at the top rather than wrapping", () => {
    const q = initQueue([1, 2, 3]);
    expect(retreat(q).activeId).toBe(1);
  });

  it("selects any row without disturbing the order", () => {
    const q = jumpTo(initQueue([1, 2, 3]), 3);
    expect(q.activeId).toBe(3);
    expect(q.order).toEqual([1, 2, 3]);
  });
});

describe("an unknown market joins the running order", () => {
  it("splices in right after the active one", () => {
    // Opened from search: the session continues from here rather than restarting.
    const q = jumpTo(advance(initQueue([1, 2, 3])), 77);
    expect(q.order).toEqual([1, 2, 77, 3]);
    expect(q.activeId).toBe(77);
  });

  it("continues forward into the rest of the order", () => {
    const q = advance(jumpTo(advance(initQueue([1, 2, 3])), 77));
    expect(q.activeId).toBe(3);
  });

  it("belongs to the order even when it arrived before the feed did", () => {
    const q = initQueue([1, 2, 3], 77);
    expect(q.activeId).toBe(77);
    expect(q.order).toEqual([77, 1, 2, 3]);
  });
});

describe("running off the end is the one safe moment to rearrange", () => {
  it("commits and keeps going when something is waiting", () => {
    let q = initQueue([1, 2]);
    q = receiveOrder(q, [1, 2, 3]);
    q = advance(q); // → 2, the last visible row
    expect(q.order).toEqual([1, 2]);
    q = advance(q); // end of the list: adopt, then continue
    expect(q.order).toEqual([1, 2, 3]);
    expect(q.activeId).toBe(3);
  });

  it("stays put when there is genuinely nothing more", () => {
    const q = advance(advance(initQueue([1, 2])));
    expect(q.activeId).toBe(2);
    expect(isCaughtUp(q)).toBe(true);
  });

  it("is not caught up while markets are waiting", () => {
    const q = receiveOrder(advance(initQueue([1, 2])), [1, 2, 3]);
    expect(isCaughtUp(q)).toBe(false);
  });

  it("is not caught up in the middle of the list", () => {
    expect(isCaughtUp(initQueue([1, 2, 3]))).toBe(false);
  });

  it("an empty feed is not the same message as caught up", () => {
    expect(isCaughtUp(emptyQueue)).toBe(false);
  });
});

describe("the order is a set, not a bag", () => {
  it("ignores repeats from the server", () => {
    const q = initQueue([1, 2, 1, 3, 2]);
    expect(q.order).toEqual([1, 2, 3]);
  });

  it("re-selects rather than duplicating a market already in the order", () => {
    const q = jumpTo(initQueue([1, 2, 3]), 1);
    expect(q.order).toEqual([1, 2, 3]);
    expect(q.activeId).toBe(1);
  });

  it("refuses a non-id", () => {
    const q = initQueue([1, 2, 3]);
    expect(jumpTo(q, Number.NaN)).toBe(q);
  });
});

/**
 * THE BUG THIS PREVENTS, in the shape it actually shipped in.
 *
 * The page mounts with `?m=2516` in the URL. The active market is known before
 * any feed response, so the component splices it into an empty queue — order is
 * now one market long. The real order then arrived and was treated as a re-rank
 * to be HELD, because "does the reader have an order?" was asked as
 * `order.length === 0`.
 *
 * The panel showed the market you arrived on under "Now reading" and "You're at
 * the end of this feed." beneath it. The rest of the feed had been fetched,
 * sequenced and scored, and was never shown.
 */
describe("an order invented from the URL is not a reading position", () => {
  it("adopts the first server order instead of holding it behind one market", () => {
    const arrived = jumpTo(emptyQueue, 2516);
    expect(arrived.order).toEqual([2516]); // the placeholder
    expect(arrived.seeded).toBe(false);

    const after = receiveOrder(arrived, [10, 11, 12]);
    expect(after.order).toEqual([2516, 10, 11, 12]);
    expect(after.activeId).toBe(2516);
    expect(after.incoming).toBeNull();
    expect(after.seeded).toBe(true);
  });

  it("keeps the arrived-at market at the head, so Next walks the feed", () => {
    const q = receiveOrder(jumpTo(emptyQueue, 99), [10, 11]);
    expect(q.order[0]).toBe(99);
    expect(advance(q).activeId).toBe(10);
  });

  it("does not duplicate a market the feed also happens to contain", () => {
    const q = receiveOrder(jumpTo(emptyQueue, 11), [10, 11, 12]);
    expect(q.order).toEqual([10, 11, 12]);
    expect(q.activeId).toBe(11);
  });

  it("never reports the end of a feed it has not shown", () => {
    const q = receiveOrder(jumpTo(emptyQueue, 2516), [10, 11, 12]);
    expect(isCaughtUp(q)).toBe(false);
    expect(q.order.filter((id) => id !== q.activeId)).toEqual([10, 11, 12]);
  });

  /**
   * The promise the module exists for is unchanged: once a real order is on
   * screen, a re-rank is still held. Only the placeholder loses its defence.
   */
  it("still holds a re-rank once a real order has been adopted", () => {
    const seeded = receiveOrder(jumpTo(emptyQueue, 2516), [10, 11, 12]);
    const later = receiveOrder(seeded, [12, 10, 11, 13]);
    expect(later.order).toEqual([2516, 10, 11, 12]);
    expect(later.incoming).toEqual([12, 10, 11, 13]);
  });

  it("treats a queue built straight from the server as seeded", () => {
    expect(initQueue([1, 2, 3]).seeded).toBe(true);
    expect(emptyQueue.seeded).toBe(false);
  });

  it("is seeded after a commit, whatever came before it", () => {
    const held = receiveOrder(initQueue([1, 2]), [2, 1, 3]);
    expect(commit(held).seeded).toBe(true);
  });
});

/**
 * A RANKED LENS ADMITS NOTHING IT HAS NOT RANKED.
 *
 * "Most Capital" is a promise that the list descends by capital. The market the
 * reader is currently on has no rank under that measure, and splicing it in put
 * a $2.59 market at the top of a list whose next row was $259.
 *
 * BOTH DOORS HAD TO BE SHUT. `jumpTo` is the obvious one. The one that actually
 * bit is `initQueue` via `receiveOrder`: a lens change empties the queue, so the
 * next server order arrives UNSEEDED and is adopted through `initQueue`, which
 * put the still-active market at the HEAD.
 */
describe("admit", () => {
  it("keeps a foreign market out of a ranked order, but still makes it active", () => {
    const q = jumpTo(initQueue([10, 20, 30]), 99, { admit: false });
    expect(q.order).toEqual([10, 20, 30]);
    expect(q.activeId).toBe(99);
  });

  it("still splices it into a blend, which is what an origin is for", () => {
    const q = jumpTo(initQueue([10, 20, 30], 10), 99);
    expect(q.order).toContain(99);
  });

  it("closes the door the lens change actually opens", () => {
    // Empty queue + an active market from the previous lens + the first ranked
    // response. This is the exact sequence behind the screenshot.
    const empty = {
      order: [],
      activeId: 99,
      incoming: null,
      seeded: false,
      appended: [],
    } as const;
    const ranked = receiveOrder(empty, [10, 20, 30], { admit: false });
    expect(ranked.order).toEqual([10, 20, 30]);
    expect(ranked.order[0]).not.toBe(99);
    // The blend keeps its old, deliberate behaviour.
    expect(receiveOrder(empty, [10, 20, 30]).order).toEqual([99, 10, 20, 30]);
  });

  it("never duplicates a market that IS in the ranking", () => {
    const q = jumpTo(initQueue([10, 20, 30]), 20, { admit: false });
    expect(q.order).toEqual([10, 20, 30]);
    expect(q.activeId).toBe(20);
  });

  it("lets Next enter the ranking at its top from a foreign market", () => {
    // `advance` with no index moves to order[0] — the ranking begins where the
    // ranking begins, rather than stranding the reader.
    const q = jumpTo(initQueue([10, 20, 30]), 99, { admit: false });
    expect(advance(q).activeId).toBe(10);
  });
});

/**
 * PAGING — the feed grows at the bottom, and nothing above it moves.
 *
 * The symptom these lock down: opening a market from the insider rail (or
 * search, or a position) left an Up Next of two rows while the same session on
 * a different market had forty. Nothing had run out — the reader had simply
 * landed deep in an order that only ever had one page.
 */
describe("appendOrder", () => {
  const upcoming = (q: FeedQueue) => {
    const i = q.activeId == null ? -1 : q.order.indexOf(q.activeId);
    return i >= 0 ? q.order.slice(i + 1) : [...q.order];
  };

  it("adds to the tail and moves nothing already on screen", () => {
    const q = initQueue([1, 2, 3]);
    const grown = appendOrder(q, [4, 5]);
    expect(grown.order).toEqual([1, 2, 3, 4, 5]);
    expect(grown.activeId).toBe(1);
    // Every index the reader could see is unchanged — that is why appending
    // needs no commit.
    expect(grown.order.slice(0, 3)).toEqual(q.order);
  });

  it("rescues a reader who jumped into the tail", () => {
    // The reported bug, in three lines.
    const order = Array.from({ length: 48 }, (_, i) => i + 1);
    const deep = jumpTo(initQueue(order), 47, { admit: true });
    expect(upcoming(deep)).toEqual([48]);
    expect(upcoming(appendOrder(deep, [101, 102, 103]))).toEqual([48, 101, 102, 103]);
  });

  it("never places a market it already holds", () => {
    const q = appendOrder(initQueue([1, 2, 3]), [3, 4, 3]);
    expect(q.order).toEqual([1, 2, 3, 4]);
  });

  it("is a no-op when the page adds nothing", () => {
    const q = initQueue([1, 2, 3]);
    expect(appendOrder(q, [1, 2])).toBe(q);
    expect(appendOrder(q, [])).toBe(q);
  });

  /**
   * A PAGED QUEUE KEEPS ITS PATH.
   *
   * `incoming` is a re-ranking of page ONE, which is all the base query returns.
   * Adopting it for a reader four pages in reorders ground they already walked
   * and — the defect below — buries whatever is new behind them.
   */
  it("holds its order against a re-ranked first page", () => {
    let q = initQueue([1, 2, 3]);
    q = appendOrder(q, [10, 11]);
    q = commit(receiveOrder(q, [3, 2, 1]));
    expect(q.order).toEqual([1, 2, 3, 10, 11]);
  });

  it("does not move a paged market the new ranking promoted", () => {
    let q = initQueue([1, 2, 3]);
    q = appendOrder(q, [10]);
    // 10 scored its way onto page one this time. Its place is where the reader
    // already saw it; a ranking of page one does not get to relocate page two.
    q = commit(receiveOrder(q, [10, 1, 2, 3]));
    expect(q.order).toEqual([1, 2, 3, 10]);
  });

  /**
   * THE DEFECT THIS WAS WRITTEN FOR, measured on the real reducer before the
   * fix: reader at index 4 of a paged queue, a poll carrying three genuinely new
   * markets committed them to indices 0, 1 and 2. Behind the reader, in a
   * forward-only queue — which is not a re-rank, it is a delete.
   */
  it("puts genuinely new markets AHEAD of a reader who has paged", () => {
    let q = initQueue([1, 2, 3]);
    q = appendOrder(q, [10, 11, 12]);
    q = jumpTo(q, 11, { admit: true });
    q = commit(receiveOrder(q, [90, 91, 92]));
    const at = q.order.indexOf(11);
    expect(q.order.slice(at + 1)).toEqual([12, 90, 91, 92]);
  });

  it("keeps the active market even when it is in neither list", () => {
    let q = initQueue([1, 2, 3]);
    q = appendOrder(q, [10]);
    q = jumpTo(q, 999, { admit: true });
    q = commit(receiveOrder(q, [1, 2, 3]));
    expect(q.order).toContain(999);
    expect(q.order).toContain(10);
    expect(q.activeId).toBe(999);
  });
});

/**
 * BOUNDED HISTORY — why the feed stopped growing at its own end.
 *
 * `order` travels to the server as `queuedIds` so a page can mean "the next
 * markets, not these", and that field is capped. An unbounded order outgrew the
 * cap, the ids that fell out were the OLDEST — exactly what the resurface tier
 * offers first — so the server returned markets the client still held,
 * `appendOrder` dropped them as duplicates, and the refill asked the same
 * question every ten seconds while Up Next sat empty.
 */
describe("history is bounded", () => {
  const walk = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("forgets consumed markets past HISTORY", () => {
    let q = initQueue(walk(HISTORY + 20));
    q = jumpTo(q, HISTORY + 18, { admit: true });
    const wasAt = activeIndex(q);
    q = appendOrder(q, [500, 501]);
    // The invariant: exactly HISTORY markets remain behind the reader.
    expect(activeIndex(q)).toBe(HISTORY);
    expect(wasAt).toBeGreaterThan(HISTORY);
    // History + the reader + what was already ahead + the page just added.
    expect(q.order.length).toBe(HISTORY + 1 + 2 + 2);
  });

  it("never drops the active market or anything ahead of it", () => {
    let q = initQueue(walk(HISTORY + 20));
    q = jumpTo(q, HISTORY + 10, { admit: true });
    q = appendOrder(q, [500]);
    expect(q.activeId).toBe(HISTORY + 10);
    // Everything the reader had left is still there, in the same sequence.
    const at = activeIndex(q);
    expect(q.order.slice(at + 1)).toEqual([...walk(HISTORY + 20).slice(HISTORY + 10), 500]);
  });

  it("keeps short queues completely intact", () => {
    const q = appendOrder(initQueue([1, 2, 3]), [4]);
    expect(q.order).toEqual([1, 2, 3, 4]);
  });

  /**
   * A forgotten market has to leave `appended` too, or the next commit would
   * faithfully restore the history this just spent effort forgetting.
   */
  it("forgets a paged market completely, so commit cannot resurrect it", () => {
    let q = initQueue(walk(HISTORY + 20));
    q = appendOrder(q, [500]);
    q = jumpTo(q, 500, { admit: true }); // walk to the very end
    q = appendOrder(q, [501, 502]);
    expect(q.order).not.toContain(1);
    // A commit that does NOT re-offer 1: if `appended` still remembered it, the
    // paged branch would put it back from memory alone.
    q = commit(receiveOrder(q, [800, 801]));
    expect(q.order).not.toContain(1);
    expect(q.order.slice(-2)).toEqual([800, 801]);
  });

  /**
   * A market the reader never saw is NOT history. Trimming forgets what is
   * behind them; if the base query still offers it, it is new supply and comes
   * back at the end like any other page.
   */
  it("re-admits a forgotten market the server still offers", () => {
    let q = initQueue(walk(HISTORY + 20));
    q = appendOrder(q, [500]);
    q = jumpTo(q, 500, { admit: true });
    q = appendOrder(q, [501]);
    expect(q.order).not.toContain(1);
    q = commit(receiveOrder(q, [1, 2]));
    expect(q.order.slice(-2)).toEqual([1, 2]);
  });

  /**
   * THE POINT OF ALL OF IT: the order stays inside the id cap the page request
   * is allowed to carry, so the server can exclude everything the client holds
   * and a resurfaced market is one the reader genuinely no longer has.
   */
  it("stays small enough for the whole order to be sent as queuedIds", () => {
    let q = initQueue(walk(48));
    for (let page = 0; page < 12; page += 1) {
      q = jumpTo(q, q.order[q.order.length - 1]!, { admit: true });
      q = appendOrder(
        q,
        Array.from({ length: 48 }, (_, i) => 1000 + page * 48 + i),
      );
      expect(q.order.length).toBeLessThanOrEqual(200);
    }
  });
});
