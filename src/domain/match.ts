/**
 * Conviction DNA — relationship layer (Phase 8).
 *
 * ZERO IO. Sits on top of the ONE canonical exact scorer (`matchScore` in
 * domain.ts) and turns its evidence into neutral relationship semantics. The
 * scoring formula itself is NOT redefined here — performance in Phase 8 comes
 * from scoring fewer pairs, not from weakening the comparison.
 */
import { matchScore, type BeliefFactor, type MatchResult } from "./domain";
import { MATCH, type RelationshipType } from "./match-config";

export { matchScore };
export type { BeliefFactor, MatchResult, RelationshipType };

/** Confidence shrink used by the canonical formula: shared / (shared + 8). */
export const CONFIDENCE_K = 8;
export function matchConfidence(shared: number): number {
  if (shared <= 0) return 0;
  return shared / (shared + CONFIDENCE_K);
}

/**
 * Exact DNA score for one viewer↔candidate pair, with the evidence a debugger
 * (or classifier) needs. Thin, deterministic wrapper over the canonical scorer.
 */
export interface WalletMatch extends MatchResult {
  confidence: number;
  relationship: RelationshipType;
}

export function scoreWalletMatch(
  viewer: BeliefFactor[],
  candidate: BeliefFactor[],
  minShared: number = MATCH.MIN_SHARED_OVERALL,
): WalletMatch {
  const r = matchScore(viewer, candidate);
  const confidence = matchConfidence(r.shared);
  return { ...r, confidence, relationship: classifyRelationship(r, confidence, minShared) };
}

/**
 * Neutral classification from raw evidence. Evidence is the gate: high raw
 * agreement over too-few shared markets is `insufficient_evidence`, never a
 * Tribe. Between the two score thresholds the pair is `neutral` (enough
 * evidence, no strong lean) and is NOT cached as a relationship.
 */
export function classifyRelationship(
  r: MatchResult,
  confidence: number = matchConfidence(r.shared),
  minShared: number = MATCH.MIN_SHARED_OVERALL,
): RelationshipType {
  if (r.shared < minShared || confidence < MATCH.MIN_MATCH_CONFIDENCE) {
    return "insufficient_evidence";
  }
  if (r.match_score >= MATCH.TRIBE_SCORE_THRESHOLD) return "tribe";
  if (r.match_score <= MATCH.RIVAL_SCORE_THRESHOLD) return "rival";
  return "neutral";
}

/**
 * Confidence-adjusted ranking key. Tribe strength is agreement ABOVE neutral
 * weighted by evidence, so a 94% match over 60 markets can outrank a 98% match
 * over 5. Symmetric for opposition (below neutral). Returns a value where higher
 * = stronger agreement, lower (negative) = stronger opposition.
 */
export function agreementStrength(r: MatchResult, confidence = matchConfidence(r.shared)): number {
  return (r.match_score - 50) * confidence;
}
