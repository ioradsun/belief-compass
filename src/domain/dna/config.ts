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
export const DNA_ENGINE_VERSION = 2;

/** Canonical stored relationship labels (product copy like "Bizarro" stays in UI). */
export type RelationshipLabel = "twin" | "tribe" | "neutral" | "opp" | "inverse" | "insufficient";

/** User-facing evidence tiers, derived from shared directional-belief count. */
export type EvidenceLevel = "insufficient" | "early" | "growing" | "established";

/**
 * THE CANONICAL RELATIONSHIP EVIDENCE GATE. One number, one meaning.
 *
 * Three constants used to encode this single product idea at three different
 * values — `MATURE_MIN_SHARED` (10) decided when a percentage could be shown,
 * `DOMAIN_MIN_SHARED` (5) when a Circle was real, `MIN_SHARED_FOR_PATTERN` (5) in
 * call-line when a pattern could be claimed — and `DNA_THRESHOLDS` added a fourth
 * at 5 plus per-band floors of 8 and 20. Six numbers for "how much shared history
 * is enough". That is implementation leaking into the product, and it leaked in
 * the worst direction: the strictest gate won, so almost nothing was ever said.
 *
 * WHY THREE, and this is a structural argument rather than a lowered bar.
 * Conviction Match is `together / shared`, so `shared` fixes which percentages
 * are even reachable:
 *
 *     2 shared →   0% ·  50% · 100%
 *     3 shared →   0% ·  33% ·  67% · 100%
 *
 * At two, the middle outcome is 50% — dead centre of the unlabelled band, and
 * unreachable by any cut that is not arbitrary. Measured in production, 419 of
 * the 959 two-market pairs sit exactly there: **44% of them are unplaceable by
 * construction, not by lack of evidence.** At three, every reachable outcome
 * falls cleanly on one side or the other of 67/33. Three is the smallest shared
 * count at which the model can say something about every possible pair.
 *
 * Measured: gate 3 labels 813 relationships against 71 at gate 10, and Rival —
 * the one worth having — goes from 5 to 198.
 */
export const RELATIONSHIP_MIN_SHARED = 3;

export interface RelationshipBand {
  /** agreement to ENTER the label. */
  enter: number;
  /** agreement to keep the label once held (hysteresis; wider than enter). */
  exit: number;
}

export interface DnaThresholdConfig {
  /** Below this many shared directional beliefs → no relationship at all. */
  minSharedOverall: number;
  /** Shared beliefs / (shared + K). Ranking and reporting only — NOT labelling. */
  confidenceK: number;
  tribe: RelationshipBand;
  opp: RelationshipBand;
}

/**
 * TWO CUTS ON ONE NUMBER, AND NOTHING ELSE.
 *
 * The old table had four bands, each carrying its own `minShared` AND its own
 * `minConfidence`, over a `minSharedOverall` — nine numbers deciding one thing.
 *
 * `minConfidence` is gone, and the audit is worth recording because the answer
 * was stronger than "it no longer matters": confidence is `shared / (shared + 8)`,
 * a MONOTONE FUNCTION OF THE SAME `shared` that `minShared` already tested. So
 * tribe's 0.4 implied shared ≥ 6 while its `minShared` demanded 8, and twin's 0.7
 * implied 19 against a demand of 20. **Every gate was strictly weaker than the
 * one beside it, so `minConfidence` never once changed a classification.** It was
 * a second authoritative-looking definition of a rule already enforced.
 * `confidenceFor` survives for ranking and reporting; it no longer touches a
 * label.
 *
 * TWIN AND INVERSE ARE GONE FROM THE TABLE, not held dormant. They were withheld
 * from display already, so keeping their bands meant a live classifier path whose
 * output no surface could show — and at the canonical gate of three, `twin` would
 * have claimed every 3-of-3 pair, which is exactly the label the product does not
 * want to hand out on three markets. The enum members remain because the cache
 * columns and the DNA stage ladder are keyed on them; the THRESHOLDS do not,
 * because a rule the product does not apply must not look like one it does.
 *
 * The bands are deliberately broad. This is social discovery, not personality
 * testing — the job is to say something interesting enough to prompt another
 * interaction, and a band narrow enough to be defensible is too narrow to fire.
 */
