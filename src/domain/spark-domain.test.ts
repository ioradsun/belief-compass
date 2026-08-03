import { describe, expect, it } from "vitest";
import { sparkDomain, SPARK_DOMAIN } from "./spark-domain";

// How much of the chart height the last value occupies, measured from the top.
// 1 = at the very top of the domain, 0 = at the very bottom.
const heightFrac = (values: number[], baseline: number, opts = {}) => {
  const { min, max } = sparkDomain(values, baseline, opts);
  const last = values[values.length - 1];
  return (last - min) / (max - min);
};

describe("sparkDomain", () => {
  it("renders an immaterial price move as nearly flat (the reported bug)", () => {
    // Baseline 5.63, drifting within ~0.05% — the '0% · stayed flat' case.
    const base = 5.63;
    const values = [5.63, 5.632, 5.631, 5.6285, 5.628];
    const { min, max } = sparkDomain(values, base, SPARK_DOMAIN.price);
    // The domain is dominated by the ±4% materiality floor, not the tiny wiggle.
    expect(max - min).toBeGreaterThan(base * 0.07);
    // The last point sits close to the middle — a flat-looking line, not a cliff.
    const frac = heightFrac(values, base, SPARK_DOMAIN.price);
    expect(frac).toBeGreaterThan(0.4);
    expect(frac).toBeLessThan(0.6);
  });

  it("still lets a genuinely large price move fill most of the box", () => {
    const base = 5.0;
    const values = [5.0, 5.5, 6.0, 7.5]; // +50%
    const { min, max } = sparkDomain(values, base, SPARK_DOMAIN.price);
    // Real data span dominates the floor here.
    expect(max - min).toBeCloseTo(7.5 - 5.0, 5);
  });

  it("always includes the baseline so direction from the start is honest", () => {
    // Every plotted value is below the baseline → the line must read as a decline.
    const base = 100;
    const values = [98, 97, 96];
    const { min, max } = sparkDomain(values, base, { minRelSpan: 0 });
    expect(max).toBeGreaterThanOrEqual(base);
    expect(min).toBeLessThanOrEqual(96);
  });

  it("keeps a lone believer step modest on a small base", () => {
    // 15 → 16 believers: +6.7%. Should be a small step, not full height.
    const frac = heightFrac([15, 16], 15, SPARK_DOMAIN.believers);
    expect(frac).toBeGreaterThan(0.55);
    expect(frac).toBeLessThan(0.8);
  });

  it("uses the absolute floor when the baseline is zero", () => {
    // New side: 0 → 1 believer, base 0 → relative floor is 0, abs floor governs.
    const { min, max } = sparkDomain([0, 1], 0, SPARK_DOMAIN.believers);
    expect(max - min).toBeGreaterThanOrEqual(3);
  });

  it("gives a flat series a real, centered band instead of a zero-height line", () => {
    const { min, max } = sparkDomain([5, 5, 5], 5, SPARK_DOMAIN.price);
    expect(max).toBeGreaterThan(min);
    expect((5 - min) / (max - min)).toBeCloseTo(0.5, 5);
  });

  it("renders a −2% capital move as a gentle slope, not a crash", () => {
    const base = 100;
    const values = [100, 100, 98]; // −2%
    const frac = heightFrac(values, base, SPARK_DOMAIN.capital);
    const baseFrac =
      (base - sparkDomain(values, base, SPARK_DOMAIN.capital).min) /
      (sparkDomain(values, base, SPARK_DOMAIN.capital).max -
        sparkDomain(values, base, SPARK_DOMAIN.capital).min);
    // A gentle dip below the baseline — clearly down, but nowhere near bottomed out.
    expect(frac).toBeLessThan(baseFrac);
    expect(frac).toBeGreaterThan(0.3);
  });

  it("ignores non-finite values without exploding the domain", () => {
    const { min, max } = sparkDomain([NaN, 10, Infinity, 11], 10, { minRelSpan: 0 });
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(min).toBeLessThanOrEqual(10);
    expect(max).toBeGreaterThanOrEqual(11);
  });
});
