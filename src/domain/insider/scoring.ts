/**
 * SCORING — evidence → judgments.
 *
 * The Insider draws several DISTINCT judgments from the one evidence bag, because
 * different surfaces ask different questions. There is deliberately NO single
 * `insiderScore`: collapsing every question into one number is what eventually
 * makes the product stupid.
 *
 *   momentumScore   — how strongly is the move running?      (Insight uses this)
 *   importanceScore — how much does this deserve to interrupt? (Now ranks on this)
 *   confidence      — how sure are we, given the evidence we have?
 *
 * `null` evidence contributes 0 to a score, but is tracked for confidence — a read
 * built on sparse or stale evidence is a less sure read. Pure, ZERO IO,
 * deterministic.
 */
import type { InsiderEvidence, InsiderJudgment, InsiderSignal } from "./types";

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const num = (v: number | null | undefined): number =>
  v == null || !Number.isFinite(v) ? 0 : v;

/**
 * Importance weights. They sum to 1, so `importanceScore` stays a clean 0..1.
 * Magnitude and novelty lead (a big, unusual thing interrupts); freshness only
 * breaks ties (a stale big thing is still big, just not news).
 */
export const IMPORTANCE_WEIGHTS = {
  magnitude: 0.3,
  novelty: 0.25,
  participation: 0.2,
  capitalFlow: 0.15,
  freshness: 0.1,
} as const;

export function score(e: InsiderEvidence): InsiderJudgment {
  const magnitude = num(e.magnitude);
  const velocity = num(e.velocity);
  const novelty = num(e.novelty);
  const participation = num(e.participation);
  const capitalFlow = num(e.capitalFlow);
  const freshness = num(e.freshness);

  const momentumScore = clamp01(0.6 * magnitude + 0.4 * velocity);
  const importanceScore = clamp01(
    IMPORTANCE_WEIGHTS.magnitude * magnitude +
      IMPORTANCE_WEIGHTS.novelty * novelty +
      IMPORTANCE_WEIGHTS.participation * participation +
      IMPORTANCE_WEIGHTS.capitalFlow * capitalFlow +
      IMPORTANCE_WEIGHTS.freshness * freshness,
  );

  // Confidence: how much of the evidence is actually computed (null ≠ 0), tempered
  // by freshness. Sparse or stale evidence ⇒ a less sure read.
  const dims = [
    e.magnitude,
    e.velocity,
    e.participation,
    e.capitalFlow,
    e.imbalance,
    e.novelty,
    e.freshness,
  ];
  const coverage = dims.filter((d) => d != null).length / dims.length;
  const confidence = clamp01(coverage * (0.5 + 0.5 * freshness));

  return { momentumScore, importanceScore, confidence };
}

/** Attach computed evidence + its judgment to a signal (what the Now builder does). */
export function scoreSignal(signal: InsiderSignal, evidence: InsiderEvidence): InsiderSignal {
  return { ...signal, evidence, judgment: score(evidence) };
}
