/**
 * Conviction DNA — relationship classification (canonical, pure, v1).
 *
 * ZERO IO. The ONE module that turns a DnaScore into a stable RelationshipLabel.
 * Applies, in order: the evidence gate, then per-label entry/exit thresholds with
 * HYSTERESIS — a held label survives down to its (looser) exit threshold, so a
 * relationship does not flap one point either side of an entry boundary.
 */
import { DNA_THRESHOLDS, type DnaThresholdConfig, type RelationshipLabel } from "./config";
import type { DnaScore } from "./score";
import type { RelationshipBand } from "./config";

export interface ClassifyInput {
  currentScore: DnaScore;
  previousRelationship?: RelationshipLabel;
  thresholds?: DnaThresholdConfig;
}

export interface ClassifyResult {
  relationship: RelationshipLabel;
  changed: boolean;
  previousRelationship?: RelationshipLabel;
}

/**
 * Does this band hold? `isHigh` bands (twin/tribe) want agreement ABOVE their
 * threshold; low bands (opp/inverse) want it BELOW. When the label is currently
 * held (`hold`), the looser exit threshold applies — that is the hysteresis.
 */
function bandHolds(band: RelationshipBand, isHigh: boolean, s: DnaScore, hold: boolean): boolean {
  const threshold = hold ? band.exit : band.enter;
  const agreeOk = isHigh ? s.agreement >= threshold : s.agreement <= threshold;
  return agreeOk && s.sharedBeliefs >= band.minShared && s.confidence >= band.minConfidence;
}

export function classifyRelationship(input: ClassifyInput): ClassifyResult {
  const t = input.thresholds ?? DNA_THRESHOLDS;
  const s = input.currentScore;
  const prev = input.previousRelationship;

  let relationship: RelationshipLabel;
  if (s.sharedBeliefs < t.minSharedOverall) {
    relationship = "insufficient";
  } else if (bandHolds(t.twin, true, s, prev === "twin")) {
    relationship = "twin";
  } else if (bandHolds(t.tribe, true, s, prev === "tribe")) {
    relationship = "tribe";
  } else if (bandHolds(t.inverse, false, s, prev === "inverse")) {
    relationship = "inverse";
  } else if (bandHolds(t.opp, false, s, prev === "opp")) {
    relationship = "opp";
  } else {
    relationship = "neutral";
  }

  return {
    relationship,
    changed: (prev ?? "insufficient") !== relationship,
    previousRelationship: prev,
  };
}
