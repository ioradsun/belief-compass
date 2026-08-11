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
 * THE ONBOARDING GOAL — and it is deliberately NOT the calibration target.
 *
 * Five is the point at which a pattern becomes RECOGNIZABLE: the DNA minimum, the
 * moment the Network can compute closest people, and the threshold a Simulation
 * Challenge unlocks at. Ten is the point at which somebody's profile is DONE
 * enough to stop onboarding them — it is what the first-run brief counts toward
 * and what ends Simulation.
 *
 * They were never the same number and must not be collapsed into one. Raising
 * CALIBRATION_TARGET to 10 to make Simulation graduate correctly would silently
 * withhold the Network from everybody between five and ten convictions, which is
 * exactly the population this whole mode exists to serve.
 */
export const PROFILE_TARGET = 10;

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

/**
 * A conviction someone has LEFT — direction remembered, strength unknown.
 *
 * The stored `conviction` on an exited row is 0, because conviction is computed
 * from a position's live value and there is no position left. Passing that
 * through would make every remembered belief weigh exactly nothing — the pair
 * weight is `sqrt(convA × convB)` — and PAST_WEIGHT would have nothing to scale.
 * History would have been "included" and still counted for zero, which is the
 * quietest possible way for this whole change to do nothing.
 *
 * So a remembered conviction makes NO STRENGTH CLAIM. We genuinely do not know
 * how hard someone believed in a market they have closed, and reaching for the
 * conviction they had at some earlier moment would be inventing a number. It
 * carries a direction at full nominal strength, and `PAST_WEIGHT` in the scorer
 * is the ONE discount applied to it.
 *
 * In practice that lands it below a quarter of a live conviction rather than at
 * exactly a quarter, since live convictions sit around 0.6–1.0 — the error is in
 * the direction of counting memories for less, which is the right way to be
 * wrong.
 */
export const pastFactor = (r: {
  onchain_id: number | string;
  last_directional_side: string | null;
}): DnaFactor => ({
  marketId: Number(r.onchain_id),
  side: r.last_directional_side === "NO" ? "NO" : "YES",
  conviction: 1,
  past: true,
});

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

/**
 * HOW FAR THROUGH THE FIRST TEN — the same fold, against the other target.
 *
 * `count` is DISTINCT MARKETS the viewer has taken a direction on, from any of
 * the four sources the belief layer recognises: a live money-backed position, a
 * remembered one, a completed Simulation position, or any other expressed
 * belief. Deduplicated by market, so holding both sides, adding to a position or
 * changing sides is one conviction — the market is the unit, not the trade.
 */
export interface ProfileProgress {
  count: number;
  target: number;
  /** Convictions still needed (never negative). */
  remaining: number;
  /** 0..1 progress toward the goal. */
  progress: number;
  /** The profile has enough signal — onboarding is over. */
  complete: boolean;
}

/** Turn a raw distinct-belief count into the one onboarding progress signal. */
export function profileProgressFor(
  count: number,
  target: number = PROFILE_TARGET,
): ProfileProgress {
  const r = readinessFor(count, target);
  return {
    count: r.count,
    target: r.target,
    remaining: r.remaining,
    progress: r.progress,
    complete: r.calibrated,
  };
}
