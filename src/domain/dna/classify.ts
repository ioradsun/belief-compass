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

/**
 * The three numbers a label actually depends on.
 *
 * Exported so a PRESENTATION layer can ask this module for the label without
 * fabricating a whole DnaScore — the per-side weight fields are never read here,
 * and a caller inventing them to satisfy a type is how a second, subtly
 * different classifier gets written instead of this one being reused.
 */
export interface ClassifiableScore {
  agreement: number;
  /**
   * Shared convictions in CURRENT-EQUIVALENT terms — `DnaScore.evidence`, not
   * the raw shared count. When nobody has left anything the two are identical,
   * which is why every threshold below still means exactly what it meant before
   * remembered convictions were allowed to count at all.
   */
  evidence: number;
  confidence: number;
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
function bandHolds(
  band: RelationshipBand,
  isHigh: boolean,
  s: ClassifiableScore,
  hold: boolean,
): boolean {
  const threshold = hold ? band.exit : band.enter;
  // Match alone. The per-band `minShared` is gone because `minSharedOverall` is
  // now the ONE gate every label passes through, and `minConfidence` is gone
  // because confidence is `shared / (shared + K)` — a monotone function of the
  // same count, so it never once bound a classification the count had not.
  //
  // ROUNDED, BECAUSE THE LABEL MUST AGREE WITH THE NUMBER ON SCREEN. `agreement`
  // is unrounded while `convictionMatch` — the only percentage a reader ever sees
  // — rounds. At three shared markets the outcomes are exactly the thirds, 66.67%
  // and 33.33%, so an unrounded comparison against 67/33 would have put a card
  // reading "67% Conviction Match" next to no label at all, on the single case
  // that justifies making three the gate. Classify the number you display.
  const match = Math.round(s.agreement);
  return isHigh ? match >= threshold : match <= threshold;
}

/**
 * THE label rule, and the only one. Takes the three numbers it reads rather than
 * a full DnaScore so every surface — the engine, the People page, the spectrum —
 * can reach it. See `classifyRelationship` for the DnaScore-shaped entry point.
 */
export function labelFor(
  s: ClassifiableScore,
  previousRelationship?: RelationshipLabel,
  thresholds?: DnaThresholdConfig,
): RelationshipLabel {
  const t = thresholds ?? DNA_THRESHOLDS;
  const prev = previousRelationship;
  // THE ONLY EVIDENCE GATE. Three shared markets, and then two cuts on Conviction
  // Match. `twin` and `inverse` are not tested: they are withheld from every
  // surface, and at this gate `twin` would have claimed every 3-of-3 pair.
  if (s.evidence < t.minSharedOverall) return "insufficient";
  if (bandHolds(t.tribe, true, s, prev === "tribe")) return "tribe";
  if (bandHolds(t.opp, false, s, prev === "opp")) return "opp";
  return "neutral";
}

export function classifyRelationship(input: ClassifyInput): ClassifyResult {
  const t = input.thresholds ?? DNA_THRESHOLDS;
  const s = input.currentScore;
  const prev = input.previousRelationship;

  const relationship = labelFor(s, prev, t);

  return {
    relationship,
    changed: (prev ?? "insufficient") !== relationship,
    previousRelationship: prev,
  };
}
