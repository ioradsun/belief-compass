import { describe, it, expect } from "vitest";
import {
  definingConvictions,
  introduction,
  tenureText,
  whyFollow,
  convictionMap,
  sharedCuriosity,
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

describe("the introduction never invents a person", () => {
  it("says the story is still forming rather than guessing", () => {
    const intro = introduction([pos({ marketId: 1 }), pos({ marketId: 2 })]);
    expect(intro.provisional).toBe(true);
    expect(intro.lines[0]).toBe("Their conviction story is still taking shape.");
    expect(intro.lines[1]).toBe("They have taken a side in 2 markets so far.");
  });

  it("handles someone with nothing at all", () => {
    expect(introduction([]).lines[1]).toBe("They have not taken a side in a market yet.");
  });

  it("describes where their convictions sit, not who they are", () => {
    const intro = introduction(enough({ category: "crypto" }));
    expect(intro.provisional).toBe(false);
    expect(intro.lines[0]).toBe("Most of their convictions sit in crypto.");
  });

  it("says spread when there is no concentration", () => {
    const spread = ["crypto", "politics", "sports", "culture", "ai"].map((category, i) =>
      pos({ marketId: i + 1, category }),
    );
    expect(introduction(spread).lines[0]).toMatch(/without concentrating in one/);
  });

  it("claims a trait only with more than one instance behind it", () => {
    const oneLongHold = enough().map((p, i) => ({ ...p, daysHeld: i === 0 ? 200 : 3 }));
    expect(introduction(oneLongHold).lines).toHaveLength(1);
  });

  it("counts the long holds it claims", () => {
    const twoLongHolds = enough().map((p, i) => ({ ...p, daysHeld: i < 2 ? 200 : 3 }));
    expect(introduction(twoLongHolds).lines[1]).toBe(
      "2 of their positions have been held for more than three months.",
    );
  });

  it("never uses the vocabulary of a personality test", () => {
    const all = [
      ...introduction(enough()).lines,
      ...introduction([]).lines,
      ...introduction(enough().map((p) => ({ ...p, side: "NO" as const, crowdYesPct: 90 }))).lines,
    ].join(" ");
    expect(all).not.toMatch(/believes|feels|wants|thinks that|expert|bull|bear|contrarian|smart/i);
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

/**
 * The distinction the whole section rests on: a reason to follow describes what
 * will arrive in your feed, never how well this person has done.
 */
describe("why follow them", () => {
  it("says what following surfaces, from where their convictions sit", () => {
    const r = whyFollow(enough({ category: "technology" }));
    expect(r[0]).toEqual({
      kind: "topic",
      headline: "Follow them for technology.",
      evidence: "4 of their 4 current convictions sit there.",
    });
  });

  it("describes breadth when nothing concentrates", () => {
    const spread = [
      pos({ marketId: 1, category: "crypto" }),
      pos({ marketId: 2, category: "sports" }),
      pos({ marketId: 3, category: "politics" }),
      pos({ marketId: 4, category: "culture" }),
    ];
    expect(whyFollow(spread)[0]).toEqual({
      kind: "broad",
      headline: "Their curiosity ranges widely.",
      evidence: "They hold convictions across 4 different topics.",
    });
  });

  it("never claims returns, rank, profit or followers", () => {
    const rich = enough({ daysHeld: 200, crowdYesPct: 5, participants: 40, daysAfterOpen: 1 });
    const all = whyFollow(rich, { marketsCreated: 3 })
      .flatMap((r) => [r.headline, r.evidence])
      .join(" ");
    // Word boundaries, or "following" trips a bare /win/ and the assertion
    // starts failing on copy that is perfectly fine.
    expect(all).not.toMatch(
      /\b(returns?|profit|ranked?|top|best|wins?|winning|followers?|success(ful)?)\b/i,
    );
  });

  it("carries the count behind every claim", () => {
    const patient = enough({ daysHeld: 200 });
    const line = whyFollow(patient).find((r) => r.kind === "patient");
    expect(line?.headline).toBe("Stays with their strongest convictions.");
    expect(line?.evidence).toBe("4 positions have been held for more than three months.");
  });

  it("caps at three, so it reads as a person and not a pitch", () => {
    const everything = enough({
      daysHeld: 200,
      crowdYesPct: 2,
      participants: 40,
      daysAfterOpen: 1,
      category: "technology",
    });
    expect(whyFollow(everything, { marketsCreated: 9 })).toHaveLength(PROFILE.maxFollowReasons);
  });

  /**
   * A belief that predates the index has no knowable start, so counting it as
   * "arrived early" would turn "we cannot tell" into evidence.
   */
  it("only counts early entries where the timing is knowable", () => {
    const unknowable = enough({ daysAfterOpen: null, tenureIsFloor: true });
    expect(whyFollow(unknowable).some((r) => r.kind === "early")).toBe(false);

    const known = enough({ daysAfterOpen: 2 });
    const early = whyFollow(known).find((r) => r.kind === "early");
    expect(early?.headline).toBe("Often finds markets early.");
    expect(early?.evidence).toBe("Joined 4 of 4 within a week of the market opening.");
  });

  it("claims nothing at all from too few positions", () => {
    expect(whyFollow([pos({ marketId: 1 }), pos({ marketId: 2 })])).toEqual([]);
  });

  it("but still credits an author with no positions to speak of", () => {
    const r = whyFollow([pos({ marketId: 1 })], { marketsCreated: 4 });
    expect(r).toEqual([
      {
        kind: "author",
        headline: "They write questions, not just answer them.",
        evidence: "4 of the markets here are theirs.",
      },
    ]);
  });
});

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

describe("markets you both care about", () => {
  const m = (id: number, v: "YES" | "NO", p: "YES" | "NO") => ({
    marketId: id,
    title: `Market ${id}`,
    viewerSide: v,
    personSide: p,
  });

  /** A page ordered by agreement teaches nobody anything they did not believe. */
  it("leads with disagreement", () => {
    const rows = sharedCuriosity([m(1, "YES", "YES")], [m(2, "YES", "NO")]);
    expect(rows.map((r) => r.marketId)).toEqual([2, 1]);
  });

  it("carries both sides on every row, not a verdict", () => {
    const [row] = sharedCuriosity([], [m(1, "NO", "YES")]);
    expect(row).toEqual({
      marketId: 1,
      title: "Market 1",
      viewerSide: "NO",
      personSide: "YES",
      agree: false,
    });
  });

  it("caps the list rather than printing forty rows at equal weight", () => {
    const agreed = Array.from({ length: 30 }, (_, i) => m(i + 1, "YES", "YES"));
    expect(sharedCuriosity(agreed, [], 6)).toHaveLength(6);
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
