/**
 * INSIDER READ — the rendered sentence of the personal projection.
 *
 * The Insider's running attempt to call your next move. The state machine is
 * unchanged (`domain/house-read` → `insiderRead`); this projection owns only how
 * that state SPEAKS, so desktop, phone and every future surface say the same
 * words. Nothing here predicts anything.
 *
 * Two rules inherited from the engine and kept here:
 *   • It never frames the reader as difficult — the system is the thing still
 *     learning.
 *   • A confidence % appears ONLY when a calibrated score was supplied. Never
 *     invent one.
 *
 * The additive bit the Insider brings: when we have a call AND the market's own
 * aggregate direction is clear, the row can note whether the market agrees with
 * the side we think you'll back. It is CONTEXT, never the prediction, and it is
 * silent whenever `marketAligned` is unknown.
 *
 * Pure, ZERO IO, deterministic.
 */
import { houseReadCopy, type HouseReadState, type ReadSide } from "../../house-read";
import type { InsiderRead } from "../types";

export const INSIDER_READ_LABEL = "Insider Read:";

export interface InsiderReadCopy {
  /** "Insider Read:" — emphasized. Null on result states, which speak plainly. */
  label: string | null;
  /** Text before the side, or the whole sentence when there is no side. */
  body: string;
  /** The called side, rendered in its YES/NO colour. Null when none. */
  side: ReadSide | null;
  /** Text after the side, e.g. " · 78% confidence". Empty when none. */
  suffix: string;
  /** Lets the row read as a win or a loss without shouting. */
  tone: "neutral" | "correct" | "incorrect";
  /**
   * Market context, when known: "the market agrees" / "the market disagrees".
   * Rendered quietly and separately so it can never be mistaken for the call.
   */
  context: string | null;
}

const side = (v: InsiderRead["predictedSide"]): ReadSide | null =>
  v === "YES" || v === "NO" ? v : null;

/** InsiderRead → the state machine's own shape, so ONE copy engine renders both. */
function toState(read: InsiderRead): HouseReadState {
  const predictedSide = side(read.predictedSide);
  const actualSide = side(read.actualSide);
  if ((read.status === "correct" || read.status === "incorrect") && predictedSide && actualSide) {
    return { status: read.status, predictedSide, actualSide };
  }
  if (read.status === "predicted" && predictedSide) {
    return {
      status: "predicted",
      predictedSide,
      ...(read.confidence != null ? { confidence: read.confidence } : {}),
    };
  }
  return {
    status: "learning",
    ...(read.remainingPicks != null ? { remainingPicks: read.remainingPicks } : {}),
  };
}

export function insiderReadCopy(read: InsiderRead): InsiderReadCopy {
  const base = houseReadCopy(toState(read));
  // Only a live call can carry market context — a settled or learning row has
  // nothing for the market to agree with.
  const aligned = base.side != null && read.marketAligned != null ? read.marketAligned : null;
  return {
    ...base,
    label: base.label == null ? null : INSIDER_READ_LABEL,
    context:
      aligned == null ? null : aligned ? "The market agrees." : "The market is going the other way.",
  };
}
