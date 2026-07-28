import { describe, it, expect } from "vitest";
import { confidenceBand, FOUNDATION_REQUIRED, HOUSE_ENGINE_VERSION } from "./config";
import { predictHouse, type SignalBundle } from "./engine";
import {
  FOUNDATION_MAPPINGS,
  FOUNDATION_MAPPING_VERSION,
  applyFoundationAnswer,
  accumulateDimensions,
} from "./foundation";

describe("confidence bands", () => {
  it("maps confidence to the right band at every threshold", () => {
    expect(confidenceBand(0.42)).toBe("SHOT_IN_THE_DARK");
    expect(confidenceBand(0.5)).toBe("FLYING_BLIND");
    expect(confidenceBand(0.59)).toBe("FLYING_BLIND");
    expect(confidenceBand(0.6)).toBe("HUNCH");
    expect(confidenceBand(0.69)).toBe("HUNCH");
    expect(confidenceBand(0.7)).toBe("READ");
    expect(confidenceBand(0.84)).toBe("READ");
    expect(confidenceBand(0.85)).toBe("STRONG_READ");
    expect(confidenceBand(1)).toBe("STRONG_READ");
  });
});

describe("engine — always takes a shot & stays deterministic", () => {
  it("returns a valid action even for an empty signal bundle", () => {
    const p = predictHouse({});
    expect(["BUY_YES", "BUY_NO", "SKIP"]).toContain(p.action);
    expect(p.engineVersion).toBe(HOUSE_ENGINE_VERSION);
  });

  it("probabilities are a valid distribution", () => {
    const p = predictHouse({ categoryDirectionalLean: 0.4, categorySamples: 10 });
    expect(p.pBuyYes + p.pBuyNo + p.pSkip).toBeCloseTo(1, 6);
    expect(p.confidence).toBeCloseTo(Math.max(p.pBuyYes, p.pBuyNo, p.pSkip), 12);
  });

  it("is deterministic for a fixed bundle + tiebreak", () => {
    const sig: SignalBundle = {
      categoryDirectionalLean: 0.3,
      twinLean: 1,
      categoryEngagement: 0.8,
      categorySamples: 12,
      priorPositions: 20,
    };
    expect(predictHouse(sig, 0.5)).toEqual(predictHouse(sig, 0.5));
  });
});

describe("engine — signals move the prediction the right way", () => {
  it("strong YES evidence + engagement → BUY_YES", () => {
    const p = predictHouse({
      overallSkipRate: 0.1,
      categoryEngagement: 0.9,
      categorySamples: 15,
      categoryDirectionalLean: 0.8,
      twinLean: 1,
      tribeLean: 1,
      priorPositions: 25,
    });
    expect(p.action).toBe("BUY_YES");
    expect(p.reasonCodes.length).toBeGreaterThan(0);
  });

  it("strong NO evidence + engagement → BUY_NO", () => {
    const p = predictHouse({
      overallSkipRate: 0.1,
      categoryEngagement: 0.9,
      categorySamples: 15,
      categoryDirectionalLean: -0.8,
      twinLean: -1,
      priorPositions: 25,
    });
    expect(p.action).toBe("BUY_NO");
  });

  it("a heavy skipper → SKIP, with engagement-negative reasons", () => {
    const p = predictHouse({
      overallSkipRate: 0.9,
      categorySkipRate: 0.9,
      recentSkipRate: 0.9,
      categoryEngagement: 0.1,
      categorySamples: 15,
    });
    expect(p.action).toBe("SKIP");
    expect(p.reasonCodes).toContain("OVERALL_SKIP");
  });

  it("opp leaning YES pushes the user toward NO (inversion)", () => {
    const base: SignalBundle = {
      overallSkipRate: 0.1,
      categoryEngagement: 0.9,
      categorySamples: 15,
    };
    const withOpp = predictHouse({ ...base, oppLean: 1 });
    expect(withOpp.pBuyNo).toBeGreaterThan(withOpp.pBuyYes);
  });

  it("contrarian users fade the crowd", () => {
    const follower = predictHouse({
      crowdYesPct: 0.9,
      crowdSensitivity: 1,
      categoryEngagement: 0.9,
      overallSkipRate: 0.1,
      categorySamples: 15,
    });
    const contrarian = predictHouse({
      crowdYesPct: 0.9,
      crowdSensitivity: -1,
      categoryEngagement: 0.9,
      overallSkipRate: 0.1,
      categorySamples: 15,
    });
    expect(follower.pBuyYes).toBeGreaterThan(contrarian.pBuyYes);
  });
});

describe("engine — shrinkage damps thin evidence", () => {
  it("the same category lean counts less with fewer samples", () => {
    const thin = predictHouse({
      categoryDirectionalLean: 1,
      categorySamples: 1,
      overallSkipRate: 0.1,
    });
    const thick = predictHouse({
      categoryDirectionalLean: 1,
      categorySamples: 100,
      overallSkipRate: 0.1,
    });
    // More samples → more confident it's a YES buy.
    expect(thick.pBuyYes).toBeGreaterThan(thin.pBuyYes);
  });
});

describe("engine — deterministic tiebreak, never random", () => {
  it("settles an exact YES/NO tie by the salt, reproducibly", () => {
    // No directional signal at all → YES vs NO are tied; tiebreak decides.
    const a = predictHouse({ overallSkipRate: 0 }, 0.1);
    const b = predictHouse({ overallSkipRate: 0 }, 0.1);
    expect(a.action).toBe(b.action);
    const hi = predictHouse({ overallSkipRate: 0 }, 0.99);
    expect(["BUY_YES", "BUY_NO"]).toContain(hi.action);
  });
});

describe("foundation config", () => {
  it("defines exactly the five required, moderately-worded POVs", () => {
    expect(FOUNDATION_MAPPINGS).toHaveLength(FOUNDATION_REQUIRED);
    for (const m of FOUNDATION_MAPPINGS) {
      expect(m.prompt).not.toMatch(/almost all|completely|feared/i);
      expect(Object.keys(m.dimensions.YES).length).toBeGreaterThan(0);
      expect(Object.keys(m.dimensions.NO).length).toBeGreaterThan(0);
    }
  });

  it("YES and NO push a dimension in opposite directions", () => {
    const wallet = FOUNDATION_MAPPINGS[0];
    const yes = applyFoundationAnswer(wallet, "YES");
    const no = applyFoundationAnswer(wallet, "NO");
    expect(Math.sign(yes.interpersonalTrust)).toBe(-Math.sign(no.interpersonalTrust));
  });

  it("accumulates contributions across answers", () => {
    const v = accumulateDimensions([
      applyFoundationAnswer(FOUNDATION_MAPPINGS[0], "YES"),
      applyFoundationAnswer(FOUNDATION_MAPPINGS[0], "YES"),
    ]);
    expect(v.interpersonalTrust).toBeCloseTo(-1.1, 6);
  });

  it("exposes a mapping version for forward-compatible storage", () => {
    expect(FOUNDATION_MAPPING_VERSION).toBe(1);
  });
});
