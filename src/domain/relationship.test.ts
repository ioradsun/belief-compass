import { describe, expect, it } from "vitest";
import {
  convictionMatch,
  presentRelationship,
  relationshipInsight,
  relationshipLabel,
  formatSharedConvictions,
  sortTribe,
  sortRivals,
  dnaMaturity,
  type RelationshipInput,
  type RelationshipGroup,
} from "./relationship";
import { labelFor } from "./dna/classify";
import { place, type SpectrumBand } from "./relationship-spectrum";

const make = (o: Partial<RelationshipInput>): RelationshipInput => ({
  agreement: 50,
  sharedConvictions: 0,
  together: 0,
  apart: 0,
  topicCount: 0,
  ...o,
});

describe("alignment vs evidence separation", () => {
  it("low-evidence positive relationship: ranked, never PLACED, never a Twin", () => {
    // TWO shared convictions — below the canonical gate of three, and below it for
    // a structural reason rather than a chosen one: at two the only reachable
    // Matches are 0%, 50% and 100%, so the middle case cannot be placed by any
    // non-arbitrary cut. This fixture used to be four at 75%, which the new model
    // places as Tribe, correctly.
    const p = presentRelationship(
      make({ agreement: 50, sharedConvictions: 2, together: 1, apart: 1, topicCount: 2 }),
    );
    expect(p.group).toBe("neutral");
    expect(p.placed).toBe(false);
    expect(p.tier).toBe("low");
    expect(p.earnedLabel).toBeNull();
    expect(relationshipInsight(p)).toBe("1 together · 1 apart");
    // No mature percentage leaked into the primary insight.
    expect(relationshipInsight(p)).not.toMatch(/%/);
    expect(relationshipLabel(p)?.text).toBe("Closest so far");
    expect(relationshipLabel(p)?.kind).toBe("provisional");
  });

  it("low-evidence inverse relationship: ranked, never PLACED, never an Opp", () => {
    // Two, not three: three at 0% is now a placed Rival, which is the whole point
    // of the new gate — 0-of-3 is exactly the pattern the product wants to name.
    const p = presentRelationship(
      make({ agreement: 0, sharedConvictions: 2, together: 0, apart: 2, topicCount: 2 }),
    );
    expect(p.group).toBe("neutral");
    expect(p.placed).toBe(false);
    expect(p.tier).toBe("low");
    expect(p.earnedLabel).toBeNull();
    expect(relationshipInsight(p)).toBe("Opposite on all 2");
    expect(relationshipInsight(p)).not.toMatch(/%/);
    expect(relationshipLabel(p)?.text).toBe("Most opposite so far");
  });

  it("never turns a shared count into a percentage (2 shared ≠ 2%)", () => {
    const p = presentRelationship(
      make({ agreement: 100, sharedConvictions: 2, together: 2, apart: 0 }),
    );
    expect(relationshipInsight(p)).toBe("Together on all 2");
    expect(p.alignmentPct).toBe(100); // alignment is 100% ...
    expect(p.tier).toBe("low"); // ... but TWO is below the gate, so no mature %
  });
});

describe("mature relationships show the % WITH its evidence", () => {
  it("mature Tribe: percentage + evidence, but Twin only if all thresholds clear", () => {
    const p = presentRelationship(
      make({ agreement: 84, sharedConvictions: 19, together: 16, apart: 3, topicCount: 4 }),
    );
    expect(p.group).toBe("tribe");
    expect(p.tier).toBe("mature");
    expect(relationshipInsight(p)).toBe("84% aligned");
    // 84% < 90% Twin bar → Tribe, not Twin.
    expect(p.earnedLabel).toBeNull();
    expect(relationshipLabel(p)?.text).toBe("Tribe");
  });

  it("mature Rival: opposition percentage, Opp only if all thresholds clear", () => {
    const p = presentRelationship(
      make({ agreement: 19, sharedConvictions: 21, together: 4, apart: 17, topicCount: 4 }),
    );
    expect(p.group).toBe("rival");
    expect(p.tier).toBe("mature");
    expect(relationshipInsight(p)).toBe("81% opposite");
    // 81% opposite < 85% Opp bar → Rival, not Opp.
    expect(p.earnedLabel).toBeNull();
  });
});

/**
 * CONVICTION MATCH — the number, and the promise that it is checkable.
 *
 * WHAT THIS REPLACED. These tests used to assert that Twin and Opp were EARNED
 * through `EARNED_LABELS` — a second set of thresholds layered over the engine's
 * own. Because that layer re-tested the GROUP rather than the engine's label, a
 * pair the engine called `tribe` could display "Twin", and the system had two
 * definitions of one word with the looser one winning.
 *
 * Both words are now held back until production can support them (measured: one
 * pair would earn Twin, zero would earn Opp), and the layer is deleted rather
 * than patched. What is asserted instead is the property that made the whole
 * change necessary: the percentage a reader sees IS the count beneath it.
 */
