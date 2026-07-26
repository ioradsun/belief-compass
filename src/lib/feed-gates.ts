/**
 * conviction.company — Feed honesty gates + event taxonomy (single source).
 *
 * A feed is not a log of events. It is a ranking of stories. Every card answers
 * one question — "why should I care about this right now?" — and claims only
 * what the data proves. Time is one input to ranking, not the structure.
 *
 * This is the ONE module the engine calls to (a) classify any signal into the
 * closed six-type taxonomy and (b) enforce the honesty gates centrally, so every
 * scope gates identically instead of re-deriving the rules. It owns no rendering
 * and no IO — pure functions and constants only. Where a gate already lived in a
 * pure module it is re-exported here so the engine has a single honesty import
 * site rather than reaching into four files.
 */
import { attributionVerb, wealthFlow, type AttributionEvidence } from "./conviction-feed";
import {
  isMaterialDivergence,
  convictionShape,
  MATERIAL_DIVERGENCE_PTS,
  SCOREBOARD_MOVE_PCT,
} from "./feed-copy";

export {
  // Earned attribution verbs (joined → contributed → accelerated → drove).
  attributionVerb,
  // Tier-1 capital flow — always honest, no cost basis needed.
  wealthFlow,
  // Conflict gates.
  isMaterialDivergence,
  convictionShape,
  MATERIAL_DIVERGENCE_PTS,
  SCOREBOARD_MOVE_PCT,
};
export type { AttributionEvidence };

/**
 * The closed taxonomy. Every card is exactly one of these. Nothing outside it
 * ships. Order in the union is documentation, not priority — priority lives in
 * `classifyEvent`.
 */
export type FeedEventType =
  | "recruitment" // believers joined (breadth)
  | "capital" // money moved (flow — always honest)
  | "momentum" // acceleration — GATED on a rate rising window-over-window
  | "conflict" // the interesting disagreement — GATED on thresholds
  | "tribe" // viewer-relative (People / Opp / Circle)
  | "achievement"; // game mechanics — GATED, structural only (never P&L/timing)

export interface ClassifyInput {
  behavior:
    | "born"
    | "joined"
    | "increase"
    | "reduce"
    | "flow"
    | "unattributed"
    | "accelerate"
    | "milestone";
  actorRole: "people" | "opp" | "creator" | "tribe" | "rivals" | "market" | null;
  hasConflict: boolean; // material money-vs-people divergence OR a broad-vs-concentrated shape
  isAccelerating: boolean; // momentum gate passed (see momentumAcceleration)
  isAchievement: boolean; // structural achievement gate passed (see structuralAchievement)
}

/**
 * Map a signal to exactly one of the six types. A viewer-relative actor is a
 * Tribe event first of all; a passed structural-achievement gate is next
 * (rarest, provable); then the gated Conflict and Momentum types; everything
 * else is Recruitment (people arriving) or Capital (money moving) by behavior.
 */
export function classifyEvent(i: ClassifyInput): FeedEventType {
  if (i.actorRole === "people" || i.actorRole === "opp") return "tribe";
  if (i.isAchievement || i.behavior === "milestone") return "achievement";
  if (i.isAccelerating || i.behavior === "accelerate") return "momentum";
  if (i.hasConflict) return "conflict";
  switch (i.behavior) {
    case "born":
    case "joined":
      return "recruitment";
    default:
      return "capital";
  }
}

// ---------------------------------------------------------------------------
// Momentum gate — acceleration is a RATE rising window-over-window, never a raw
// count. With no prior baseline you cannot claim "accelerating"; that's just new
// (a Recruitment event). Flat or slowing is not momentum either.
// ---------------------------------------------------------------------------

export const MOMENTUM_MIN_PRIOR = 2; // need at least this much in the prior window to have a baseline
export const MOMENTUM_MIN_RATIO = 1.25; // the recent rate must exceed the prior by ≥25% to count

/**
 * Given the count of new backers in the recent window and the immediately prior
 * window of equal length, return the acceleration ratio (recent/prior) when the
 * rate is genuinely rising, or null when it is not measurable or not rising.
 */
export function momentumAcceleration(recent: number, prior: number): number | null {
  if (!(prior >= MOMENTUM_MIN_PRIOR)) return null; // no baseline → can't call it a trend
  if (recent <= prior) return null; // flat or slowing is not momentum
  const ratio = recent / prior;
  return ratio >= MOMENTUM_MIN_RATIO ? ratio : null;
}

// ---------------------------------------------------------------------------
// Achievement gate — STRUCTURAL only. "entered Top N by believers" is provable
// from current data (a ranking, present tense). "you were early" / "beat the
// market" are timing and P&L claims wearing a badge and are deliberately absent.
// ---------------------------------------------------------------------------

export const ACHIEVEMENT_MIN_BELIEVERS = 10; // below this a "top" slot is noise, not a milestone
export const ACHIEVEMENT_TOP_N = 5; // only the genuine top slice earns a badge

/**
 * A structural, present-tense, provable achievement string for a market ranked
 * `rank` (1-based) among the active set by believer count — or null when the
 * market is not in the top slice or has too few believers to be meaningful.
 */
export function structuralAchievement(i: { rank: number; believers: number }): string | null {
  if (!(i.believers >= ACHIEVEMENT_MIN_BELIEVERS)) return null;
  if (!(i.rank >= 1 && i.rank <= ACHIEVEMENT_TOP_N)) return null;
  const label = i.rank === 1 ? "the most-backed" : `#${i.rank} most-backed`;
  return `${label} belief right now — ${i.believers.toLocaleString()} believers.`;
}
