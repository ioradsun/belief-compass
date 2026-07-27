import { describe, it, expect } from "vitest";
import { scoreRelationship, type DnaFactor } from "./score";
import { classifyRelationship } from "./classify";
import { scoreDomains, splitDomains } from "./domains";
import { evidenceLevelFor, confidenceFor, type RelationshipLabel } from "./config";

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
  it("insufficient evidence gate (<5 shared) → insufficient", () => {
    expect(
      rel(
        range(4).map((i) => f(i, "YES")),
        range(4).map((i) => f(i, "YES")),
      ),
    ).toBe("insufficient");
  });
  it("Twin entry: ≥93% over ≥20 shared, high confidence", () => {
    const a = range(24).map((i) => f(i, "YES"));
    const b = range(24).map((i) => f(i, i <= 23 ? "YES" : "NO")); // 23/24 ≈ 96%
    expect(rel(a, b)).toBe("twin");
  });
  it("Twin does NOT form on <20 shared even at 100%", () => {
    const a = range(12).map((i) => f(i, "YES"));
    expect(
      rel(
        a,
        range(12).map((i) => f(i, "YES")),
      ),
    ).toBe("tribe"); // strong but only Tribe-grade evidence
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
  it("Inverse entry: ≤10% over ≥20 shared", () => {
    const a = range(24).map((i) => f(i, "YES"));
    const b = range(24).map((i) => f(i, i <= 1 ? "YES" : "NO")); // ~8%
    expect(rel(a, b)).toBe("inverse");
  });
  it("Neutral: enough evidence, no strong lean", () => {
    const a = range(10).map((i) => f(i, "YES"));
    const b = range(10).map((i) => f(i, i <= 5 ? "YES" : "NO")); // 60%
    expect(rel(a, b)).toBe("neutral");
  });

  it("Twin hysteresis: held Twin survives at ~91.7% (exit 90) but a fresh one is only Tribe", () => {
    const a = range(24).map((i) => f(i, "YES"));
    const b = range(24).map((i) => f(i, i <= 22 ? "YES" : "NO")); // 22/24 = 91.7%
    expect(rel(a, b, "twin")).toBe("twin"); // held → stays
    expect(rel(a, b, undefined)).toBe("tribe"); // fresh → only Tribe
  });
  it("Twin exit: drops below 90% → Tribe", () => {
    const a = range(24).map((i) => f(i, "YES"));
    const b = range(24).map((i) => f(i, i <= 21 ? "YES" : "NO")); // 21/24 = 87.5% < exit 90
    expect(rel(a, b, "twin")).toBe("tribe");
  });
  it("Opp hysteresis: held Opp survives at 35% (exit 38) but a fresh one is Neutral", () => {
    const a = range(20).map((i) => f(i, "YES"));
    const b = range(20).map((i) => f(i, i <= 7 ? "YES" : "NO")); // 7/20 = 35% (between enter 33 and exit 38)
    expect(rel(a, b, "opp")).toBe("opp");
    expect(rel(a, b, undefined)).toBe("neutral");
  });
  it("confidence gate: 100% over 5 shared cannot be Tribe (needs ≥8)", () => {
    const a = range(5).map((i) => f(i, "YES"));
    expect(
      rel(
        a,
        range(5).map((i) => f(i, "YES")),
      ),
    ).toBe("neutral");
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
