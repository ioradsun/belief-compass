import { describe, it, expect } from "vitest";
import { positionValueUsd, costBasisUsd } from "./position-value";

const RATE = 1868.52;

/**
 * `wallet_beliefs.yes_value_usd` has six readers and zero writers, so it is
 * NULL everywhere. Every reader did `Number(x) || 0` and carried on with a
 * confident zero — which silently killed conviction cohorts, standing facts,
 * whale detection, and the dashboard's held count. The point of this module is
 * that "we do not know" can no longer impersonate "it is zero".
 */
describe("a missing valuation is not a zero valuation", () => {
  it("falls back to what they committed when nothing marked it", () => {
    const v = positionValueUsd({ valueUsd: null, costEth: 0.036, ethUsd: RATE });
    expect(v.source).toBe("cost");
    expect(v.usd).toBeCloseTo(67.27, 1);
  });

  it("says unknown — not zero — when there is no cost either", () => {
    expect(positionValueUsd({ valueUsd: null, costEth: null, ethUsd: RATE })).toEqual({
      usd: 0,
      source: "unknown",
    });
  });

  it("says unknown rather than pricing everything at nothing with no rate", () => {
    // The calc_cache RLS bug priced every trade at $0 for weeks. Losing the
    // rate must cost the CLAIM, never turn every position into dust.
    const v = positionValueUsd({ valueUsd: null, costEth: 0.5, ethUsd: 0 });
    expect(v.source).toBe("unknown");
    expect(v.usd).toBe(0);
  });

  it("treats a marked zero as no valuation at all", () => {
    // A written-but-zero value is the same absence as a null one, and trusting
    // it would re-create the bug in a different column.
    expect(positionValueUsd({ valueUsd: 0, costEth: 0.1, ethUsd: RATE }).source).toBe("cost");
  });

  it("ignores garbage in either field", () => {
    expect(positionValueUsd({ valueUsd: "abc", costEth: "xyz", ethUsd: RATE }).source).toBe(
      "unknown",
    );
    expect(positionValueUsd({ valueUsd: NaN, costEth: 0.1, ethUsd: RATE }).source).toBe("cost");
  });
});

describe("a real valuation always wins", () => {
  it("prefers the marked value over the cost basis", () => {
    const v = positionValueUsd({ valueUsd: 120, costEth: 0.036, ethUsd: RATE });
    expect(v).toEqual({ usd: 120, source: "marked" });
  });

  it("uses the marked value even with no rate available", () => {
    expect(positionValueUsd({ valueUsd: 120, costEth: 0.036, ethUsd: 0 }).usd).toBe(120);
  });
});

/**
 * Worth minus cost, where worth FELL BACK to cost, is a guaranteed zero wearing
 * the costume of a measurement. Anything computing a gain has to be able to
 * refuse, which is what the source is for.
 */
describe("the source is what lets a caller refuse to guess", () => {
  it("distinguishes a measured value from an inferred one", () => {
    expect(positionValueUsd({ valueUsd: 120, costEth: 0.1, ethUsd: RATE }).source).toBe("marked");
    expect(positionValueUsd({ valueUsd: null, costEth: 0.1, ethUsd: RATE }).source).toBe("cost");
  });
});

describe("costBasisUsd returns null, never a misleading zero", () => {
  it("prices a real cost", () => {
    expect(costBasisUsd(0.5, RATE)).toBeCloseTo(934.26, 1);
  });

  it("returns null when the cost or the rate is unknown", () => {
    expect(costBasisUsd(null, RATE)).toBeNull();
    expect(costBasisUsd(0, RATE)).toBeNull();
    expect(costBasisUsd(0.5, 0)).toBeNull();
    expect(costBasisUsd("nonsense", RATE)).toBeNull();
  });
});
