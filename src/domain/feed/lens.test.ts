import { describe, it, expect } from "vitest";
import {
  LENSES,
  LENS_LABELS,
  admits,
  freshLabel,
  heroMetric,
  isDirectional,
  lensHero,
  lensRank,
  orderForLens,
  scaleLine,
  toLens,
  type Lens,
  type LensCandidate,
} from "./lens";

const c = (over: Partial<LensCandidate> & { onchainId: number }): LensCandidate => ({
  capitalUsd: 0,
  believers: 0,
  createdAtMs: null,
  momentumWeight: 0,
  moving: false,
  score: 50,
  ...over,
});

describe("the five lenses", () => {
  it("puts the personal question first", () => {
    expect(LENSES[0]).toBe("for_you");
    expect(LENSES).toHaveLength(5);
  });

  it("names every one of them", () => {
    for (const l of LENSES) expect(LENS_LABELS[l]).toBeTruthy();
  });

  it("falls back rather than throwing on an unknown value", () => {
    // A saved link, an older client, or a crafted request must never empty the
    // feed — the same rule `toFeedMode` follows.
    expect(toLens("capital")).toBe("capital");
    expect(toLens("hot")).toBe("for_you");
    expect(toLens(undefined)).toBe("for_you");
    expect(toLens(7)).toBe("for_you");
  });
});

/**
 * THE SEMANTIC RULE. A lens may name YES or NO only when what it RANKED ON is
 * about a side. Most Capital sorts on yes + no, so "YES has $505" would explain
 * a different ordering than the one applied.
 */
describe("directional versus market-level", () => {
  it("lets only the two reason-led lenses name a side", () => {
    expect(isDirectional("for_you")).toBe(true);
    expect(isDirectional("moving")).toBe(true);
    for (const l of ["capital", "believers", "fresh"] as Lens[]) {
      expect(isDirectional(l), l).toBe(false);
    }
  });

  it("knows which whole-market total each lens has already said out loud", () => {
    expect(heroMetric("capital")).toBe("capital");
    expect(heroMetric("believers")).toBe("believers");
    expect(heroMetric("fresh")).toBeNull();
    expect(heroMetric("for_you")).toBeNull();
    expect(heroMetric("moving")).toBeNull();
  });
});

describe("a lens never lists a market it cannot speak about", () => {
  it("keeps $0 out of Most Capital", () => {
    expect(admits("capital", c({ onchainId: 1, capitalUsd: 0 }))).toBe(false);
    expect(admits("capital", c({ onchainId: 1, capitalUsd: 0.5 }))).toBe(true);
  });

  it("keeps an empty market out of Most Believers", () => {
    expect(admits("believers", c({ onchainId: 1, believers: 0 }))).toBe(false);
    expect(admits("believers", c({ onchainId: 1, believers: 1 }))).toBe(true);
  });

  it("keeps a still market out of Moving", () => {
    expect(admits("moving", c({ onchainId: 1 }))).toBe(false);
    expect(admits("moving", c({ onchainId: 1, moving: true }))).toBe(true);
    // The classifier's own lens membership and its weight are two views of the
    // same fact; either is enough.
    expect(admits("moving", c({ onchainId: 1, momentumWeight: 0.3 }))).toBe(true);
  });

  it("keeps a market with no creation date out of Fresh", () => {
    expect(admits("fresh", c({ onchainId: 1 }))).toBe(false);
    expect(admits("fresh", c({ onchainId: 1, createdAtMs: 1 }))).toBe(true);
  });

  it("admits everything to For You, which is a blend and not a claim", () => {
    expect(admits("for_you", c({ onchainId: 1 }))).toBe(true);
  });
});