describe("the percentage is the arithmetic", () => {
  it("is exactly together ÷ shared", () => {
    for (const [t, sh, want] of [
      [7, 8, 88],
      [9, 11, 82],
      [23, 25, 92],
      [5, 18, 28],
      [1, 1, 100],
      [0, 10, 0],
    ] as const) {
      expect(convictionMatch(t, sh, sh - t)).toBe(want);
    }
  });

  it("places the relationship on the SAME number it displays", () => {
    // The defect that forced this change: a pair who landed together in 7 of 8
    // shared markets was classified Rival, because the one market they split on
    // carried nearly all the conviction weight. Label and count could contradict.
    const p = presentRelationship(
      make({ agreement: 15, sharedConvictions: 8, together: 7, apart: 1, topicCount: 3 }),
    );
    expect(p.matchPct).toBe(88);
    expect(p.alignmentPct).toBe(88);
    expect(p.group).not.toBe("rival");
  });

  it("cannot label someone a Rival while showing a majority together", () => {
    // The invariant, swept: no card may read Rival above 50% or Tribe below it.
    for (let shared = 8; shared <= 30; shared++) {
      for (let together = 0; together <= shared; together++) {
        const p = presentRelationship(
          make({
            agreement: 50,
            sharedConvictions: shared,
            together,
            apart: shared - together,
            topicCount: 3,
          }),
        );
        const m = p.matchPct as number;
        if (p.group === "rival") expect(m, `${together} of ${shared}`).toBeLessThan(50);
        if (p.group === "tribe") expect(m, `${together} of ${shared}`).toBeGreaterThan(50);
      }
    }
  });

  it("says nothing rather than 0% when there is nothing to divide", () => {
    const none = presentRelationship(
      make({ agreement: 0, sharedConvictions: 0, together: 0, apart: 0, topicCount: 0 }),
    );
    expect(none.matchPct).toBeNull();
  });

  it("refuses a match whose counts do not reconcile", () => {
    // together + apart must equal shared — `scoreRelationship` guarantees it. When
    // they disagree the counts did not come from one score, and a caller that
    // populated `shared` but forgot `together` must not get a confident 0%.
    expect(convictionMatch(0, 20, 0)).toBeNull();
    expect(convictionMatch(0, 20, 20)).toBe(0);
  });

  it("holds Twin and Opp back entirely", () => {
    // No input can produce either word — not perfect alignment over a long
    // history, not perfect opposition. They return from the engine, once.
    for (const [t, sh] of [
      [60, 60],
      [0, 60],
      [28, 30],
    ] as const) {
      const p = presentRelationship(
        make({ agreement: 50, sharedConvictions: sh, together: t, apart: sh - t, topicCount: 8 }),
      );
      expect(p.earnedLabel).toBeNull();
      expect(relationshipLabel(p)?.text).not.toBe("Twin");
      expect(relationshipLabel(p)?.text).not.toBe("Opp");
    }
  });
});

describe("neutral, no-overlap, and placement", () => {
  it("keeps a no-overlap person OUT of the primary lists", () => {
    const p = presentRelationship(make({ agreement: 50, sharedConvictions: 0 }));
    expect(p.group).toBe("insufficient");
    expect(p.placed).toBe(false);
    expect(relationshipLabel(p)).toBeNull();
  });

  it("keeps a near-neutral relationship out of Tribe and Rivals", () => {
    const p = presentRelationship(
      make({ agreement: 50, sharedConvictions: 12, together: 6, apart: 6, topicCount: 3 }),
    );
    expect(p.group).toBe("neutral");
    expect(p.placed).toBe(false);
  });
});

describe("sorting", () => {
  it("Tribe sorts most-aligned first, ties break on evidence", () => {
    const strong = presentRelationship(
      make({ agreement: 90, sharedConvictions: 20, together: 18, apart: 2, topicCount: 4 }),
    );
    const weak = presentRelationship(
      make({ agreement: 70, sharedConvictions: 12, together: 9, apart: 3, topicCount: 3 }),
    );
    const wellProven = presentRelationship(
      make({ agreement: 90, sharedConvictions: 40, together: 36, apart: 4, topicCount: 4 }),
    );
    expect([weak, strong].sort(sortTribe)[0]).toBe(strong);
    expect([strong, wellProven].sort(sortTribe)[0]).toBe(wellProven); // tie on 90% → more evidence wins
  });

  it("Rivals sorts most-opposite first", () => {
    const strong = presentRelationship(
      make({ agreement: 10, sharedConvictions: 20, together: 2, apart: 18, topicCount: 4 }),
    );
    const weak = presentRelationship(
      make({ agreement: 35, sharedConvictions: 12, together: 4, apart: 8, topicCount: 3 }),
    );
    expect([weak, strong].sort(sortRivals)[0]).toBe(strong);
  });
});

