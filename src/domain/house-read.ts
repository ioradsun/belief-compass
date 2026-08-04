/**
 * THE HOUSE READ — the House's running attempt to call your next move.
 *
 * Conviction Company learns your tells from the picks you make. As your
 * Conviction DNA sharpens, the House starts calling the side it thinks you'll
 * back — and you find out immediately whether it read you right. Game night at
 * the House: playful, competitive, a little mysterious, never a lecture.
 *
 * Four states, one sentence each:
 *   learning   → "Learning your tells. Soon, we'll call your move."
 *   predicted  → "We think you'll back YES"
 *   correct    → "The House called it."
 *   incorrect  → "You beat the House."
 *
 * Two rules this module enforces so the feature stays honest:
 *   • It NEVER frames the reader as difficult. The system is the thing still
 *     learning — never "you're hard to read".
 *   • A confidence % is shown ONLY when the caller passes a calibrated score.
 *     The House's internal `confidence` is an average of DNA relationship
 *     strengths — a measure of how sure we are about the MATCHES, not a
 *     validated probability that you'll pick that side — so callers deliberately
 *     omit it until a real calibration exists. Never invent one here.
 *
 * ZERO IO, pure, fully testable. It also never leaks internal vocabulary
 * (model score, embedding, samples, threshold) into copy.
 */

export type ReadSide = "YES" | "NO";

export type HouseReadState =
  | { status: "learning"; remainingPicks?: number }
  | { status: "predicted"; predictedSide: ReadSide; confidence?: number }
  | { status: "correct"; predictedSide: ReadSide; actualSide: ReadSide }
  | { status: "incorrect"; predictedSide: ReadSide; actualSide: ReadSide };

/** The shape of a house read this module needs — a structural subset, no IO type. */
export interface HouseReadSource {
  connected: boolean;
  /** The side the House will call before the decision, when the read is strong. */
  preview: "YES" | "NO" | "PASS" | null;
  /** The locked pick, revealed after the round closes. */
  predicted: "YES" | "NO" | "PASS" | null;
  /** What the viewer actually did. */
  actual: "YES" | "NO" | "PASS" | null;
  outcome: "correct" | "miss" | "unscored" | null;
  closed: boolean;
  /** Cold start: the viewer is still training the House. */
  foundation: { answered: number; required: number } | null;
}

/** Only YES/NO are callable sides — a PASS round has no side to name. */
const directional = (v: string | null | undefined): ReadSide | null =>
  v === "YES" || v === "NO" ? v : null;

/**
 * Derive the one current state. Order matters: a finished round reports its
 * result, an open round with a strong read reports the call, everything else is
 * still learning.
 */
export function houseReadState(source: HouseReadSource | null | undefined): HouseReadState {
  if (!source || !source.connected) return { status: "learning" };

  // A settled round: did the House call it? Both sides must be directional —
  // a PASS has no side to compare, so that round simply shows no result.
  if (source.closed && (source.outcome === "correct" || source.outcome === "miss")) {
    const predictedSide = directional(source.predicted);
    const actualSide = directional(source.actual);
    if (predictedSide && actualSide) {
      return {
        status: source.outcome === "correct" ? "correct" : "incorrect",
        predictedSide,
        actualSide,
      };
    }
  }

  // Cold start — say exactly how many picks are left when we know.
  if (source.foundation) {
    const left = Math.max(0, source.foundation.required - source.foundation.answered);
    return left > 0 ? { status: "learning", remainingPicks: left } : { status: "learning" };
  }

  // An open round the House is willing to call.
  if (!source.closed) {
    const predictedSide = directional(source.preview);
    if (predictedSide) return { status: "predicted", predictedSide };
  }

  return { status: "learning" };
}

/** The rendered sentence, split so the side can carry its semantic colour. */
export interface HouseReadCopy {
  /** "The House Read:" — emphasized. Null on result states, which speak plainly. */
  label: string | null;
  /** Text before the side, or the whole sentence when there is no side. */
  body: string;
  /** The called side, rendered in its YES/NO colour. Null when none. */
  side: ReadSide | null;
  /** Text after the side, e.g. " · 78% confidence". Empty when none. */
  suffix: string;
  /** Lets the row read as a win or a loss without shouting. */
  tone: "neutral" | "correct" | "incorrect";
}

export const HOUSE_READ_LABEL = "The House Read:";

export function houseReadCopy(state: HouseReadState): HouseReadCopy {
  switch (state.status) {
    case "predicted": {
      // A percentage appears ONLY when a calibrated score was supplied.
      const pct =
        state.confidence != null && Number.isFinite(state.confidence)
          ? ` · ${Math.round(Math.max(0, Math.min(1, state.confidence)) * 100)}% confidence`
          : "";
      return {
        label: HOUSE_READ_LABEL,
        body: "We think you’ll back ",
        side: state.predictedSide,
        suffix: pct,
        tone: "neutral",
      };
    }
    case "correct":
      return {
        label: null,
        body: "The House called it.",
        side: null,
        suffix: "",
        tone: "correct",
      };
    case "incorrect":
      return {
        label: null,
        body: "You beat the House.",
        side: null,
        suffix: "",
        tone: "incorrect",
      };
    case "learning":
    default: {
      const n = state.status === "learning" ? state.remainingPicks : undefined;
      const body =
        n != null && n > 0
          ? `${n} more pick${n === 1 ? "" : "s"} and we’ll call your move.`
          : "Learning your tells. Soon, we’ll call your move.";
      return { label: HOUSE_READ_LABEL, body, side: null, suffix: "", tone: "neutral" };
    }
  }
}