describe("the order is descending on the named measure", () => {
  it("ranks Most Capital by whole-market capital", () => {
    const rows = [
      c({ onchainId: 1, capitalUsd: 10 }),
      c({ onchainId: 2, capitalUsd: 505 }),
      c({ onchainId: 3, capitalUsd: 92 }),
    ];
    expect(orderForLens("capital", rows).map((r) => r.onchainId)).toEqual([2, 3, 1]);
  });

  it("ranks Most Believers by believers, not by the money behind them", () => {
    // Measured: the top market by believers (37) holds $137, while the top by
    // capital ($505) has 10. Ranking one on the other would be a third answer.
    const rows = [
      c({ onchainId: 1, believers: 10, capitalUsd: 505 }),
      c({ onchainId: 2, believers: 37, capitalUsd: 137 }),
    ];
    expect(orderForLens("believers", rows).map((r) => r.onchainId)).toEqual([2, 1]);
  });

  it("ranks Fresh newest first", () => {
    const rows = [c({ onchainId: 1, createdAtMs: 1_000 }), c({ onchainId: 2, createdAtMs: 9_000 })];
    expect(orderForLens("fresh", rows).map((r) => r.onchainId)).toEqual([2, 1]);
  });

  it("ranks Moving by the drift-corrected weight the classifier produced", () => {
    const rows = [
      c({ onchainId: 1, moving: true, momentumWeight: 0.2 }),
      c({ onchainId: 2, moving: true, momentumWeight: 0.8 }),
    ];
    expect(orderForLens("moving", rows).map((r) => r.onchainId)).toEqual([2, 1]);
    expect(lensRank("moving", rows[1]!)).toBe(0.8);
  });

  it("hands For You through untouched — it is already ranked", () => {
    const rows = [c({ onchainId: 1, score: 1 }), c({ onchainId: 2, score: 99 })];
    // Re-sorting here would undo `orderForMode` and the composite ranking both.
    expect(orderForLens("for_you", rows).map((r) => r.onchainId)).toEqual([1, 2]);
  });

  it("breaks ties the same way every time", () => {
    // 2,726 of 2,779 markets were created inside one 30-day import, so Fresh has
    // long runs of identical timestamps. A ranked list that reshuffles between
    // two polls a second apart is worse than one that is merely arbitrary.
    const rows = [
      c({ onchainId: 9, createdAtMs: 5, score: 10 }),
      c({ onchainId: 3, createdAtMs: 5, score: 90 }),
      c({ onchainId: 7, createdAtMs: 5, score: 10 }),
    ];
    const once = orderForLens("fresh", rows).map((r) => r.onchainId);
    expect(once).toEqual([3, 7, 9]);
    expect(orderForLens("fresh", [...rows].reverse()).map((r) => r.onchainId)).toEqual(once);
  });
});

/**
 * THE HERO IS NEVER SAID TWICE. "$505 committed" above "18 believers · $505
 * committed" prints the loudest number again in the quietest line.
 */
describe("what a row says", () => {
  const s = { believers: 18, capitalUsd: 505 };

  it("leads Most Capital with the money and grounds it with the people", () => {
    expect(lensHero("capital", s, null)).toBe("$505 committed");
    expect(scaleLine("capital", s)).toBe("18 believers");
  });

  it("leads Most Believers with the people and grounds it with the money", () => {
    expect(lensHero("believers", { believers: 42, capitalUsd: 318 }, null)).toBe("42 believers");
    expect(scaleLine("believers", { believers: 42, capitalUsd: 318 })).toBe("$318 committed");
  });

  it("leads Fresh with the age and keeps BOTH measures underneath", () => {
    expect(lensHero("fresh", { believers: 8, capitalUsd: 72 }, 3)).toBe("Created 3h ago");
    expect(scaleLine("fresh", { believers: 8, capitalUsd: 72 })).toBe(
      "8 believers · $72 committed",
    );
  });

  it("gives the reason-led lenses no hero of its own", () => {
    // Their headline is the sentence `reasonFor` / `momentumReason` already
    // wrote. Composing a second one here would be a third place deciding it.
    expect(lensHero("for_you", s, 3)).toBeNull();
    expect(lensHero("moving", s, 3)).toBeNull();
    expect(scaleLine("for_you", { believers: 12, capitalUsd: 184 })).toBe(
      "12 believers · $184 committed",
    );
  });

  it("omits a zero rather than printing it", () => {
    // "0 believers" spends a line to say nothing; absence carries it.
    expect(scaleLine("for_you", { believers: 0, capitalUsd: 184 })).toBe("$184 committed");
    expect(scaleLine("for_you", { believers: 3, capitalUsd: 0 })).toBe("3 believers");
    expect(scaleLine("for_you", { believers: 0, capitalUsd: 0 })).toBeNull();
  });

  it("says nothing rather than claiming a hero it lacks", () => {
    expect(lensHero("capital", { believers: 4, capitalUsd: 0 }, null)).toBeNull();
    expect(lensHero("believers", { believers: 0, capitalUsd: 9 }, null)).toBeNull();
    expect(lensHero("fresh", s, null)).toBeNull();
  });

  it("never leaves a lens with a hero AND an empty scale line silently wrong", () => {
    // The capital lens dropping capital from the scale line must not also drop
    // the believers: the whole point of the quiet line is the OTHER measure.
    expect(scaleLine("capital", { believers: 18, capitalUsd: 505 })).toContain("18");
    expect(scaleLine("capital", { believers: 18, capitalUsd: 505 })).not.toContain("505");
    expect(scaleLine("believers", { believers: 42, capitalUsd: 318 })).not.toContain("42");
  });

  it("says one believer, never 1 believers", () => {
    expect(lensHero("believers", { believers: 1, capitalUsd: 0 }, null)).toBe("1 believer");
  });

  it("coarsens age past a day, because the decision is the same either way", () => {
    expect(freshLabel(0.25)).toBe("Created 15m ago");
    expect(freshLabel(3)).toBe("Created 3h ago");
    expect(freshLabel(30)).toBe("Created 30h ago");
    expect(freshLabel(100)).toBe("Created 4d ago");
    expect(freshLabel(-1)).toBeNull();
  });
});
