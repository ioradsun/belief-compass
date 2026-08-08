import { describe, it, expect } from "vitest";
import { scoreRelationship, type DnaFactor } from "./score";
import { classifyRelationship } from "./classify";
import { scoreDomains, splitDomains } from "./domains";
import { evidenceLevelFor, confidenceFor, DNA_THRESHOLDS, type RelationshipLabel } from "./config";

const f = (id: number, side: "YES" | "NO", conviction = 0.8): DnaFactor => ({
  marketId: id,
  side,
  conviction,
});
const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from);

// ── scoring ─────────────────────────────────────────────────────────────────
describe("scoreRelationship", () => {
  it("all same-side → 100% agreement", () => {
    const s = scoreRelationship(
      range(10).map((i) => f(i, "YES")),
      range(10).map((i) => f(i, "YES")),
    );
    expect(s.agreement).toBe(100);
    expect(s.sameSideBeliefs).toBe(10);
    expect(s.oppositeSideBeliefs).toBe(0);
  });
  it("all opposite-side → 0% agreement", () => {
    const s = scoreRelationship(
      range(10).map((i) => f(i, "YES")),
      range(10).map((i) => f(i, "NO")),
    );
    expect(s.agreement).toBe(0);
    expect(s.oppositeSideBeliefs).toBe(10);
  });
  it("half/half → 50% agreement", () => {
    const b = [...range(5).map((i) => f(i, "YES")), ...range(5, 6).map((i) => f(i, "NO"))];
    const s = scoreRelationship(
      range(10).map((i) => f(i, "YES")),
      b,
    );
    expect(s.agreement).toBeCloseTo(50);
  });
  it("conviction weights the fraction (a high-conviction disagreement counts more)", () => {
    const a = [f(1, "YES", 1), f(2, "YES", 1)];
    // agree on 1 (low conv), disagree on 2 (high conv) → weighted agreement < 50
    const b = [f(1, "YES", 0.2), f(2, "NO", 1)];
    const s = scoreRelationship(a, b);
    expect(s.agreement).toBeLessThan(50);
    expect(s.sameSideBeliefs).toBe(1);
    expect(s.oppositeSideBeliefs).toBe(1);
  });
  it("no shared directional beliefs → 0 shared, agreement 0", () => {
    const s = scoreRelationship([f(1, "YES")], [f(2, "NO")]);
    expect(s.sharedBeliefs).toBe(0);
    expect(s.agreement).toBe(0);
  });
  it("confidence and evidence levels are shared-count driven", () => {
    expect(confidenceFor(0)).toBe(0);
    expect(confidenceFor(8)).toBeCloseTo(0.5);
    expect(evidenceLevelFor(4)).toBe("insufficient");
    expect(evidenceLevelFor(6)).toBe("early");
    expect(evidenceLevelFor(15)).toBe("growing");
    expect(evidenceLevelFor(40)).toBe("established");
  });
  it("a small perfect sample stays high agreement / low evidence (not a low match)", () => {
    const s = scoreRelationship(
      range(6).map((i) => f(i, "YES")),
      range(6).map((i) => f(i, "YES")),
    );
    expect(s.agreement).toBe(100);
    expect(s.evidenceLevel).toBe("early");
    expect(s.confidence).toBeLessThan(0.5);
  });
});

// ── classification + hysteresis ───────────────────────────────────────────────
const rel = (a: DnaFactor[], b: DnaFactor[], prev?: RelationshipLabel): RelationshipLabel =>
  classifyRelationship({ currentScore: scoreRelationship(a, b), previousRelationship: prev })
    .relationship;