describe("topic lines and copy", () => {
  it("names common ground for Tribe and the divide for Rivals", () => {
    const tribe = presentRelationship(
      make({
        agreement: 84,
        sharedConvictions: 19,
        together: 16,
        apart: 3,
        topicCount: 4,
        strongestAlignedTopic: "Culture",
      }),
    );
    // The presentation still carries the topics; the line that rendered them
    // belonged to a profile layout that no longer exists.
    expect(tribe.strongestAlignedTopic).toBe("Culture");
  });

  it("formats shared convictions with correct pluralisation", () => {
    expect(formatSharedConvictions(1)).toBe("1 conviction in common");
    expect(formatSharedConvictions(19)).toBe("19 convictions in common");
  });
});

describe("page-level DNA maturity (factual, not a fake identity %)", () => {
  it("moves through qualitative stages and keeps the raw count", () => {
    const early = dnaMaturity(7, 3);
    expect(early.stage).toBe("Taking shape");
    expect(early.convictionsMapped).toBe(7);
    expect(early.note).toContain("Decide on 1 more market");

    const mid = dnaMaturity(12, 3);
    expect(mid.stage).toBe("Becoming clearer");

    const mature = dnaMaturity(24, 4);
    expect(mature.stage).toBe("Well defined");
    expect(mature.moreToSharpen).toBe(0);
  });

  it("invites the first decision when nothing is mapped", () => {
    expect(dnaMaturity(0, 0).note).toContain("Take a side");
  });
});

/**
 * ONE AUTHORITY.
 *
 * Three modules used to decide whether someone is your Tribe, with three
 * different rules, agreeing on 7.3% of real relationships. These do not check
 * that the other two now import the engine — a later refactor could satisfy that
 * and still diverge. They check the only thing that matters: that for any
 * relationship at all, the three answers are the SAME answer.
 */
describe("one authority decides placement", () => {
  const grid: { agreement: number; shared: number }[] = [];
  for (const agreement of [0, 5, 10, 20, 33, 40, 45, 50, 55, 60, 72, 77, 85, 90, 93, 100]) {
    for (const shared of [0, 1, 2, 4, 5, 7, 8, 10, 15, 19, 20, 40, 100]) {
      grid.push({ agreement, shared });
    }
  }

  const side = (b: SpectrumBand) => (b === "tribe" ? "aligned" : b === "rival" ? "opposed" : "—");
  const groupSide = (g: RelationshipGroup) =>
    g === "tribe" ? "aligned" : g === "rival" ? "opposed" : "—";

  it("gives the engine's answer for every shape of relationship", () => {
    const disagreements: string[] = [];
    for (const { agreement, shared } of grid) {
      const p = presentRelationship(
        make({ agreement, sharedConvictions: shared, together: 0, apart: 0, topicCount: 4 }),
      );
      const engine = labelFor({
        agreement: p.alignmentPct,
        evidence: p.sharedConvictions,
        confidence: p.confidence,
      });
      const engineSide =
        engine === "twin" || engine === "tribe"
          ? "aligned"
          : engine === "opp" || engine === "inverse"
            ? "opposed"
            : "—";
      const spectrum = place({
        alignmentPct: p.alignmentPct,
        confidence: p.confidence,
        earned: p.earnedLabel,
        group: p.group,
      });
      // `insufficient` (never met) is the one thing presentation knows that the
      // engine does not — it reads as unplaced, which is the same side.
      if (groupSide(p.group) !== engineSide || side(spectrum.band) !== engineSide) {
        disagreements.push(
          `${agreement}% over ${shared}: engine=${engineSide} people=${groupSide(p.group)} spectrum=${side(spectrum.band)}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("never places anyone the engine calls unplaceable, however perfect the score", () => {
    // 100% agreement on TWO shared convictions. The point survives the new gate
    // unchanged — a perfect score is still not evidence, and the presentation layer
    // must not out-vote the engine on it. Only the count moves: four at 100% is now
    // a placed Tribe member, deliberately, because 4-of-4 is a pattern.
    const p = presentRelationship(
      make({ agreement: 100, sharedConvictions: 2, together: 2, apart: 0, topicCount: 4 }),
    );
    expect(p.placed).toBe(false);
    expect(p.earnedLabel).toBeNull();
    expect(place({ ...p, group: p.group, earned: p.earnedLabel }).band).toBe("neutral");
  });

  it("sends the strongest relationship there is to Tribe, not past it", () => {
    // 29 of 30 together is as aligned as production gets, and it stops at Tribe.
    // The second authority that would have promoted it to Twin is deleted, not
    // bypassed — there is nowhere further to go until the engine says so.
    const p = presentRelationship(
      make({ agreement: 95, sharedConvictions: 30, together: 29, apart: 1, topicCount: 4 }),
    );
    expect(p.group).toBe("tribe");
    expect(p.matchPct).toBe(97);
    expect(p.earnedLabel).toBeNull();
    expect(place({ ...p, group: p.group }).band).toBe("tribe");
  });
});
