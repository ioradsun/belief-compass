import { describe, it, expect } from "vitest";
import {
  mergeBeliefFactors,
  readinessFor,
  onChainFactor,
  expressedFactor,
  isDirectional,
  EXPRESSED_WEIGHT,
  CALIBRATION_TARGET,
} from "./beliefs";
import { scoreRelationship } from "@/domain/dna/score";
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

/**
 * These guard the DIVERGENCE, not the shape of the fix.
 *
 * There were two mappings from a stored belief row to a DnaFactor, and they read
 * a missing expressed weight differently — EXPRESSED_WEIGHT on the network path,
 * ZERO on the profile path. Zero is not a small weight: `scoreRelationship`
 * weights each shared market by `sqrt(convA × convB)`, so a zero-conviction
 * factor contributes nothing at all. The same free belief was therefore worth
 * 0.15 of a relationship on one screen and did not exist on the next.
 */
describe("belief row → DNA factor", () => {
  it("treats a MISSING expressed weight as a real belief, not a worthless one", () => {
    expect(expressedFactor({ onchain_id: 7, side: "YES", weight: null }).conviction).toBe(
      EXPRESSED_WEIGHT,
    );
  });

  it("honours an EXPLICIT zero weight — that is a recorded decision, not an absence", () => {
    expect(expressedFactor({ onchain_id: 7, side: "YES", weight: 0 }).conviction).toBe(0);
  });

  it("a null-weight belief actually moves a relationship (the bug, stated as behaviour)", () => {
    // One shared market, agreed, known only as a free expressed belief on both
    // sides. Read as zero this scores 0% — two people who agree, recorded as
    // total disagreement, because the weights vanished.
    const row = { onchain_id: 1, side: "YES", weight: null } as const;
    const s = scoreRelationship([expressedFactor(row)], [expressedFactor(row)]);
    expect(s.sharedBeliefs).toBe(1);
    expect(s.agreement).toBe(100);
    expect(s.sharedWeight).toBeGreaterThan(0);
  });

  it("reads a missing on-chain conviction as zero — an unevaluated position claims nothing", () => {
    expect(onChainFactor({ onchain_id: 3, stance_side: "NO", conviction: null }).conviction).toBe(
      0,
    );
  });

  it("never yields a negative weight, whichever row it came from", () => {
    expect(onChainFactor({ onchain_id: 3, stance_side: "YES", conviction: -0.4 }).conviction).toBe(
      0.4,
    );
    expect(expressedFactor({ onchain_id: 3, side: "NO", weight: -0.2 }).conviction).toBe(0.2);
  });

  it("carries the side through, defaulting anything that is not NO to YES", () => {
    expect(onChainFactor({ onchain_id: 1, stance_side: "NO", conviction: 1 }).side).toBe("NO");
    expect(expressedFactor({ onchain_id: 1, side: "NO", weight: 1 }).side).toBe("NO");
    expect(onChainFactor({ onchain_id: 1, stance_side: "YES", conviction: 1 }).side).toBe("YES");
  });

  it("both mappers agree on the market id regardless of how it was stored", () => {
    expect(onChainFactor({ onchain_id: "42", stance_side: "YES", conviction: 1 }).marketId).toBe(
      42,
    );
    expect(expressedFactor({ onchain_id: "42", side: "YES", weight: 1 }).marketId).toBe(42);
  });
});

describe("isDirectional", () => {
  it("admits only a taken side", () => {
    expect(isDirectional("YES")).toBe(true);
    expect(isDirectional("NO")).toBe(true);
  });

  it("rejects every non-answer, including the ones the DB actually stores", () => {
    for (const v of ["MIXED", "INACTIVE", "", null, undefined]) {
      expect(isDirectional(v)).toBe(false);
    }
  });
});