export const DNA_THRESHOLDS: DnaThresholdConfig = {
  minSharedOverall: RELATIONSHIP_MIN_SHARED,
  confidenceK: 8,
  // 67% keeps the Tribe gate at the high third; 45% for Rival surfaces natural
  // opposition without demanding near-perfect disagreement. Exit widens by five
  // points for hysteresis.
  tribe: { enter: 67, exit: 62 },
  opp: { enter: 45, exit: 50 },
};

/**
 * WHAT A CONVICTION SOMEONE HAS LEFT IS STILL WORTH.
 *
 * DNA read only OPEN positions, so the moment either person exited a market, every
 * agreement they ever had there vanished — the shared count fell, and Match was
 * recomputed as though the two had never met. That is not an edge case: 43.5% of
 * all wallet-market positions in production are fully exited, and rerunning the
 * engine over "any side ever held" instead of "held right now" takes pairs with
 * eight or more shared convictions from 22 to 174.
 *
 * So a past conviction still counts. It counts LESS, because the question the
 * product answers is "how do we believe" and not "how did we once believe" — but
 * it does not count as nothing, because two people who backed opposite sides of
 * the same question last month genuinely did cross paths there.
 *
 * A QUARTER, and the number is chosen to be legible rather than tuned. Four
 * remembered convictions weigh what one live one does: enough that a long shared
 * history is visible, little enough that four exits can never outvote the market
 * you are both standing in today. It is one constant with one meaning, which is
 * the bar §17 of the review set — if explaining Match needs a paragraph about
 * coefficients, the model has gone wrong.
 *
 * It applies to BOTH sides of the ledger: to how much a shared market moves the
 * percentage, and to how much of the evidence bar it fills.
 */
export const PAST_WEIGHT = 0.25;

/**
 * Per-domain (Circle) evidence floor. Points at the canonical gate rather than
 * holding its own number — a Circle is a relationship claim about a topic, and
 * "enough shared history to say something" cannot mean two different things
 * depending on which surface is asking.
 */
export const DOMAIN_MIN_SHARED = RELATIONSHIP_MIN_SHARED;

/**
 * WHERE TWIN AND OPP ARE DEFINED: NOWHERE, DELIBERATELY.
 *
 * `EARNED_LABELS` used to sit here — a second set of thresholds for Twin and Opp
 * (90% over 15 shared across 3 topics) layered on top of `DNA_THRESHOLDS.twin`
 * and `.inverse`. Because the presentation layer re-tested the GROUP rather than
 * the engine's label, the two definitions were both live and the looser one won:
 * a pair the engine called `tribe` could display "Twin".
 *
 * It is deleted rather than left dormant. A constant that looks authoritative and
 * has no consumer is worse than an absence — the next reader reasonably assumes
 * it is part of the active model, and whoever revives Twin would rebuild it from
 * a partial definition written against evidence that has since moved.
 *
 * THE VISIBLE SPECTRUM IS TRIBE AND RIVAL ONLY. Twin and Opp are withheld until
 * production evidence supports reintroducing them THROUGH THE CANONICAL
 * CLASSIFIER — measured at the time of writing, the entire platform contained one
 * pair that would have qualified as Twin and none that would have qualified as
 * Opp. When they return, topic breadth joins whatever single source of truth
 * exists then; it does not wait here in the meantime.
 */

/**
 * Evidence floor to appear in the primary Tribe / Rivals lists at all. Below this
 * there's no shared history worth a relationship — the person is search-only.
 * Deliberately low so a thin viewer's People are never empty, while the mature
 * percentage (and earned labels) still wait for real evidence.
 */
export const RELATIONSHIP_LIST_MIN_SHARED = 1;

/**
 * "Closest people" floor — the graceful fallback when no one crosses a real
 * relationship band yet. Anyone sharing at least this many directional beliefs is
 * eligible to appear as a closest match, so a new/thin viewer's Network is never
 * empty and keeps morphing as they express more. Much lower than minSharedOverall
 * (which still gates the strong Twin/Tribe/Opp/Inverse labels).
 */
export const CLOSEST_MIN_SHARED = 1;
export const CLOSEST_LIMIT = 24;

/** A "Circle" = a domain with at least this many qualified Twin/Tribe relationships. */
export const CIRCLE_MIN_PEOPLE = 5;

/** Candidate generation + retention caps (bounded scale). */
export const DNA_LIMITS = {
  // Score the whole believer universe (currently in the hundreds), not a slice.
  maxExactScored: 2000,
  maxRetainedOverall: 100,
  maxPerGroup: 30,
} as const;

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
