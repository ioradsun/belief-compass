import { describe, it, expect } from "vitest";
import { positionValueUsd, costBasisUsd, isMeasured, VALUE } from "./position-value";

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
      freshness: "unknown",
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
    const v = positionValueUsd({
      valueUsd: 120,
      valueUpdatedAt: Date.now(),
      costEth: 0.036,
      ethUsd: RATE,
    });
    expect(v).toEqual({ usd: 120, source: "marked", freshness: "current" });
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

/**
 * REGRESSION 1. The exact shape that emptied conviction cohorts, the standing
 * -fact pool, whale detection and the dashboard: a real holder whose marked
 * value is missing must still clear the dust gate on what they committed.
 */
describe("regression — a holder with no marked value still clears the dust gate", () => {
  const DUST_FLOOR = 5;

  it("passes on cost basis alone", () => {
    // 0.036 ETH ≈ $67 — comfortably real money, and previously read as $0.
    const v = positionValueUsd({ valueUsd: null, costEth: 0.036, ethUsd: RATE });
    expect(v.usd).toBeGreaterThan(DUST_FLOOR);
    expect(v.freshness).toBe("fallback");
  });

  it("still rejects something that is genuinely dust", () => {
    const v = positionValueUsd({ valueUsd: null, costEth: 0.0001, ethUsd: RATE });
    expect(v.usd).toBeLessThan(DUST_FLOOR);
  });
});

/**
 * REGRESSION 3. Worth minus cost, where worth FELL BACK to cost, is identically
 * zero — a guaranteed non-result wearing the costume of a measurement. The
 * source is what lets a caller refuse to publish it.
 */
describe("regression — a fallback valuation never produces a fake gain or loss", () => {
  it("cannot yield a non-zero gain against its own cost basis", () => {
    const cost = 0.036;
    const worth = positionValueUsd({ valueUsd: null, costEth: cost, ethUsd: RATE });
    const gain = worth.usd - costBasisUsd(cost, RATE)!;
    expect(gain).toBe(0);
    // And the caller is told not to claim one at all.
    expect(worth.source).not.toBe("marked");
  });

  it("marks the one condition a gain may be computed under", () => {
    const fallback = positionValueUsd({ valueUsd: null, costEth: 0.036, ethUsd: RATE });
    const unknown = positionValueUsd({ valueUsd: null, costEth: null, ethUsd: RATE });
    const real = positionValueUsd({
      valueUsd: 120,
      valueUpdatedAt: Date.now(),
      costEth: 0.036,
      ethUsd: RATE,
    });
    const mayClaimGain = (v: typeof real) => v.source === "marked";
    expect(mayClaimGain(fallback)).toBe(false);
    expect(mayClaimGain(unknown)).toBe(false);
    expect(mayClaimGain(real)).toBe(true);
  });
});

/**
 * REGRESSION 4. Once the writer runs, the fallback must get out of the way —
 * otherwise the stopgap quietly becomes the valuation system.
 */
describe("regression — a marked valuation replaces the fallback once available", () => {
  const NOW = 1_800_000_000_000;

  it("switches from cost basis to the marked value", () => {
    const before = positionValueUsd({ valueUsd: null, costEth: 0.036, ethUsd: RATE, nowMs: NOW });
    expect(before.source).toBe("cost");
    const after = positionValueUsd({
      valueUsd: 120,
      valueUpdatedAt: NOW - 60_000,
      costEth: 0.036,
      ethUsd: RATE,
      nowMs: NOW,
    });
    expect(after).toEqual({ usd: 120, source: "marked", freshness: "current" });
  });

  it("reports the four freshness states a reader has to tell apart", () => {
    const f = (o: Parameters<typeof positionValueUsd>[0]) =>
      positionValueUsd({ ...o, nowMs: NOW }).freshness;
    expect(f({ valueUsd: 120, valueUpdatedAt: NOW - 60_000 })).toBe("current");
    expect(f({ valueUsd: 120, valueUpdatedAt: NOW - VALUE.staleAfterMs - 1 })).toBe("stale");
    expect(f({ valueUsd: null, costEth: 0.1, ethUsd: RATE })).toBe("fallback");
    expect(f({ valueUsd: null, costEth: null })).toBe("unknown");
  });

  it("treats a marked value with no timestamp as stale, not current", () => {
    // An unknown age is not a fresh one — the same rule the module exists for.
    expect(positionValueUsd({ valueUsd: 120, nowMs: NOW }).freshness).toBe("stale");
  });
});

/**
 * RANK 2 — THE LIVE MARK.
 *
 * This ranking existed in the product before it existed here: `MyConvictions`
 * computed `marked ? reported : shares * price` inline, with a price chain that
 * ended `?? 0`. A market the read model had no price for produced
 * `shares x 0 = 0`, and an `if (!(value > 0))` filter then dropped the row — the
 * holder's own position vanished from their own Positions list.
 */
describe("the live mark", () => {
  const FRESH = { valueUpdatedAt: Date.now() };

  it("outranks a STALE mark, because it is an actual measurement of now", () => {
    const old = new Date(Date.now() - VALUE.staleAfterMs - 1).toISOString();
    const v = positionValueUsd({
      valueUsd: 100,
      valueUpdatedAt: old,
      shares: 50,
      priceUsd: 3,
    });
    expect(v).toEqual({ usd: 150, source: "live", freshness: "current" });
  });

  it("does NOT outrank a fresh mark, which is the shared answer", () => {
    // Same arithmetic either way — belief-rollup computes shares x price too.
    // Preferring the mark is what keeps this figure equal to the one cohorts,
    // whale detection and the dashboard are using.
    const v = positionValueUsd({ valueUsd: 100, ...FRESH, shares: 50, priceUsd: 3 });
    expect(v.source).toBe("marked");
    expect(v.usd).toBe(100);
  });

  it("falls back to the stale mark when there is no price to mark against", () => {
    const old = new Date(Date.now() - VALUE.staleAfterMs - 1).toISOString();
    const v = positionValueUsd({ valueUsd: 100, valueUpdatedAt: old, shares: 50, priceUsd: null });
    expect(v).toEqual({ usd: 100, source: "marked", freshness: "stale" });
  });

  it("REFUSES to mark at a price of zero", () => {
    // The exact defect: `shares x 0` is not a small number, it is a confident
    // claim that a real holding is worthless.
    const v = positionValueUsd({ shares: 50, priceUsd: 0, costEth: 0.01, ethUsd: RATE });
    expect(v.source).toBe("cost");
    expect(v.usd).toBeCloseTo(0.01 * RATE, 6);
  });

  it("says unknown rather than zero when nothing can price a real holding", () => {
    const v = positionValueUsd({ shares: 50, priceUsd: null });
    expect(v).toEqual({ usd: 0, source: "unknown", freshness: "unknown" });
  });

  it("does not mark a side the reader does not hold", () => {
    const v = positionValueUsd({ shares: 0, priceUsd: 3 });
    expect(v.source).toBe("unknown");
  });
});

describe("isMeasured", () => {
  it("separates a measurement of worth from a stand-in for one", () => {
    // A gain computed against `cost` is worth-minus-cost where worth IS cost —
    // a guaranteed zero dressed up as a measurement.
    expect(isMeasured({ usd: 1, source: "marked", freshness: "current" })).toBe(true);
    expect(isMeasured({ usd: 1, source: "live", freshness: "current" })).toBe(true);
    expect(isMeasured({ usd: 1, source: "cost", freshness: "fallback" })).toBe(false);
    expect(isMeasured({ usd: 0, source: "unknown", freshness: "unknown" })).toBe(false);
  });
});