describe("classifyRelationship", () => {
  it("insufficient evidence gate (<3 shared) → insufficient", () => {
    expect(
      rel(
        range(2).map((i) => f(i, "YES")),
        range(2).map((i) => f(i, "YES")),
      ),
    ).toBe("insufficient");
  });

  /**
   * THE BOUNDARY TABLE. Three shared markets, every reachable outcome.
   *
   * This is the whole argument for three rather than a lower number: at TWO the
   * reachable Matches are 0%, 50% and 100%, and 50% cannot be placed by any cut
   * that is not arbitrary — measured, 44% of two-market pairs sit exactly there.
   * At three they are 0 / 33 / 67 / 100, and all four land on a side.
   */
  it.each([
    [3, "tribe"],
    [2, "tribe"],
    [1, "opp"],
    [0, "opp"],
  ] as const)("3 shared, %i together → %s", (together, expected) => {
    const a = range(3).map((i) => f(i, "YES"));
    const b = range(3).map((i) => f(i, i <= together ? "YES" : "NO"));
    expect(rel(a, b)).toBe(expected);
  });

  it("labels the number it displays, at the thirds", () => {
    // `agreement` is unrounded; `convictionMatch` rounds. At three shared the
    // outcomes ARE the thirds — 66.67% and 33.33% — so comparing unrounded
    // against 67/33 put "67% Conviction Match" beside no label on the exact case
    // that makes three the right gate. Caught by the boundary table above.
    const a = range(3).map((i) => f(i, "YES"));
    const twoOfThree = scoreRelationship(
      a,
      range(3).map((i) => f(i, i <= 2 ? "YES" : "NO")),
    );
    expect(twoOfThree.agreement).toBeCloseTo(66.67, 1);
    expect(Math.round(twoOfThree.agreement)).toBe(DNA_THRESHOLDS.tribe.enter);
    expect(
      rel(
        a,
        range(3).map((i) => f(i, i <= 2 ? "YES" : "NO")),
      ),
    ).toBe("tribe");
  });

  it("2 shared is never placed, whatever the outcome", () => {
    for (const together of [0, 1, 2]) {
      const a = range(2).map((i) => f(i, "YES"));
      const b = range(2).map((i) => f(i, i <= together ? "YES" : "NO"));
      expect(rel(a, b), `2 shared / ${together} together`).toBe("insufficient");
    }
  });

  it("never mints a Twin or an Inverse, at any score or any depth", () => {
    // Their threshold bands are deleted, not dormant. A perfect pair over
    // twenty-four markets is a Tribe member — the strongest thing the product is
    // currently willing to say — and a total opposite is a Rival.
    const a = range(24).map((i) => f(i, "YES"));
    expect(
      rel(
        a,
        range(24).map((i) => f(i, "YES")),
      ),
    ).toBe("tribe");
    expect(
      rel(
        a,
        range(24).map((i) => f(i, "NO")),
      ),
    ).toBe("opp");
  });
  it("Tribe entry: ≥77% over ≥8 shared", () => {
    const a = range(10).map((i) => f(i, "YES"));
    const b = range(10).map((i) => f(i, i <= 8 ? "YES" : "NO")); // 80%
    expect(rel(a, b)).toBe("tribe");
  });
  it("Opp entry: ≤33% over ≥8 shared", () => {
    const a = range(10).map((i) => f(i, "YES"));
    const b = range(10).map((i) => f(i, i <= 2 ? "YES" : "NO")); // 20%
    expect(rel(a, b)).toBe("opp");
  });
  it("Neutral: enough evidence, no strong lean", () => {
    const a = range(10).map((i) => f(i, "YES"));
    const b = range(10).map((i) => f(i, i <= 5 ? "YES" : "NO")); // 60%
    expect(rel(a, b)).toBe("neutral");
  });

  it("Opp hysteresis: held Opp survives at 35% (exit 38) but a fresh one is Neutral", () => {
    const a = range(20).map((i) => f(i, "YES"));
    const b = range(20).map((i) => f(i, i <= 7 ? "YES" : "NO")); // 7/20 = 35% (between enter 33 and exit 38)
    expect(rel(a, b, "opp")).toBe("opp");
    expect(rel(a, b, undefined)).toBe("neutral");
  });
  it("confidence is no longer a labelling input, and never was one", () => {
    // `minConfidence` was removed because confidence is `shared / (shared + 8)` —
    // a monotone function of the SAME count `minShared` already tested. tribe's
    // 0.4 implied shared ≥ 6 against a demand of 8; twin's 0.7 implied 19 against
    // 20. Every confidence gate was strictly weaker than the count gate beside
    // it, so not one of them ever changed a classification.
    const K = DNA_THRESHOLDS.confidenceK;
    for (const [minShared, minConfidence] of [
      [8, 0.4],
      [20, 0.7],
    ] as const) {
      let implied = 0;
      while (implied / (implied + K) < minConfidence) implied++;
      expect(
        implied,
        `minConfidence ${minConfidence} vs minShared ${minShared}`,
      ).toBeLessThanOrEqual(minShared);
    }
    // 100% over five is now a Tribe member: five clears the canonical gate of
    // three, and nothing else has a say.
    const a = range(5).map((i) => f(i, "YES"));
    expect(
      rel(
        a,
        range(5).map((i) => f(i, "YES")),
      ),
    ).toBe("tribe");
  });
});

