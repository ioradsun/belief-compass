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

/**
 * Directional beliefs (on-chain + expressed) that make the app "calibrated".
 * Matched to the DNA minimum (minSharedOverall) so the moment the reveal fires,
 * the Network can actually compute closest people — no dead payoff.
 */
export const CALIBRATION_TARGET = 5;

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

/* ── Row → factor ────────────────────────────────────────────────────────────
 *
 * THE ONE PLACE a stored belief row becomes a DNA factor, because there used to
 * be two and they disagreed. The network path read a null expressed weight as
 * EXPRESSED_WEIGHT; the profile path read the same null as ZERO — and a factor
 * with zero conviction contributes zero to `sharedWeight`, so the SAME free
 * belief was worth 0.15 of a person's DNA on one screen and nothing at all on
 * the next. Both are IO-free mappings over a row shape, which is exactly the
 * kind of thing that gets rewritten inline instead of imported.
 */

/** A stored `wallet_beliefs` row, narrowed to what DNA reads. */
export interface OnChainBeliefRow {
  onchain_id: number | string;
  stance_side: string | null;
  conviction: number | null;
}

/** A stored `expressed_beliefs` row, narrowed to what DNA reads. */
export interface ExpressedBeliefRow {
  onchain_id: number | string;
  side: string | null;
  weight: number | null;
}

/**
 * A money-backed position. `stance_side` is already constrained to YES/NO by
 * every caller's query, so anything else resolves to YES rather than throwing —
 * a malformed row must not take down a whole viewer's network.
 */
export const onChainFactor = (r: OnChainBeliefRow): DnaFactor => ({
  marketId: Number(r.onchain_id),
  side: r.stance_side === "NO" ? "NO" : "YES",
  conviction: Math.abs(Number(r.conviction ?? 0)),
});

/**
 * A free expressed belief. A MISSING weight means "we never wrote one", not
 * "this belief is worthless" — so it falls back to EXPRESSED_WEIGHT. An explicit
 * zero is honoured, because that is a decision someone recorded.
 */
export const expressedFactor = (r: ExpressedBeliefRow): DnaFactor => ({
  marketId: Number(r.onchain_id),
  side: r.side === "NO" ? "NO" : "YES",
  conviction: Math.abs(Number(r.weight ?? EXPRESSED_WEIGHT)),
});

/** Is this row directional at all? MIXED/INACTIVE never enter DNA. */
export const isDirectional = (side: string | null | undefined): side is "YES" | "NO" =>
  side === "YES" || side === "NO";

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
