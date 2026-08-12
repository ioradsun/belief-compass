/**
 * INSIDER READ — the rendered sentence of the personal projection.
 *
 * PREDICT FIRST, PROVE IT AFTER.
 *
 * Pre-choice it is a label and ONE sentence: the side we have you on, or the
 * sit-out, or how many picks are left before we will call your move. No reasons,
 * no market context, no uncalibrated percentage — the reader decides without
 * seeing the evidence.
 *
 * Post-choice the verdict is flat ("Called it." / "You broke the pattern.") and
 * carries exactly ONE locked reason, already chosen upstream. Nothing here
 * calculates evidence and nothing here stacks two statistics into a paragraph.
 *
 * Pure, ZERO IO, deterministic.
 */
import type { ReadSide } from "../../house-read";
import type { InsiderRead } from "../types";

export const INSIDER_READ_LABEL = "Insider Read:";

export interface InsiderReadCopy {
  /** "Insider Read:" — emphasized. Null on result states, which speak plainly. */
  label: string | null;
  /** Text before the side, or the whole sentence when there is no side. */
  body: string;
  /** The called side, rendered in its YES/NO colour. Null when none. */
  side: ReadSide | null;
  /** Lets the row read as a win or a loss without shouting. */
  tone: "neutral" | "correct" | "incorrect";
  /** The single locked reason, shown ONLY after the choice. Null pre-choice. */
  reason: string | null;
}

const side = (v: InsiderRead["predictedSide"]): ReadSide | null =>
  v === "YES" || v === "NO" ? v : null;

/**
 * The broken-pattern comparison. Composed from fields the server already locked
 * — a category, the predicted side, the chosen side — never from a fresh count.
 */
function brokePatternLine(read: InsiderRead): string | null {
  const predicted = read.predictedSide;
  const actual = read.actualSide;
  if (!predicted || !actual) return null;
  const cat = read.category?.trim();
  const history = cat ? `${cat} history` : "history";
  if (predicted === "PASS") return `We had you sitting this one out. You chose ${actual}.`;
  if (actual === "PASS") return `Your ${history} leaned ${predicted}. You passed.`;
  return `Your ${history} leaned ${predicted}. You chose ${actual}.`;
}

export function insiderReadCopy(read: InsiderRead): InsiderReadCopy {
  switch (read.status) {
    case "predicted": {
      const called = side(read.predictedSide);
      if (called) {
        return {
          label: INSIDER_READ_LABEL,
          body: "Your next move: ",
          side: called,
          tone: "neutral",
          reason: null,
        };
      }
      break;
    }
    case "pass_predicted":
      return {
        label: INSIDER_READ_LABEL,
        body: "You'll sit this one out.",
        side: null,
        tone: "neutral",
        reason: null,
      };
    case "correct":
      if (read.predictedSide && read.actualSide) {
        return {
          label: null,
          body: "Called it.",
          side: null,
          tone: "correct",
          reason: read.reason?.trim() || null,
        };
      }
      break;
    case "incorrect":
      if (read.predictedSide && read.actualSide) {
        return {
          label: null,
          body: "You broke the pattern.",
          side: null,
          tone: "incorrect",
          reason: brokePatternLine(read),
        };
      }
      break;
    case "closed":
      return { label: null, body: "This read is closed.", side: null, tone: "neutral", reason: null };
    default:
      break;
  }

  // Learning — measurable progress, never a vague "learning you…", and never a
  // suggestion that the reader is difficult.
  const n = read.remainingPicks;
  const body =
    n != null && n > 0
      ? `${n} more pick${n === 1 ? "" : "s"}. Then we call your next move.`
      : "A few more picks. Then we call your next move.";
  return { label: INSIDER_READ_LABEL, body, side: null, tone: "neutral", reason: null };
}
