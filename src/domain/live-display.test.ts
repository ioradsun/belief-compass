import { describe, it, expect } from "vitest";
import {
  arrangeFeed,
  dueForFullRebuild,
  orderForDisplay,
  tailState,
  FULL_REBUILD_MS,
  type DisplayRow,
} from "./live-display";

/** A timed row `n` hours ago. */
const row = (id: string, hoursAgo: number, extra: Partial<DisplayRow> = {}): DisplayRow => ({
  id,
  occurredAt: new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - hoursAgo * 3_600_000).toISOString(),
  ...extra,
});

const standing = (id: string): DisplayRow => ({
  id,
  occurredAt: new Date(0).toISOString(),
  timeless: true,
});

describe("orderForDisplay", () => {
  it("renders newest-first regardless of input order", () => {
    const out = orderForDisplay([row("a", 1), row("c", 14), row("b", 6)]);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("puts timeless continuity first, keeping its input order", () => {
    const out = orderForDisplay([
      row("t28m", 0.47),
      standing("s1"),
      row("t14h", 14),
      standing("s2"),
    ]);
    expect(out.map((r) => r.id)).toEqual(["s1", "s2", "t28m", "t14h"]);
  });

  it("fixes the jumbled admit order into a coherent timeline", () => {
    // The exact symptom: admit-to-top produced 15h, 28m, 13m, 45m, 14h…
    const jumbled = [
      row("15h", 15),
      row("28m", 0.47),
      row("13m", 0.22),
      row("45m", 0.75),
      row("14h", 14),
    ];
    const out = orderForDisplay(jumbled).map((r) => r.id);
    expect(out).toEqual(["13m", "28m", "45m", "14h", "15h"]);
  });
});

describe("arrangeFeed", () => {
  it("shows everything, newest-first, when the window is not exceeded", () => {
    const rows = [row("a", 1), row("b", 6), row("c", 3)];
    const { shown, hidden } = arrangeFeed(rows, { limit: 40 });
    expect(hidden).toBe(0);
    expect(shown.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("selects the best-ranked rows for the window, then displays them chronologically", () => {
    // Five rows; window of 2. Rank says d then b are best; display is by time.
    const rows = [row("a", 1), row("b", 10), row("c", 2), row("d", 8), row("e", 3)];
    const rankOrder = ["d", "b", "a", "c", "e"];
    const rankOf = (id: string) => rankOrder.indexOf(id);
    const { shown, hidden } = arrangeFeed(rows, { rankOf, limit: 2 });
    // Chosen by rank: d, b. Displayed newest-first: d (8h) is newer than b (10h).
    expect(shown.map((r) => r.id)).toEqual(["d", "b"]);
    expect(hidden).toBe(3);
  });

  it("never drops rows — hidden is exactly what the reveal will surface", () => {
    const rows = Array.from({ length: 55 }, (_, i) => row(`r${i}`, i));
    const { shown, hidden } = arrangeFeed(rows, { limit: 40 });
    expect(shown).toHaveLength(40);
    expect(hidden).toBe(15);
    // Revealing more recovers the rest — nothing is lost.
    const more = arrangeFeed(rows, { limit: 40 + 30 });
    expect(more.hidden).toBe(0);
    expect(more.shown).toHaveLength(55);
  });

  it("falls back to newest-first selection when there is no ranking", () => {
    const rows = [row("old", 20), row("mid", 10), row("new", 1)];
    const { shown, hidden } = arrangeFeed(rows, { limit: 2 });
    expect(shown.map((r) => r.id)).toEqual(["new", "mid"]);
    expect(hidden).toBe(1);
  });

  it("always keeps timeless facts and never counts them against the window", () => {
    const rows = [standing("s1"), row("a", 1), row("b", 5), row("c", 9)];
    const { shown, hidden } = arrangeFeed(rows, { limit: 1 });
    // The one standing fact plus the single newest timed row.
    expect(shown.map((r) => r.id)).toEqual(["s1", "a"]);
    // Two timed rows are still waiting; the timeless one was never in the count.
    expect(hidden).toBe(2);
  });

  it("treats an unranked row as worst, not as rank 0", () => {
    const rows = [row("ranked", 2), row("unranked", 1)];
    const rankOf = (id: string) => (id === "ranked" ? 0 : undefined);
    const { shown } = arrangeFeed(rows, { rankOf, limit: 1 });
    expect(shown.map((r) => r.id)).toEqual(["ranked"]);
  });
});

describe("dueForFullRebuild", () => {
  it("is due the first time (never fetched — lastFullAt 0 against a real clock)", () => {
    expect(dueForFullRebuild(0, Date.now())).toBe(true);
  });

  it("stays on the delta path until the cadence elapses", () => {
    const last = 100_000;
    expect(dueForFullRebuild(last, last + FULL_REBUILD_MS - 1)).toBe(false);
    expect(dueForFullRebuild(last, last + FULL_REBUILD_MS)).toBe(true);
  });
});

describe("tailState", () => {
  it("offers older rows when the window hides some", () => {
    expect(tailState({ shown: 40, hidden: 5, pending: 0 })).toBe("more");
  });

  it("stays quiet at the tail while arrivals wait up top", () => {
    expect(tailState({ shown: 40, hidden: 0, pending: 3 })).toBe("streaming");
  });

  it("stays quiet while a fetch is in flight", () => {
    expect(tailState({ shown: 40, hidden: 0, pending: 0, loading: true })).toBe("streaming");
  });

  it("says 'caught up' only when nothing is new AND nothing is hidden", () => {
    expect(tailState({ shown: 12, hidden: 0, pending: 0 })).toBe("caught_up");
  });

  it("reports empty when there is nothing at all", () => {
    expect(tailState({ shown: 0, hidden: 0, pending: 0 })).toBe("empty");
  });

  it("prefers 'more' over everything — an offer beats a terminal state", () => {
    expect(tailState({ shown: 40, hidden: 2, pending: 5, loading: true })).toBe("more");
  });
});

/**
 * THE TAP MUST CHANGE THE TOP OF THE COLUMN.
 *
 * "Updates, no matter what" — a row the reader explicitly asked for leads the
 * whole list. It does not queue behind the standing/continuity block, and it is
 * not sorted into the timeline by its own timestamp.
 */
describe("arrangeFeed — asked-for rows", () => {
  it("puts requested rows above the timeline, however old they are", () => {
    const out = arrangeFeed([row("new", 30), row("a", 1), row("b", 2)], {
      limit: 10,
      pinned: new Set(["new"]),
    });
    expect(out.shown.map((r) => r.id)).toEqual(["new", "a", "b"]);
  });

  it("puts requested rows above continuity, not below it", () => {
    const out = arrangeFeed([standing("s1"), standing("s2"), row("new", 3), row("a", 1)], {
      limit: 10,
      pinned: new Set(["new"]),
    });
    expect(out.shown[0]?.id).toBe("new");
    expect(out.shown.map((r) => r.id)).toEqual(["new", "s1", "s2", "a"]);
  });

  it("lifts a requested row out of the continuity block when it is itself timeless", () => {
    const out = arrangeFeed([standing("s1"), standing("s2"), row("a", 1)], {
      limit: 10,
      pinned: new Set(["s2"]),
    });
    expect(out.shown.map((r) => r.id)).toEqual(["s2", "s1", "a"]);
  });

  it("never lets the mixer's window select a requested row out", () => {
    const rows = [row("new", 50), row("a", 1), row("b", 2), row("c", 3)];
    const out = arrangeFeed(rows, {
      limit: 2,
      // The requested row is the WORST ranked story in the pool.
      rankOf: (id) => ({ a: 0, b: 1, c: 2, new: 99 })[id],
      pinned: new Set(["new"]),
    });
    expect(out.shown.map((r) => r.id)).toEqual(["new", "a"]);
    expect(out.hidden).toBe(2);
  });

  it("orders several requested rows newest-first among themselves", () => {
    const out = arrangeFeed([row("older", 9), row("newer", 1), row("x", 4)], {
      limit: 10,
      pinned: new Set(["older", "newer"]),
    });
    expect(out.shown.map((r) => r.id)).toEqual(["newer", "older", "x"]);
  });
});
