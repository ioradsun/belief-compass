/**
 * Conviction DNA — matching thresholds and engine version (Phase 8).
 *
 * ONE owner for every threshold the matcher uses. Queries, the candidate
 * generator, the scorer, and the cache writer all import from here so no route
 * or component re-invents a limit.
 *
 * Score interpretation (confidence-adjusted `match_score`, 0..100):
 *   100 = strongest agreement, 50 = neutral, 0 = strongest opposition.
 * Confidence shrinks the distance from 50 when shared evidence is thin.
 *
 * Bump MATCH_ENGINE_VERSION whenever the formula, thresholds, candidate rules,
 * or domain mapping change materially — caches stamped with an older version are
 * stale (see docs/matching.md).
 */

export const MATCH = {
  /** Bump when scoring/thresholds/candidate/domain semantics change materially. */
  ENGINE_VERSION: 1,

  /** Minimum shared directional markets for an OVERALL relationship claim. */
  MIN_SHARED_OVERALL: 5,
  /** Minimum shared directional markets within a domain for a Circle claim. */
  MIN_SHARED_DOMAIN: 5,

  /** Minimum evidence confidence (shared/(shared+K)) for any surfaced claim. */
  MIN_MATCH_CONFIDENCE: 0.3,

  /** match_score at or above this is a Tribe (confident agreement). */
  TRIBE_SCORE_THRESHOLD: 60,
  /** match_score at or below this is a Rival (confident opposition). */
  RIVAL_SCORE_THRESHOLD: 40,

  /** Candidate pool ceiling that reaches exact scoring. */
  MAX_CANDIDATES: 500,

  /** Bounded cache sizes. */
  MAX_TRIBE_RESULTS: 20,
  MAX_RIVAL_RESULTS: 20,
  MAX_DOMAIN_RESULTS: 10,

  /** Viewer cache freshness window. */
  CACHE_TTL_MS: 60 * 60 * 1000,
} as const;

/** Canonical (neutral) relationship semantics — product copy lives in the UI. */
export type RelationshipType = "tribe" | "rival" | "neutral" | "insufficient_evidence";
