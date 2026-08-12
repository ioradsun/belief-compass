/**
 * THE INSIDER READ (seam 5) — "given everything, what do we think YOU will do?"
 *
 * ONE PRINCIPLE: predict first, prove it after.
 *
 * Before the choice the read is a single sentence naming the side (or the sit-out)
 * and nothing else — no reasons, no market context, no uncalibrated percentage.
 * The reader must decide without being shown the evidence.
 *
 * After the choice the locked reason arrives. It is NOT computed here or in the
 * component: the server locks `reasons` with the prediction and reveals them only
 * once the round completes, and this projection simply picks the strongest one.
 * The server already emits them in the required priority order:
 *   1 category history → 2 closest matches → 3 overall behaviour → 4 pass behaviour.
 *
 * MARKET ALIGNMENT LIVES IN INSIDER INSIGHT, NOT HERE. The Read answers exactly
 * one question: what do we think this person will do?
 *
 * Pure, ZERO IO, deterministic.
 */
import { houseReadState, type HouseReadSource, type HouseReadState } from "../house-read";
import type { InsiderRead } from "./types";

/** The locked evidence the server reveals only after the round completes. */
export interface InsiderReadEvidence {
  /** Reasons in engine priority order. Only the strongest is ever shown. */
  reasons?: readonly string[] | null;
  /** This market's category, for the "you broke the pattern" comparison. */
  category?: string | null;
  /** The side the House had locked, revealed after a bet. */
  predicted?: "YES" | "NO" | "PASS" | null;
}

const strongest = (reasons?: readonly string[] | null): string | null => {
  if (!reasons) return null;
  for (const r of reasons) if (typeof r === "string" && r.trim()) return r.trim();
  return null;
};

/** Map the pure house-read state 1:1 into the Insider vocabulary. */
export function fromHouseReadState(
  state: HouseReadState,
  evidence?: InsiderReadEvidence,
): InsiderRead {
  switch (state.status) {
    case "learning":
      return { status: "learning", remainingPicks: state.remainingPicks ?? null };
    case "predicted":
      return { status: "predicted", predictedSide: state.predictedSide };
    case "closed":
      return { status: "closed" };
    default:
      return {
        status: state.status, // "correct" | "incorrect"
        predictedSide: state.predictedSide,
        actualSide: state.actualSide,
        reason: strongest(evidence?.reasons),
        category: evidence?.category ?? null,
      };
  }
}

/** Derive the Insider Read straight from a house-read source. */
export function insiderRead(
  source: (HouseReadSource & InsiderReadEvidence) | null | undefined,
): InsiderRead {
  // A predicted PASS is a real read, not an absence of one. The house-read state
  // machine has no side to name for it, so the Insider names the behaviour.
  if (source && source.connected && !source.closed && !source.foundation && source.preview === "PASS") {
    return { status: "pass_predicted" };
  }
  return fromHouseReadState(houseReadState(source), source ?? undefined);
}
