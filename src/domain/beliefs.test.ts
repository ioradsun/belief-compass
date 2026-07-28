import { describe, it, expect } from "vitest";
import { mergeBeliefFactors, readinessFor, EXPRESSED_WEIGHT, CALIBRATION_TARGET } from "./beliefs";
import type { DnaFactor } from "@/domain/dna/score";

const f = (marketId: number, side: "YES" | "NO", conviction: number): DnaFactor => ({
  marketId,
  side,
  conviction,
});

describe("mergeBeliefFactors", () => {
  it("unions distinct markets", () => {
    const merged = mergeBeliefFactors([f(1, "YES", 0.9)], [f(2, "NO", EXPRESSED_WEIGHT)]);
    expect(merged).toHaveLength(2);
    expect(merged.map((x) => Number(x.marketId)).sort()).toEqual([1, 2]);
  });
  it("on-chain overrides an expressed belief on the same market", () => {
    const merged = mergeBeliefFactors([f(1, "YES", 0.9)], [f(1, "NO", EXPRESSED_WEIGHT)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].side).toBe("YES");
    expect(merged[0].conviction).toBe(0.9);
  });
  it("keeps the expressed belief when there's no on-chain one", () => {
    const merged = mergeBeliefFactors([], [f(3, "NO", EXPRESSED_WEIGHT)]);
    expect(merged).toEqual([f(3, "NO", EXPRESSED_WEIGHT)]);
  });
});

describe("readinessFor", () => {
  it("reports progress toward the target", () => {
    const r = readinessFor(3);
    expect(r.count).toBe(3);
    expect(r.target).toBe(CALIBRATION_TARGET);
    expect(r.remaining).toBe(CALIBRATION_TARGET - 3);
    expect(r.calibrated).toBe(false);
    expect(r.progress).toBeCloseTo(3 / CALIBRATION_TARGET, 6);
  });
  it("calibrates at the target and clamps beyond it", () => {
    const r = readinessFor(CALIBRATION_TARGET + 5);
    expect(r.calibrated).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.progress).toBe(1);
  });
  it("guards junk input", () => {
    const r = readinessFor(-4);
    expect(r.count).toBe(0);
    expect(r.remaining).toBe(CALIBRATION_TARGET);
  });
});
