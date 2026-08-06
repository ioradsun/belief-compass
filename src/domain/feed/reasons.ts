/**
 * Card reasons — one clear, verified sentence per card.
 *
 * The reason is DERIVED from the same numbers that ranked the card. No model
 * writes these at scroll time and nothing here invents a fact: if the data does
 * not support a sentence, we fall back to the market's own classification, then
 * to null (the card simply shows no reason).
 */
import type { FeedMarketSignals, ScoredMarket } from "./score";
import { momentumReason, WAKING_REASON, CONTESTED_REASON, type MomentumFacts } from "./momentum";

export type ReasonCode =
  | "reentry"
  | "momentum"
  | "waking"
  | "contested"
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

/**
 * What the people this viewer follows are doing here.
 *
 * Most specific true sentence, in order: a named person with a side, then a
 * count with a side, then the split, then bare presence. Each step down is a
 * fact the data did not support, never a fact being held back — a followed
 * creator who never backed their own market genuinely has no side, and a wallet
 * with no POV identity genuinely has no name.
 */
function followsReason(s: FeedMarketSignals): FeedReason {
  const y = Math.max(0, Math.round(s.followedYes));
  const n = Math.max(0, Math.round(s.followedNo));
  const withSide = y + n;
  const name = s.followedNames[0] ?? null;

  if (withSide > 0 && (y === 0 || n === 0)) {
    const side = y > 0 ? "YES" : "NO";
    // One person is a person: name them when we know the name, and never say
    // "1 people".
    if (withSide === 1)
      return {
        code: "follows",
        text: name ? `${name} is backing ${side}` : `Someone you follow is backing ${side}`,
      };
    return { code: "follows", text: `${withSide} people you follow are backing ${side}` };
  }
  // Both sides represented — the disagreement IS the reason, and naming one of
  // them would pick a winner out of a split.
  if (y > 0 && n > 0)
    return { code: "follows", text: `${withSide} people you follow are split here` };

  // Connected without a side: they created it. The product does not distinguish
  // creating from participating, so the sentence does not either.
  return {
    code: "follows",
    text:
      s.followedHere === 1
        ? name
          ? `${name} is active here`
          : "Someone you follow is active here"
        : `${s.followedHere} people you follow are active here`,
  };
}

/** Pick the single most useful, most specific true sentence. */
export function reasonFor(
  s: FeedMarketSignals,
  scored: ScoredMarket,
  opts: { category?: string | null; momentum?: MomentumFacts | null; window?: string } = {},
): FeedReason | null {
  const mo = opts.momentum ?? null;
  const win = opts.window ?? "24h";

  /**
   * MOVEMENT LEADS, when there is any.
   *
   * "YES gained 3 believers today" is the most checkable sentence the feed can
   * write — a reader can open the market and verify it in one glance — and a
   * reason that survives being checked is the only kind worth printing. It goes
   * above the social reasons because a social reason describes a STATE ("your
   * Tribe is backing YES", true for weeks) while this describes an EVENT, and
   * an event is why a market is worth opening NOW rather than ever.
   *
   * `momentumReason` is drift-corrected at source, so this can never say a
   * market moved when only the exchange rate did.
   */
  if (mo?.top) return { code: "momentum", text: momentumReason(mo.top, win) };

  // A market that broke a long silence has no MOVE big enough to describe —
  // that is what makes it interesting — so it gets its own sentence rather than
  // falling through to a category blurb.
  if (mo?.lenses.includes("waking")) return { code: "waking", text: WAKING_REASON };

  /**
   * The old first branch, kept but demoted and now REACHABLE.
   *
   * It required `newBelievers1h >= 3` and `acceleration >= 1.6`, and both were
   * unreachable: no market on this platform has ever had three new believers in
   * an hour, and acceleration was identically zero because `trade_count_1h` was
   * missing from the feed's SELECT list. It now sits below the momentum branch,
   * which covers the same event honestly on the window the reader chose.
   */
  if (s.newBelievers1h >= 3 && scored.acceleration >= 1.6)
    return {
      code: "taking_off",
      text: `Taking off — ${plural(Math.round(s.newBelievers1h), "new believer")} this hour`,
    };
  // A follow leads the copy even where it does not lead the SCORE (see
  // socialSignal — one follow ranks below a Tribe). Ranking and explaining are
  // different jobs: "Reyhan is backing YES" is a fact the reader can check,
  // where "your Tribe" asks them to trust an inference. Given both are true, say
  // the checkable one.
  //
  // THE SIDE IS SAID. This sentence used to stop at "is active here" on privacy
  // grounds, which withheld the single most useful word in it — and withheld
  // nothing real, since every side is public on-chain and the viewer chose to
  // follow this person. It also made the checkable reason the vaguest one on the
  // card, so the inference ("your Tribe is backing YES") read as the better fact.
  if (s.followedHere > 0) return followsReason(s);
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
  // Both sides genuinely occupied and neither winning. Below the personal
  // reasons because it is a fact about the market rather than about the reader,
  // and above the category blurbs because it is a fact at all.
  if (mo?.lenses.includes("contested")) return { code: "contested", text: CONTESTED_REASON };

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
