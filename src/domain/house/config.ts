/**
 * House Read — constants, action types, and confidence bands (canonical, v1).
 *
 * "The crowd predicts the market. The House predicts you." The House predicts a
 * user's FINALIZED action (BUY_YES / BUY_NO / SKIP), not a temporary tap. One
 * owner for every House constant so no route, server fn, or component invents a
 * threshold. Pure — zero IO.
 */

/** Bump when engine weights, signals, or the two-stage model change materially. */
export const HOUSE_ENGINE_VERSION = 1;

/** Bump when the foundation → dimension weights change; old answers keep their version. */
export const FOUNDATION_MAPPING_VERSION = 1;

/** Free belief choices a new user makes before the House starts predicting. */
export const FOUNDATION_REQUIRED = 5;

/** The finalized action the House predicts (only settles after a confirmed tx / skip). */
export type HouseAction = "BUY_YES" | "BUY_NO" | "SKIP";

/** A free training choice on a market card — never a purchase. */
export type FoundationAction = "YES" | "NO" | "SKIP";

/** How a locked prediction resolved against the user's real move. */
export type HouseOutcome =
  | "HOUSE_HIT" // predicted action == actual action
  | "USER_WIN" // predicted a buy, user bought the other side
  | "SURPRISE" // predicted a buy, user skipped
  | "CALLED_BLUFF" // predicted skip, user bought
  | "PENDING"; // not yet finalized

/**
 * Presentation band for the pre-reveal card. Low confidence changes the copy,
 * never whether a prediction exists — after foundation the House always shoots.
 */
export type HouseConfidenceBand =
  "SHOT_IN_THE_DARK" | "FLYING_BLIND" | "HUNCH" | "READ" | "STRONG_READ";

/** Map a max-probability confidence (0..1) to its presentation band. */
export function confidenceBand(confidence: number): HouseConfidenceBand {
  const pct = clamp01(confidence) * 100;
  if (pct < 50) return "SHOT_IN_THE_DARK";
  if (pct < 60) return "FLYING_BLIND";
  if (pct < 70) return "HUNCH";
  if (pct < 85) return "READ";
  return "STRONG_READ";
}

/** Pre-reveal headline + suspense line per band. Never names the predicted side. */
export const BAND_COPY: Record<HouseConfidenceBand, { headline: string; line: string }> = {
  SHOT_IN_THE_DARK: {
    headline: "Shot in the dark",
    line: "We’re flying blind here, but we still made a call. Make your move to reveal ours.",
  },
  FLYING_BLIND: {
    headline: "Flying blind",
    line: "You haven’t shown us much in this territory. We took a guess anyway.",
  },
  HUNCH: {
    headline: "The House has a hunch",
    line: "Something in your pattern points one way.",
  },
  READ: {
    headline: "The House has a read",
    line: "We think we know what you’ll do.",
  },
  STRONG_READ: {
    headline: "Prove the House wrong",
    line: "Your pattern looks unusually clear on this one.",
  },
};

export const HOUSE_TAGLINE = "The crowd predicts the market. The House predicts you.";

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
