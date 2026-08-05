/**
 * Card reasons — one clear, verified sentence per card.
 *
 * The reason is DERIVED from the same numbers that ranked the card. No model
 * writes these at scroll time and nothing here invents a fact: if the data does
 * not support a sentence, we fall back to the market's own classification, then
 * to null (the card simply shows no reason).
 */
import type { FeedMarketSignals, ScoredMarket } from "./score";

export type ReasonCode =
  | "reentry"
  | "taking_off"
  | "early"
  | "follows"
  | "tribe"
  | "rival"
  | "split"
  | "fresh"
  | "interest"
  | "quality"
  | "exploration"
  | "classified";

export interface FeedReason {
  code: ReasonCode;
  text: string;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

function freshText(ageHours: number | null): string | null {
  if (ageHours == null) return null;
  if (ageHours < 1)
    return `Fresh market — created ${Math.max(1, Math.round(ageHours * 60))} minutes ago`;
  if (ageHours < 72) return `Fresh market — created ${Math.round(ageHours)}h ago`;
  return null;
}

/** Pick the single most useful, most specific true sentence. */
export function reasonFor(
  s: FeedMarketSignals,
  scored: ScoredMarket,
  opts: { category?: string | null } = {},
): FeedReason | null {
  if (s.newBelievers1h >= 3 && scored.acceleration >= 1.6)
    return {
      code: "taking_off",
      text: `Taking off — ${plural(Math.round(s.newBelievers1h), "new believer")} this hour`,
    };
  // A follow leads the copy even where it does not lead the SCORE (see
  // socialSignal — one follow ranks below a Tribe). Ranking and explaining are
  // different jobs: "someone you follow is active here" is a fact the reader can
  // check, where "your Tribe" asks them to trust an inference. Given both are
  // true, say the checkable one.
  //
  // "Active here", never a side: this is one count about people the viewer
  // picked, not a readout of their positions.
  if (s.followedHere > 0)
    return {
      code: "follows",
      text:
        s.followedHere === 1
          ? "Someone you follow is active here"
          : `${s.followedHere} people you follow are active here`,
    };
  // The count sharpens the sentence; it never gates it. `tribeCount` is 0 for a
  // viewer whose DNA has not formed yet, and for the whole overlay's history it
  // was 0 for everyone because the feed only ever looked at one person — so
  // "your Tribe is backing YES" has to keep working with nothing but a side.
  if (s.tribeSide)
    return {
      code: "tribe",
      text:
        s.tribeCount > 1
          ? `${s.tribeCount} people in your Tribe are backing ${s.tribeSide}`
          : `Your Tribe is backing ${s.tribeSide}`,
    };
  if (s.oppSide)
    return {
      code: "rival",
      text:
        s.oppCount > 1
          ? `${s.oppCount} of your Rivals are backing ${s.oppSide}`
          : `A Rival is backing ${s.oppSide}`,
    };
  if (scored.driver === "early" && scored.components.early > 0.25)
    return { code: "early", text: "Early — activity is accelerating" };
  if (Math.abs(s.divergence) >= 0.25)
    return { code: "split", text: "People and money are split here" };

  const fresh = freshText(scored.ageHours);
  if (fresh && scored.components.freshness >= 0.5) return { code: "fresh", text: fresh };

  const cat = opts.category ?? s.category;
  if (scored.driver === "personal" && cat)
    return { code: "interest", text: `Picked from your interest in ${cat}` };
  if (scored.driver === "exploration" && cat)
    return { code: "exploration", text: `Outside your usual — strong market in ${cat}` };
  if (scored.driver === "quality" && cat) return { code: "quality", text: `New in ${cat}` };
  if (s.opportunityReason) return { code: "classified", text: s.opportunityReason };
  return null;
}
