import { describe, it, expect } from "vitest";
import {
  availableModes,
  admits,
  modeRank,
  orderForMode,
  toFeedMode,
  qualifies,
  MODE_TUNING,
  type ModeCandidate,
} from "./mode";

const c = (o: Partial<ModeCandidate> & { onchainId: number }): ModeCandidate => ({
  score: 50,
  tribeCount: 0,
  oppCount: 0,
  tribeOverlap: 0,
  oppOverlap: 0,
  recencyHours: 100,
  ...o,
});

const person = (evidenceLevel: "insufficient" | "early" | "growing" | "established") => ({
  evidenceLevel,
});

describe("a mode is only offered when it can be filled", () => {
  it("always offers For You — it is the one that works with no network", () => {
    expect(availableModes({ aligned: [], opposed: [] })).toEqual(["for_you"]);
  });

  it("withholds Tribe until enough qualified people exist", () => {
    const one = availableModes({ aligned: [person("established")], opposed: [] });
    expect(one).not.toContain("tribe");
    const two = availableModes({
      aligned: [person("established"), person("early")],
      opposed: [],
    });
    expect(two).toContain("tribe");
  });

  it("does not count relationships DNA has not established", () => {
    // Four people at "insufficient" is four coincidences, not a Tribe.
    const weak = Array.from({ length: 4 }, () => person("insufficient"));
    expect(availableModes({ aligned: weak, opposed: weak })).toEqual(["for_you"]);
  });

  it("seats the two sides independently", () => {
    const modes = availableModes({
      aligned: [],
      opposed: [person("growing"), person("growing")],
    });
    expect(modes).toEqual(["for_you", "rivals"]);
  });

  it("agrees with its own threshold", () => {
    expect(qualifies(MODE_TUNING.minEvidence)).toBe(true);
    expect(qualifies("insufficient")).toBe(false);
  });
});

describe("what each mode will show at all", () => {
  it("Tribe needs someone you align with present", () => {
    expect(admits("tribe", c({ onchainId: 1, tribeCount: 1 }))).toBe(true);
    expect(admits("tribe", c({ onchainId: 1, oppCount: 3 }))).toBe(false);
  });

  it("Rivals needs someone opposed present", () => {
    expect(admits("rivals", c({ onchainId: 1, oppCount: 1 }))).toBe(true);
    expect(admits("rivals", c({ onchainId: 1, tribeCount: 3 }))).toBe(false);
  });

  it("For You admits everything — it is a blend, not a filter", () => {
    expect(admits("for_you", c({ onchainId: 1 }))).toBe(true);
  });
});

/**
 * The decision this module exists to enforce. Ranking rivals by how HARD they
 * disagree is ranking for conflict; it surfaces the extreme stranger over the
 * person who has actually been across the table from you eight times.
 */
describe("Rivals ranks by shared attention, not by disagreement magnitude", () => {
  it("prefers a rival you have met often over one you have met once", () => {
    const familiar = c({ onchainId: 1, oppCount: 1, oppOverlap: 20 });
    const stranger = c({ onchainId: 2, oppCount: 1, oppOverlap: 1 });
    expect(modeRank("rivals", familiar)).toBeGreaterThan(modeRank("rivals", stranger));
  });

  it("prefers depth with one rival over breadth with several shallow ones", () => {
    const deep = c({ onchainId: 1, oppCount: 1, oppOverlap: 30 });
    const crowded = c({ onchainId: 2, oppCount: 4, oppOverlap: 4 });
    expect(modeRank("rivals", deep)).toBeGreaterThan(modeRank("rivals", crowded));
  });

  it("still lets a dead market lose to a live one", () => {
    // Otherwise the mode leads with a market that has one of your rivals in it
    // and nothing else — a relationship is a reason to look, not a reason to act.
    const dead = c({ onchainId: 1, oppCount: 2, oppOverlap: 10, score: 0, recencyHours: 24 * 30 });
    const alive = c({ onchainId: 2, oppCount: 2, oppOverlap: 10, score: 95, recencyHours: 2 });
    expect(modeRank("rivals", alive)).toBeGreaterThan(modeRank("rivals", dead));
  });
});

describe("Tribe leads with how many of your people are here", () => {
  it("prefers more of your people to fewer", () => {
    const many = c({ onchainId: 1, tribeCount: 4 });
    const one = c({ onchainId: 2, tribeCount: 1 });
    expect(modeRank("tribe", many)).toBeGreaterThan(modeRank("tribe", one));
  });

  it("saturates, so one crowded market cannot dwarf everything", () => {
    const four = modeRank("tribe", c({ onchainId: 1, tribeCount: 4 }));
    const forty = modeRank("tribe", c({ onchainId: 2, tribeCount: 40 }));
    const one = modeRank("tribe", c({ onchainId: 3, tribeCount: 1 }));
    expect(forty - four).toBeLessThan(four - one);
  });

  it("prefers recent activity to old", () => {
    const today = c({ onchainId: 1, tribeCount: 2, recencyHours: 3 });
    const lastMonth = c({ onchainId: 2, tribeCount: 2, recencyHours: 24 * 30 });
    expect(modeRank("tribe", today)).toBeGreaterThan(modeRank("tribe", lastMonth));
  });
});

describe("ordering", () => {
  it("For You keeps the ranker's own sequence untouched", () => {
    const list = [c({ onchainId: 1 }), c({ onchainId: 2 }), c({ onchainId: 3 })];
    expect(orderForMode("for_you", list).map((x) => x.onchainId)).toEqual([1, 2, 3]);
  });

  it("drops what a mode does not admit", () => {
    const list = [
      c({ onchainId: 1, tribeCount: 2 }),
      c({ onchainId: 2 }),
      c({ onchainId: 3, tribeCount: 1 }),
    ];
    expect(orderForMode("tribe", list).map((x) => x.onchainId)).toEqual([1, 3]);
  });

  it("is stable — an exact tie keeps the sequence the ranker chose", () => {
    const list = [
      c({ onchainId: 7, tribeCount: 1 }),
      c({ onchainId: 3, tribeCount: 1 }),
      c({ onchainId: 5, tribeCount: 1 }),
    ];
    expect(orderForMode("tribe", list).map((x) => x.onchainId)).toEqual([7, 3, 5]);
  });

  it("can legitimately return nothing — an empty Tribe feed is a true answer", () => {
    expect(orderForMode("tribe", [c({ onchainId: 1 })])).toEqual([]);
  });
});

describe("reading a mode off a URL", () => {
  it("accepts the three it knows", () => {
    expect(toFeedMode("tribe")).toBe("tribe");
    expect(toFeedMode("rivals")).toBe("rivals");
    expect(toFeedMode("for_you")).toBe("for_you");
  });

  it("defaults rather than throwing on anything else", () => {
    // Old links carry `?lens=hot`; they must land somewhere real, not error.
    for (const junk of ["hot", "", null, undefined, 7, {}]) {
      expect(toFeedMode(junk)).toBe("for_you");
    }
  });
});
