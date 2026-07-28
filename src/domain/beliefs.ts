/**
 * Belief substrate helpers (pure, no IO).
 *
 * A viewer's belief graph is the UNION of money-backed on-chain positions and
 * free "expressed" beliefs. Expressed beliefs feed DNA / Network / House too, but
 * at a low fixed weight so real conviction always dominates, and an on-chain
 * position on a market always overrides a free one on the same market.
 */
import type { DnaFactor } from "@/domain/dna/score";

/** Fixed conviction weight for a free expressed belief (vs on-chain 0..1). */
export const EXPRESSED_WEIGHT = 0.15;

/** Directional beliefs (on-chain + expressed) that make the app "calibrated". */
export const CALIBRATION_TARGET = 8;

/**
 * Merge on-chain and expressed factors, deduped by market. On-chain always wins
 * on a shared market (money beats a free tap); expressed fills the rest.
 */
export function mergeBeliefFactors(onChain: DnaFactor[], expressed: DnaFactor[]): DnaFactor[] {
  const byMarket = new Map<string, DnaFactor>();
  for (const f of expressed) byMarket.set(String(f.marketId), f);
  for (const f of onChain) byMarket.set(String(f.marketId), f); // on-chain overrides
  return [...byMarket.values()];
}

export interface Readiness {
  /** Distinct directional beliefs the viewer holds (on-chain + expressed). */
  count: number;
  target: number;
  /** Beliefs still needed to calibrate (never negative). */
  remaining: number;
  /** 0..1 progress toward calibration. */
  progress: number;
  /** True once the viewer has enough belief signal for the full experience. */
  calibrated: boolean;
}

/** Turn a raw belief count into the one readiness signal every surface reads. */
export function readinessFor(count: number, target: number = CALIBRATION_TARGET): Readiness {
  const c = Math.max(0, Math.floor(count));
  const t = Math.max(1, Math.floor(target));
  const remaining = Math.max(0, t - c);
  return {
    count: c,
    target: t,
    remaining,
    progress: Math.min(1, c / t),
    calibrated: c >= t,
  };
}
