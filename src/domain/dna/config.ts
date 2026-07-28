/**
 * Conviction DNA — thresholds, labels, and engine version (canonical, v1).
 *
 * ONE owner for every DNA constant. Scoring, classification, candidate limits,
 * cache freshness, and the UI all import from here so no route or component
 * re-invents a threshold.
 *
 * agreement is a conviction-weighted SAME-SIDE fraction in [0,100]:
 *   100 = every shared belief on the same side, 0 = every one opposite, 50 = split.
 * confidence is kept SEPARATE (never multiplied into agreement) — a small perfect
 * sample stays "100% over 6 shared / Early", not a misleadingly low number.
 */

/** Bump when scoring rules, thresholds, or candidate rules change materially. */
export const DNA_ENGINE_VERSION = 1;

/** Canonical stored relationship labels (product copy like "Bizarro" stays in UI). */
export type RelationshipLabel = "twin" | "tribe" | "neutral" | "opp" | "inverse" | "insufficient";

/** User-facing evidence tiers, derived from shared directional-belief count. */
export type EvidenceLevel = "insufficient" | "early" | "growing" | "established";

export interface RelationshipBand {
  /** agreement to ENTER the label. */
  enter: number;
  /** agreement to keep the label once held (hysteresis; wider than enter). */
  exit: number;
  /** minimum shared directional beliefs. */
  minShared: number;
  /** minimum confidence. */
  minConfidence: number;
}

export interface DnaThresholdConfig {
  /** Below this many shared directional beliefs → no relationship at all. */
  minSharedOverall: number;
  /** Shared beliefs / (shared + K). */
  confidenceK: number;
  twin: RelationshipBand;
  tribe: RelationshipBand;
  opp: RelationshipBand;
  inverse: RelationshipBand;
}

export const DNA_THRESHOLDS: DnaThresholdConfig = {
  minSharedOverall: 5,
  confidenceK: 8,
  // High-confidence bands (Twin/Inverse) require ≥20 shared → confidence ≥0.71.
  twin: { enter: 93, exit: 90, minShared: 20, minConfidence: 0.7 },
  inverse: { enter: 10, exit: 15, minShared: 20, minConfidence: 0.7 },
  // Standard bands (Tribe/Opp) require ≥8 shared → confidence ≥0.5.
  tribe: { enter: 77, exit: 72, minShared: 8, minConfidence: 0.4 },
  opp: { enter: 33, exit: 38, minShared: 8, minConfidence: 0.4 },
};

/** Per-domain (Circle) evidence floor — one shared market never makes a Circle. */
export const DOMAIN_MIN_SHARED = 5;

/**
 * "Closest people" floor — the graceful fallback when no one crosses a real
 * relationship band yet. Anyone sharing at least this many directional beliefs is
 * eligible to appear as a closest match, so a new/thin viewer's Network is never
 * empty and keeps morphing as they express more. Much lower than minSharedOverall
 * (which still gates the strong Twin/Tribe/Opp/Inverse labels).
 */
export const CLOSEST_MIN_SHARED = 2;
export const CLOSEST_LIMIT = 24;

/** A "Circle" = a domain with at least this many qualified Twin/Tribe relationships. */
export const CIRCLE_MIN_PEOPLE = 5;

/** Candidate generation + retention caps (bounded scale). */
export const DNA_LIMITS = {
  maxExactScored: 300,
  maxRetainedOverall: 100,
  maxPerGroup: 30,
} as const;

/** A directional-state or conviction change this large is "match-relevant". */
export const CONVICTION_MATERIAL_DELTA = 0.05;

/** A relationship event fires only when agreement moves at least this much. */
export const MATERIAL_SCORE_DELTA = 5;

/** Viewer cache TTL for active viewers. */
export const DNA_CACHE_TTL_MS = 15 * 60 * 1000;

/** Shared-belief count → user-facing evidence level. */
export function evidenceLevelFor(sharedBeliefs: number): EvidenceLevel {
  if (sharedBeliefs < 5) return "insufficient";
  if (sharedBeliefs < 10) return "early";
  if (sharedBeliefs < 25) return "growing";
  return "established";
}

/** Confidence shrink — separate from agreement, used only for gating. */
export function confidenceFor(sharedBeliefs: number, k = DNA_THRESHOLDS.confidenceK): number {
  if (sharedBeliefs <= 0) return 0;
  return sharedBeliefs / (sharedBeliefs + k);
}
