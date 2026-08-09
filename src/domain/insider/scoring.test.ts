import { describe, it, expect } from "vitest";
import { score, scoreSignal, IMPORTANCE_WEIGHTS } from "./scoring";
import { evidenceFromPulse, freshnessOf, FRESH_HALF_LIFE_MS } from "./features";
import { NO_EVIDENCE, type InsiderEvidence, type InsiderPulse, type InsiderSignal } from "./types";

const evidence = (over: Partial<InsiderEvidence> = {}): InsiderEvidence => ({
  ...NO_EVIDENCE,
  ...over,
});

describe("features — freshness", () => {
  it("decays by half every half-life; 1 at now; null when time unknown", () => {
    const now = 1_000_000_000;
    expect(freshnessOf(now, now)).toBe(1);
    expect(freshnessOf(now - FRESH_HALF_LIFE_MS, now)).toBeCloseTo(0.5, 5);
    expect(freshnessOf(now - 2 * FRESH_HALF_LIFE_MS, now)).toBeCloseTo(0.25, 5);
    // future/just-happened clamps to 1; unknown ⇒ null (not 0).
    expect(freshnessOf(now + 5_000, now)).toBe(1);
    expect(freshnessOf(null, now)).toBeNull();
  });
});

describe("features — evidence from pulse", () => {
  it("lifts pulse dimensions into per-signal evidence, freshness supplied separately", () => {
    const pulse: InsiderPulse = {
      direction: "YES",
      momentum: 0.8,
      acceleration: 0.4,
      activity: 0.5,
      participation: 0.3,
      capitalFlow: 0.6,
      imbalance: 0.7,
      volatility: 0.2,
      novelty: 0.9,
      lastInterestingEventAt: null,
    };
    expect(evidenceFromPulse(pulse, 0.5)).toEqual({
      magnitude: 0.8,
      velocity: 0.4,
      participation: 0.3,
      capitalFlow: 0.6,
      imbalance: 0.7,
      novelty: 0.9,
      freshness: 0.5,
    });
    // Default freshness is unknown, never a fabricated 0.
    expect(evidenceFromPulse(pulse).freshness).toBeNull();
  });
});

describe("scoring — three distinct judgments, never one score", () => {
  it("importance weights sum to 1", () => {
    const sum = Object.values(IMPORTANCE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("momentum blends magnitude and velocity", () => {
    expect(score(evidence({ magnitude: 1, velocity: 1 })).momentumScore).toBe(1);
    expect(score(evidence({ magnitude: 1, velocity: 0 })).momentumScore).toBeCloseTo(0.6, 5);
    expect(score(evidence({ magnitude: 0, velocity: 1 })).momentumScore).toBeCloseTo(0.4, 5);
  });

  it("importance rewards big, unusual, participated, funded, fresh", () => {
    const strong = score(evidence({ magnitude: 1, novelty: 1, participation: 1, capitalFlow: 1, freshness: 1 }));
    expect(strong.importanceScore).toBe(1);
    // Magnitude outweighs freshness (a stale big thing still matters more than a fresh nothing).
    const big = score(evidence({ magnitude: 1 })).importanceScore;
    const fresh = score(evidence({ freshness: 1 })).importanceScore;
    expect(big).toBeGreaterThan(fresh);
  });

  it("confidence tracks coverage (null ≠ 0) and freshness", () => {
    // Nothing computed ⇒ no confidence.
    expect(score(NO_EVIDENCE).confidence).toBe(0);
    // Fully computed + fresh ⇒ high confidence.
    const full = score(evidence({ magnitude: 0.5, velocity: 0.5, participation: 0.5, capitalFlow: 0.5, imbalance: 0.5, novelty: 0.5, freshness: 1 }));
    expect(full.confidence).toBe(1);
    // Same values but stale ⇒ less sure.
    const stale = score(evidence({ magnitude: 0.5, velocity: 0.5, participation: 0.5, capitalFlow: 0.5, imbalance: 0.5, novelty: 0.5, freshness: 0 }));
    expect(stale.confidence).toBeLessThan(full.confidence);
    // Two dims present but stale reads as lower coverage than seven present.
    const sparse = score(evidence({ magnitude: 0.5, freshness: 0 }));
    expect(sparse.confidence).toBeLessThan(full.confidence);
  });

  it("scoreSignal attaches evidence + judgment", () => {
    const base: InsiderSignal = {
      id: "s1",
      marketId: 1,
      kind: "building",
      occurredAt: "2026-01-01T00:00:00.000Z",
      evidence: { ...NO_EVIDENCE },
      provenance: { sourceEventIds: ["s1"], reasonCodes: [], builderVersion: 1 },
    };
    const ev = evidence({ magnitude: 0.8, velocity: 0.2, freshness: 1 });
    const scored = scoreSignal(base, ev);
    expect(scored.evidence).toEqual(ev);
    expect(scored.judgment?.momentumScore).toBeCloseTo(0.6 * 0.8 + 0.4 * 0.2, 5);
    // Original is not mutated.
    expect(base.judgment).toBeUndefined();
  });
});
