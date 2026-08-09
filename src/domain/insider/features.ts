/**
 * FEATURES — the universal evidence, calculated ONCE.
 *
 * "Calculate the evidence once; interpret it differently per surface." This is the
 * bridge from the market's aggregate read (`InsiderPulse`) to the per-signal
 * `InsiderEvidence` bag that scoring and the projections read. A signal about the
 * market as a whole inherits the market's dimensions; a per-actor builder may
 * override `magnitude` with the actor's own move before scoring.
 *
 * Freshness is the one dimension the pulse cannot carry (the pulse is timeless;
 * a signal has a "when"), so it is computed here from the occurrence time.
 *
 * `null` means "not computed", never "zero" — a scorer must be able to tell an
 * unknown dimension from a genuinely flat one.
 *
 * Pure, ZERO IO, deterministic.
 */
import type { InsiderEvidence, InsiderPulse } from "./types";

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * A signal is half as fresh after this long. 3h matches the tape's sense of
 * "recent" — beyond it a beat reads as context, not news.
 */
export const FRESH_HALF_LIFE_MS = 3 * 60 * 60_000;

/**
 * Recency as a 0..1 decay. `null` when the occurrence time is unknown (never 0 —
 * "we don't know when" is not "it is old"). 1 at/after now, halving every
 * `halfLifeMs`.
 */
export function freshnessOf(
  occurredAtMs: number | null | undefined,
  nowMs: number,
  halfLifeMs: number = FRESH_HALF_LIFE_MS,
): number | null {
  if (occurredAtMs == null || !Number.isFinite(occurredAtMs) || halfLifeMs <= 0) return null;
  const age = nowMs - occurredAtMs;
  if (age <= 0) return 1;
  return clamp01(Math.pow(0.5, age / halfLifeMs));
}

/**
 * Lift the market pulse into per-signal evidence. The market IS the evidence for a
 * market-shaped signal; `freshness` is supplied separately (default: unknown).
 */
export function evidenceFromPulse(
  pulse: InsiderPulse,
  freshness: number | null = null,
): InsiderEvidence {
  return {
    magnitude: pulse.momentum,
    velocity: pulse.acceleration,
    participation: pulse.participation,
    capitalFlow: pulse.capitalFlow,
    imbalance: pulse.imbalance,
    novelty: pulse.novelty,
    freshness,
  };
}
