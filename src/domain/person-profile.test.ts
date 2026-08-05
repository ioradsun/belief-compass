import { describe, it, expect } from "vitest";
import {
  definingConvictions,
  introduction,
  connection,
  exploreThrough,
  tenureText,
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

describe("what connects you is a pattern, not a percentage", () => {
  it("never produces a similarity score", () => {
    const c = connection({
      sharedMarkets: 18,
      together: 12,
      apart: 6,
      alignedTopics: ["technology"],
      opposedTopics: ["economics"],
    });
    expect(c.lines.join(" ")).not.toMatch(/%|percent|match|compatib/i);
  });

  it("names both the agreement and the difference", () => {
    const c = connection({
      sharedMarkets: 18,
      together: 12,
      apart: 6,
      alignedTopics: ["technology", "entrepreneurship"],
      opposedTopics: ["economics"],
    });
    expect(c.lines[0]).toBe("You have taken a side in 18 of the same markets.");
    expect(c.lines[1]).toBe(
      "You often agree on technology and entrepreneurship, and reach different conclusions on economics.",
    );
  });

  it("admits when there is not enough overlap to say anything", () => {
    const c = connection({
      sharedMarkets: 2,
      together: 2,
      apart: 0,
      alignedTopics: [],
      opposedTopics: [],
    });
    expect(c.provisional).toBe(true);
    expect(c.lines[0]).toMatch(/not enough yet to see a pattern/);
  });

  it("says so plainly when you have never overlapped", () => {
    const c = connection({
      sharedMarkets: 0,
      together: 0,
      apart: 0,
      alignedTopics: [],
      opposedTopics: [],
    });
    expect(c.lines[0]).toBe("You have not taken a side in any of the same markets yet.");
  });

  it("contrasts holding behaviour, which an agreement count cannot show", () => {
    const longer = connection({
      sharedMarkets: 10,
      together: 8,
      apart: 2,
      alignedTopics: [],
      opposedTopics: [],
      viewerMedianDays: 20,
      personMedianDays: 90,
    });
    expect(longer.lines).toContain("They tend to hold their positions longer than you do.");
  });

  it("says nothing about holding when the two are similar", () => {
    const same = connection({
      sharedMarkets: 10,
      together: 8,
      apart: 2,
      alignedTopics: [],
      opposedTopics: [],
      viewerMedianDays: 30,
      personMedianDays: 33,
    });
    expect(same.lines.join(" ")).not.toMatch(/hold their positions|hold your positions/);
  });
});

describe("every market offered explains itself", () => {
  const defining = definingConvictions([
    pos({ marketId: 1, valueUsd: 5000, title: "Biggest" }),
    pos({ marketId: 2, valueUsd: 10, daysHeld: 400, title: "Oldest" }),
  ]);

  it("leads with disagreement — the most useful thing a person offers", () => {
    const out = exploreThrough(defining, {
      agreed: [{ marketId: 8, title: "Agreed" }],
      opposed: [{ marketId: 9, title: "Split", personSide: "NO", viewerSide: "YES" }],
    });
    expect(out[0]).toMatchObject({
      marketId: 9,
      reason: "you_differ",
      why: "You back YES here, they back NO.",
    });
  });

  it("gives every row a reason in the person's terms", () => {
    const out = exploreThrough(defining, { agreed: [], opposed: [] });
    for (const s of out) expect(s.why.length).toBeGreaterThan(0);
    expect(out.map((s) => s.why)).toContain("Their largest current position.");
  });

  it("never says 'recommended for you' or anything like it", () => {
    const out = exploreThrough(defining, {
      agreed: [{ marketId: 8, title: "Agreed" }],
      opposed: [{ marketId: 9, title: "Split", personSide: "NO", viewerSide: "YES" }],
    });
    for (const s of out) {
      expect(s.why).not.toMatch(/recommended|you may|similar market|trending for you/i);
    }
  });

  it("shows one market once even when several reasons apply", () => {
    const out = exploreThrough(defining, {
      agreed: [{ marketId: 1, title: "Biggest" }],
      opposed: [{ marketId: 1, title: "Biggest", personSide: "NO", viewerSide: "YES" }],
    });
    expect(out.filter((s) => s.marketId === 1)).toHaveLength(1);
  });

  it("returns fewer rows rather than padding with a vague one", () => {
    expect(exploreThrough([], { agreed: [], opposed: [] })).toEqual([]);
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
