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