// ── domains ───────────────────────────────────────────────────────────────────
describe("scoreDomains", () => {
  const domainOf = (id: string | number) => (Number(id) <= 100 ? "Technology" : "Money");
  it("scores only within a domain and honors the domain minimum", () => {
    const a = [...range(6).map((i) => f(i, "YES")), ...range(6, 101).map((i) => f(i, "YES"))];
    const b = [...range(6).map((i) => f(i, "YES")), ...range(6, 101).map((i) => f(i, "NO"))];
    const doms = scoreDomains(a, b, domainOf);
    const tech = doms.find((d) => d.domain === "Technology");
    const money = doms.find((d) => d.domain === "Money");
    expect(tech?.agreement).toBe(100);
    expect(money?.agreement).toBe(0);
    expect(tech?.sharedBeliefs).toBe(6);
  });
  it("one shared domain market makes no Circle", () => {
    const a = [...range(6).map((i) => f(i, "YES")), f(101, "YES")];
    const b = [...range(6).map((i) => f(i, "YES")), f(101, "YES")];
    const doms = scoreDomains(a, b, domainOf);
    expect(doms.find((d) => d.domain === "Money")).toBeUndefined();
  });
  it("splitDomains separates aligned from opposed", () => {
    const a = [...range(6).map((i) => f(i, "YES")), ...range(6, 101).map((i) => f(i, "YES"))];
    const b = [...range(6).map((i) => f(i, "YES")), ...range(6, 101).map((i) => f(i, "NO"))];
    const { aligned, opposed } = splitDomains(scoreDomains(a, b, domainOf));
    expect(aligned[0].domain).toBe("Technology");
    expect(opposed[0].domain).toBe("Money");
  });
});

/**
 * HISTORY AS EVIDENCE.
 *
 * DNA read only open positions, so an exit erased every agreement the two ever
 * had in that market — and 43.5% of production positions are fully exited. A
 * conviction someone has left now still counts, at PAST_WEIGHT.
 *
 * These assert the RELATIONSHIPS between the numbers, not the constant. Change
 * PAST_WEIGHT and they should all still hold; break the model and they should
 * not.
 */
