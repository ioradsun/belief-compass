import { describe, it, expect } from "vitest";
import {
  canAutoAdmit,
  groupArrivals,
  pendingCount,
  arrivalLabel,
  unseen,
  TAPE,
  type Arrival,
} from "./tape-arrivals";

const r = (id: string, marketId = "1", occurredAt = "2026-08-06T12:00:00Z"): Arrival => ({
  id,
  marketId,
  occurredAt,
});

describe("rows only enter unannounced when nobody is reading", () => {
  it("lets them straight in at the top with the pointer away", () => {
    expect(canAutoAdmit({ atTop: true, pointerInside: false })).toBe(true);
  });

  it("holds them when the reader has scrolled", () => {
    expect(canAutoAdmit({ atTop: false, pointerInside: false })).toBe(false);
  });

  it("holds them when the pointer is in the tape, even at the top", () => {
    expect(canAutoAdmit({ atTop: true, pointerInside: true })).toBe(false);
  });

  it("holds them when both say someone is there", () => {
    expect(canAutoAdmit({ atTop: false, pointerInside: true })).toBe(false);
  });
});

/**
 * Twelve trades in one market inside three seconds is one thing happening. The
 * count is of GROUPS so the banner cannot promise eight and deliver thirty.
 */
describe("one update per market", () => {
  it("keeps the newest row for a market and drops the rest", () => {
    const rows = [r("c", "7"), r("b", "7"), r("a", "7")];
    expect(groupArrivals(rows).map((x) => x.id)).toEqual(["c"]);
  });

  it("preserves input order across markets", () => {
    const rows = [r("a", "1"), r("b", "2"), r("c", "1"), r("d", "3")];
    expect(groupArrivals(rows).map((x) => x.id)).toEqual(["a", "b", "d"]);
  });

  it("counts the groups, not the events", () => {
    const burst = [r("a", "1"), r("b", "1"), r("c", "1"), r("d", "2")];
    expect(burst).toHaveLength(4);
    expect(pendingCount(burst)).toBe(2);
  });

  /** Rows with no market are not market activity; collapsing them would merge
      unrelated things into one. */
  it("never groups rows that have no market", () => {
    const rows = [r("a", ""), r("b", ""), r("c", "")];
    expect(groupArrivals(rows).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("says nothing about an empty batch", () => {
    expect(pendingCount([])).toBe(0);
    expect(groupArrivals([])).toEqual([]);
  });
});

describe("the banner counts in words a person would use", () => {
  it("keeps the singular honest", () => {
    expect(arrivalLabel(1)).toBe("1 New");
  });

  it("counts plainly in the middle", () => {
    expect(arrivalLabel(8)).toBe("8 New");
    expect(arrivalLabel(25)).toBe("25 New");
  });

  it("stops counting past the cap rather than printing a number nobody reads", () => {
    expect(arrivalLabel(TAPE.displayCap)).toBe("99 New");
    expect(arrivalLabel(TAPE.displayCap + 1)).toBe("99+ New");
    expect(arrivalLabel(4_000)).toBe("99+ New");
  });

  it("does not invent a count from nonsense", () => {
    expect(arrivalLabel(0)).toBe("0 New");
    expect(arrivalLabel(-3)).toBe("0 New");
  });
});

/**
 * The query merges onto an immutable tail, so a refetch returns rows already on
 * screen. Counting the response rather than the difference would announce the
 * whole tape every time the socket reconnected.
 */
describe("only what the reader has not already seen is announced", () => {
  it("ignores rows already visible", () => {
    const visible = new Set(["a", "b"]);
    expect(unseen([r("a"), r("b"), r("c")], visible).map((x) => x.id)).toEqual(["c"]);
  });

  it("announces nothing when a refetch returns the same rows", () => {
    const visible = new Set(["a", "b", "c"]);
    expect(unseen([r("a"), r("b"), r("c")], visible)).toEqual([]);
  });

  it("announces everything on a first load into an empty tape", () => {
    expect(unseen([r("a"), r("b")], new Set()).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

/**
 * The batch window has to sit above the coordinator's activity throttle, or a
 * steady stream of trades produces one counter change per batch — which is the
 * twitching the window exists to prevent.
 */
describe("the batching window is calmer than the event stream", () => {
  it("is longer than the 1.5s activity throttle it coalesces", () => {
    expect(TAPE.batchMs).toBeGreaterThan(1_500);
  });

  it("is still short enough to feel live", () => {
    expect(TAPE.batchMs).toBeLessThanOrEqual(3_000);
  });
});
