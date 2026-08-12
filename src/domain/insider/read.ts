/**
 * THE INSIDER READ (seam 5) — "given everything, what do we think YOU will do?"
 *
 * The personal projection. It KEEPS the existing prediction state machine intact
 * (src/domain/house-read) — learning → predicted → correct/incorrect — and simply
 * lifts it into the Insider vocabulary. Nothing about what we predict changes; the
 * house-read engine is already pure and calibration-honest, and this is a faithful
 * mapping, not a re-derivation.
 *
 * WHAT IS NEW: the read can now take the market's aggregate `InsiderPulse` as an
 * additional Insider evidence source and note whether the market is moving toward
 * the side we think you'll back (`marketAligned`). That is ADDITIVE context — it
 * never changes the predicted side. This is the seam through which the read gets
 * richer over time ("your DNA + everything Insider sees in this market") without
 * ever contaminating the prediction.
 *
 * Pure, ZERO IO, deterministic.
 */
import {
  houseReadState,
  type HouseReadSource,
  type HouseReadState,
} from "../house-read";
import type { InsiderPulse, InsiderRead } from "./types";

export interface InsiderReadContext {
  /** The market's aggregate read, so the personal read can note agreement. */
  pulse?: InsiderPulse | null;
}

/** Map the pure house-read state 1:1 into the Insider vocabulary. */
export function fromHouseReadState(
  state: HouseReadState,
  context?: InsiderReadContext,
): InsiderRead {
  const base: InsiderRead =
    state.status === "learning"
      ? { status: "learning", remainingPicks: state.remainingPicks ?? null }
      : state.status === "predicted"
        ? { status: "predicted", predictedSide: state.predictedSide, confidence: state.confidence ?? null }
        : state.status === "closed"
          ? { status: "closed" }
        : {
            status: state.status, // "correct" | "incorrect"
            predictedSide: state.predictedSide,
            actualSide: state.actualSide,
          };

  // Additive market context: only when we have a live call AND a directional
  // market. Never touches predictedSide/status.
  const dir = context?.pulse?.direction;
  if (base.status === "predicted" && base.predictedSide && (dir === "YES" || dir === "NO")) {
    return { ...base, marketAligned: base.predictedSide === dir };
  }
  return base;
}

/** Derive the Insider Read straight from a house-read source. */
export function insiderRead(
  source: HouseReadSource | null | undefined,
  context?: InsiderReadContext,
): InsiderRead {
  return fromHouseReadState(houseReadState(source), context);
}