describe("convictions people have left", () => {
  const f = (marketId: number, side: "YES" | "NO", past = false): DnaFactor => ({
    marketId,
    side,
    conviction: 1,
    past,
  });

  it("counts a shared market nobody left exactly as it always did", () => {
    const a = [f(1, "YES"), f(2, "YES"), f(3, "NO")];
    const b = [f(1, "YES"), f(2, "NO"), f(3, "NO")];
    const s = scoreRelationship(a, b);
    expect(s.sharedBeliefs).toBe(3);
    expect(s.currentShared).toBe(3);
    expect(s.pastShared).toBe(0);
    expect(s.evidence).toBe(3);
    expect(s.agreement).toBeCloseTo((2 / 3) * 100, 6);
  });

  it("REMEMBERS an agreement after one of them exits, instead of erasing it", () => {
    const both = [f(1, "YES"), f(2, "YES")];
    const left = [f(1, "YES"), f(2, "YES", true)];
    const s = scoreRelationship(both, left);
    // The market is still shared and still agreed — it simply weighs less.
    expect(s.sharedBeliefs).toBe(2);
    expect(s.currentShared).toBe(1);
    expect(s.pastShared).toBe(1);
    expect(s.agreement).toBe(100);
    // ...and it is worth strictly less evidence than two live convictions.
    expect(s.evidence).toBeLessThan(2);
    expect(s.evidence).toBeGreaterThan(1);
  });

  it("treats a market as past when EITHER of them has left it", () => {
    const aLeft = scoreRelationship([f(1, "YES", true)], [f(1, "YES")]);
    const bLeft = scoreRelationship([f(1, "YES")], [f(1, "YES", true)]);
    const bothLeft = scoreRelationship([f(1, "YES", true)], [f(1, "YES", true)]);
    expect(aLeft.pastShared).toBe(1);
    expect(bLeft.pastShared).toBe(1);
    expect(bothLeft.pastShared).toBe(1);
    expect(aLeft.evidence).toBe(bLeft.evidence);
    expect(aLeft.evidence).toBe(bothLeft.evidence);
  });

  it("never lets remembered disagreement outvote where the two stand today", () => {
    // Four past disagreements against one live agreement. Today they agree, and
    // the number has to say that even though history is louder in raw count.
    const a = [
      f(1, "YES"),
      f(2, "YES", true),
      f(3, "YES", true),
      f(4, "YES", true),
      f(5, "YES", true),
    ];
    const b = [f(1, "YES"), f(2, "NO", true), f(3, "NO", true), f(4, "NO", true), f(5, "NO", true)];
    const s = scoreRelationship(a, b);
    expect(s.sameSideBeliefs).toBe(1);
    expect(s.oppositeSideBeliefs).toBe(4);
    // A raw count would read 20%. The live market is worth as much as all four.
    expect(s.agreement).toBeGreaterThan(20);
    expect(s.agreement).toBe(50);
  });

  it("cannot reach an evidence gate on memories alone that live positions would fail", () => {
    // Enough remembered convictions to clear minSharedOverall on raw count...
    const past = (n: number, side: "YES" | "NO") =>
      Array.from({ length: n }, (_, i) => f(i + 1, side, true));
    const s = scoreRelationship(past(6, "YES"), past(6, "YES"));
    expect(s.sharedBeliefs).toBeGreaterThanOrEqual(DNA_THRESHOLDS.minSharedOverall);
    // ...but not in current-equivalent terms, so the engine still declines.
    expect(s.evidence).toBeLessThan(DNA_THRESHOLDS.minSharedOverall);
    expect(classifyRelationship({ currentScore: s }).relationship).toBe("insufficient");
  });

  it("lets a long shared history genuinely place a relationship it could not before", () => {
    // Two people who agreed 20 times and have since closed most of those markets.
    const many = (n: number, side: "YES" | "NO", past: boolean) =>
      Array.from({ length: n }, (_, i) => f(i + 1, side, past));
    const live = many(2, "YES", false);
    const gone = Array.from({ length: 20 }, (_, i) => f(i + 100, "YES", true));
    const s = scoreRelationship([...live, ...gone], [...live, ...gone]);
    expect(s.evidence).toBeGreaterThanOrEqual(DNA_THRESHOLDS.minSharedOverall);
    expect(classifyRelationship({ currentScore: s }).relationship).not.toBe("insufficient");
    // Two live convictions alone are below the canonical gate of three.
    const liveOnly = scoreRelationship(live, live);
    expect(classifyRelationship({ currentScore: liveOnly }).relationship).toBe("insufficient");
  });

  it("keeps confidence monotonic: more remembered history never lowers it", () => {
    const grow = [0, 1, 4, 12, 40].map((n) => {
      const past = Array.from({ length: n }, (_, i) => f(i + 100, "YES", true));
      const live = [f(1, "YES"), f(2, "YES")];
      return scoreRelationship([...live, ...past], [...live, ...past]).confidence;
    });
    for (let i = 1; i < grow.length; i++) expect(grow[i]).toBeGreaterThan(grow[i - 1]);
  });
});
