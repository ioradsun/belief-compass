import { describe, it, expect } from "vitest";
import {
  definingConvictions,
  tenureText,
  convictionMap,
  allConvictions,
  ELSEWHERE,
  PROFILE,
  type PersonPosition,
  type SideChange,
} from "./person-profile";

const pos = (o: Partial<PersonPosition> & { marketId: number }): PersonPosition => ({
  title: `Market ${o.marketId}`,
  side: "YES",
  valueUsd: 100,
  daysHeld: 10,
  tenureIsFloor: false,
  crowdYesPct: 50,
  participants: 20,
  category: "crypto",
  ...o,
});

/** Four positions — the minimum this module will call a pattern. */
const enough = (over: Partial<PersonPosition> = {}) =>
  [1, 2, 3, 4].map((id) => pos({ marketId: id, ...over }));

describe("the convictions that define someone", () => {
  it("leads with where they have put the most", () => {
    const d = definingConvictions([
      pos({ marketId: 1, valueUsd: 120 }),
      pos({ marketId: 2, valueUsd: 4820, title: "Will Bitcoin surpass gold by 2035?" }),
    ]);
    expect(d[0]).toMatchObject({
      kind: "largest",
      marketId: 2,
      detail: "Backing YES · $4,820 committed",
    });
  });

  it("names the longest hold, and keeps the floor marker on an unknown start", () => {
    const d = definingConvictions([
      pos({ marketId: 1, valueUsd: 900 }),
      pos({ marketId: 2, valueUsd: 10, daysHeld: 642, tenureIsFloor: true }),
    ]);
    expect(d.find((x) => x.kind === "longest")?.detail).toBe("Backing YES for 642+ days");
  });

  it("shows one market once — the first heading that claims it wins", () => {
    // Largest AND longest AND contrarian, all the same position.
    const d = definingConvictions([
      pos({ marketId: 7, valueUsd: 5000, daysHeld: 400, crowdYesPct: 5 }),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("largest");
  });

  it("does not call a short hold an endurance story", () => {
    const d = definingConvictions([
      pos({ marketId: 1, valueUsd: 500 }),
      pos({ marketId: 2, valueUsd: 10, daysHeld: PROFILE.minDaysForLongest - 1 }),
    ]);
    expect(d.some((x) => x.kind === "longest")).toBe(false);
  });
});

/**
 * "Against the crowd" is the claim most easily faked by small numbers: with
 * three participants everyone is a contrarian.
 */
describe("standing apart needs a crowd to stand apart from", () => {
  it("names it when the room is genuinely lopsided", () => {
    const d = definingConvictions([
      pos({ marketId: 1, valueUsd: 0, side: "NO", crowdYesPct: 84, participants: 50 }),
    ]);
    expect(d[0]).toMatchObject({
      kind: "contrarian",
      detail: "Backing NO while 84% of participants back YES",
    });
  });

  it("refuses when there are too few people to be a room", () => {
    const d = definingConvictions([
      pos({
        marketId: 1,
        valueUsd: 0,
        side: "NO",
        crowdYesPct: 95,
        participants: PROFILE.minParticipantsForCrowd - 1,
      }),
    ]);
    expect(d.some((x) => x.kind === "contrarian")).toBe(false);
  });

  it("refuses when the room has not really picked a side", () => {
    const d = definingConvictions([
      pos({ marketId: 1, valueUsd: 0, side: "NO", crowdYesPct: 55, participants: 100 }),
    ]);
    expect(d.some((x) => x.kind === "contrarian")).toBe(false);
  });

  it("says nothing at all when the crowd is unknown", () => {
    const d = definingConvictions([
      pos({ marketId: 1, valueUsd: 0, crowdYesPct: null, participants: 100 }),
    ]);
    expect(d).toEqual([]);
  });
});

describe("a change of mind is recorded, never inferred", () => {
  const change: SideChange = {
    marketId: 9,
    title: "Is remote work better?",
    from: "YES",
    to: "NO",
    occurredAt: "2026-08-01T00:00:00Z",
  };

  it("states what changed and not why", () => {
    const d = definingConvictions([], [change]);
    expect(d[0]).toMatchObject({
      kind: "changed_mind",
      detail: "Previously backed YES. Now backs NO",
    });
    // No motive, no evidence-of-mind, no "after new information".
    expect(d[0].detail).not.toMatch(/because|after|realis|decid|reconsider/i);
  });

  it("appears only when the events log recorded one", () => {
    expect(
      definingConvictions([pos({ marketId: 1 })], []).some((x) => x.kind === "changed_mind"),
    ).toBe(false);
  });
});


describe("tenure never overclaims", () => {
  it("marks a floor", () => {
    expect(tenureText(512, true)).toBe("512+ days");
    expect(tenureText(512, false)).toBe("512 days");
  });
  it("keeps the singular honest", () => {
    expect(tenureText(1, false)).toBe("1 day");
  });
});

// ── V2 ───────────────────────────────────────────────────────────────────────


describe("their conviction map", () => {
  const map = (list: PersonPosition[]) => convictionMap(list).map((t) => t.theme);

  it("groups by theme, biggest theme first", () => {
    const list = [
      pos({ marketId: 1, category: "culture" }),
      pos({ marketId: 2, category: "culture" }),
      pos({ marketId: 3, category: "culture" }),
      pos({ marketId: 4, category: "crypto" }),
      pos({ marketId: 5, category: "crypto" }),
    ];
    expect(map(list)).toEqual(["culture", "crypto"]);
  });

  /** Nine headings of one item is a list wearing a map's clothes. */
  it("collects the long tail rather than making a heading per market", () => {
    const list = [
      pos({ marketId: 1, category: "crypto" }),
      pos({ marketId: 2, category: "crypto" }),
      pos({ marketId: 3, category: "sports" }),
      pos({ marketId: 4, category: "politics" }),
      pos({ marketId: 5, category: null }),
    ];
    const out = convictionMap(list);
    expect(out.map((t) => t.theme)).toEqual(["crypto", ELSEWHERE]);
    expect(out[1].total).toBe(3);
  });

  it("leads each theme with the biggest commitment", () => {
    const list = [
      pos({ marketId: 1, valueUsd: 10 }),
      pos({ marketId: 2, valueUsd: 900 }),
      pos({ marketId: 3, valueUsd: 50 }),
    ];
    expect(convictionMap(list)[0].positions.map((p) => p.marketId)).toEqual([2, 3, 1]);
  });

  it("keeps the true total when a theme is truncated", () => {
    const many = Array.from({ length: 9 }, (_, i) => pos({ marketId: i + 1 }));
    const [theme] = convictionMap(many);
    expect(theme.positions).toHaveLength(PROFILE.maxPerTheme);
    expect(theme.total).toBe(9);
  });

  it("says nothing about someone holding nothing", () => {
    expect(convictionMap([])).toEqual([]);
  });
});


/**
 * The map interprets; this does not. A visitor who suspects the highlights were
 * cherry picked has to be able to check, or the highlights are worth nothing.
 */
describe("all convictions", () => {
  it("returns every position, filtering nothing", () => {
    const list = [
      pos({ marketId: 1, valueUsd: 0, daysHeld: 0, participants: 0 }),
      pos({ marketId: 2, valueUsd: 900 }),
      pos({ marketId: 3, category: null }),
    ];
    expect(allConvictions(list)).toHaveLength(3);
  });

  it("leads with the biggest commitment, then the longest held", () => {
    const list = [
      pos({ marketId: 1, valueUsd: 10, daysHeld: 5 }),
      pos({ marketId: 2, valueUsd: 900 }),
      pos({ marketId: 3, valueUsd: 10, daysHeld: 400 }),
    ];
    expect(allConvictions(list).map((p) => p.marketId)).toEqual([2, 3, 1]);
  });

  it("is stable when everything ties", () => {
    const list = [pos({ marketId: 5 }), pos({ marketId: 2 }), pos({ marketId: 9 })];
    expect(allConvictions(list).map((p) => p.marketId)).toEqual([2, 5, 9]);
  });

  /** The map is allowed to truncate only because this cannot. */
  it("holds everything the map dropped", () => {
    const many = Array.from({ length: 20 }, (_, i) => pos({ marketId: i + 1 }));
    const inMap = new Set(convictionMap(many).flatMap((t) => t.positions.map((p) => p.marketId)));
    const inAll = new Set(allConvictions(many).map((p) => p.marketId));
    expect(inMap.size).toBeLessThan(many.length);
    expect(inAll.size).toBe(many.length);
    for (const id of inMap) expect(inAll.has(id)).toBe(true);
  });

  it("says nothing about someone holding nothing", () => {
    expect(allConvictions([])).toEqual([]);
  });
});
