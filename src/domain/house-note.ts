/**
 * The House's single line — composed from a read, in one place.
 *
 * Both the desktop momentum card and the mobile game used to re-derive this
 * sentence independently; this is the one pure function that turns a house read
 * into { stage, text }. It never does IO and never names a side the read hasn't
 * earned. ZERO IO, deterministic per `seed` (the market id).
 */
import {
  houseAfter,
  houseBefore,
  houseBeforeNamed,
  houseDelight,
  houseFoundationLine,
  houseMilestone,
  houseMode,
  houseStage,
  houseSurpriseBeat,
  type BeliefAction,
  type HouseStage,
} from "./the-house";

/** The fields of a house read this note needs — a structural subset, no IO type. */
export interface HouseReadLike {
  preview: BeliefAction | null;
  foundation: { answered: number; required: number } | null;
  band: string | null;
  closed: boolean;
  outcome: "correct" | "miss" | "unscored" | null;
  record: { correct: number; miss: number; surpriseStreak: number };
}

export interface HouseNote {
  stage: HouseStage;
  text: string;
}

/**
 * Turn a house read into the one sentence the UI shows. Mirrors the emotional
 * order the House speaks in: cold-start progress → post-decision beat →
 * high-confidence call → an occasional observation → the intensity line.
 */
export function houseNote(
  viewer: string | null | undefined,
  house: HouseReadLike | null | undefined,
  seed: number,
): HouseNote {
  if (!viewer) {
    return { stage: "learning", text: "Connect to begin building your Conviction Twin." };
  }
  if (!house) return { stage: "learning", text: "Still learning you." };

  const rec = house.record;
  const decisions = rec.correct + rec.miss;
  const accuracy = decisions > 0 ? rec.correct / decisions : null;
  const stage = houseStage(decisions, accuracy);

  // Cold start: concrete forward progress, so the payoff is never deferred.
  if (house.foundation) {
    return {
      stage,
      text: houseFoundationLine(house.foundation.answered, house.foundation.required),
    };
  }

  // After a decision — react with emotion (a rare relationship beat first).
  if (house.closed && (house.outcome === "correct" || house.outcome === "miss")) {
    if (house.outcome === "miss") {
      // Defying the read is celebrated exactly like being read right.
      const beat = houseSurpriseBeat(rec.surpriseStreak, seed);
      return { stage, text: beat ?? houseAfter(false, seed) };
    }
    const beat = houseMilestone(stage, seed + decisions);
    return { stage, text: beat ?? houseAfter(true, seed) };
  }

  // Before a decision: call the side only when the read is strong enough.
  if (house.preview) return { stage, text: houseBeforeNamed(house.preview, seed) };
  const delight = houseDelight(seed + decisions);
  if (delight) return { stage, text: delight };
  return { stage, text: houseBefore(houseMode(house.band), seed) };
}
