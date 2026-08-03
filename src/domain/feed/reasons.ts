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
  if (ageHours < 1) return `Fresh market — created ${Math.max(1, Math.round(ageHours * 60))} minutes ago`;
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
  if (s.tribeSide)
    return { code: "tribe", text: `Your Tribe is backing ${s.tribeSide}` };
  if (s.oppSide) return { code: "rival", text: `A Rival is backing ${s.oppSide}` };
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
