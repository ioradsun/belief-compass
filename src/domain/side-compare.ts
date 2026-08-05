/**
 * SIDE COMPARISON — what is happening between YES and NO, in one line.
 *
 * The mobile Case File used to be the desktop one on a smaller screen: two
 * independent columns of metrics, a chart, a roster and a tape, reached by
 * swiping past the market page that sat between them. That layout makes the
 * feature's own question — which side is gaining? — the hardest one to answer,
 * because comparing meant two swipes and holding numbers in your head.
 *
 * So the comparison comes first now, and this module writes it. A reader gets
 * the state of both sides in a sentence before any number, and the numbers
 * that follow are then interpretable rather than raw.
 *
 * THE RULES ARE ABOUT WHAT NOT TO SAY.
 *
 *   MOVEMENT BEATS SIZE. "Three people joined YES today" is news; "YES has 40
 *   believers" is a standing fact the strip already shows. The story reaches
 *   for a change first and only describes the standing state when nothing moved.
 *
 *   AN EMPTY SIDE IS THE LOUDEST FACT THERE IS. Nobody backing NO outranks
 *   every momentum sentence, because it changes what the market even is.
 *
 *   NEVER MANUFACTURE A TREND. One new believer is a person, not momentum. A 2%
 *   capital move is noise. Below the thresholds the sentence says the honest
 *   dull thing — "both sides are holding steady" — rather than dressing up a
 *   rounding error as a shift.
 *
 * ZERO IO, pure, fully testable.
 */

export type Side = "YES" | "NO";

/** One side, as the comparison needs it. */
export interface SideSnapshot {
  /** Directional believers holding this side now. */
  believers: number;
  /** Capital committed to this side, USD, or null when unpriced. */
  capitalUsd: number | null;
  /** People who took this side during the window. */
  joined: number;
  /** Capital change over the window, in percent, or null when unknown. */
  capitalChangePct: number | null;
}

export const COMPARE = {
  /** Below this, arrivals are people rather than momentum. */
  minJoined: 2,
  /** Capital moves smaller than this are noise, not a shift. */
  minCapitalMovePct: 5,
  /**
   * How lopsided the believer count must be before one side is described as
   * leading. Anything closer reads as evenly matched, which is itself the
   * story on a contested market.
   */
  leadRatio: 1.5,
} as const;

export interface Comparison {
  /** The one line above the numbers. Never empty. */
  story: string;
  /**
   * The side the story is about, or null when it concerns both. Drives nothing
   * but emphasis — it must never be read as a recommendation.
   */
  focus: Side | null;
}

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

const plural = (c: number, word: string) => `${c} ${word}${c === 1 ? "" : "s"}`;

/**
 * What is happening between the two sides, in one sentence.
 *
 * Ordered by how much each fact changes what the reader should do next — an
 * empty side first, then movement, then the standing balance.
 */
export function compareSides(yes: SideSnapshot, no: SideSnapshot): Comparison {
  const yb = Math.floor(n(yes.believers));
  const nb = Math.floor(n(no.believers));

  if (yb === 0 && nb === 0) {
    return { story: "No one has taken a side here yet.", focus: null };
  }
  // An empty side outranks everything: it changes what the market IS, not just
  // how it is going.
  if (nb === 0) return { story: "Nobody currently backs NO.", focus: "YES" };
  if (yb === 0) return { story: "Nobody currently backs YES.", focus: "NO" };

  // MOVEMENT. Arrivals are the most human signal available and the one a
  // standing count cannot show.
  const yj = Math.floor(n(yes.joined));
  const nj = Math.floor(n(no.joined));
  if (yj >= COMPARE.minJoined || nj >= COMPARE.minJoined) {
    if (yj > nj && yj >= COMPARE.minJoined)
      return { story: `${plural(yj, "believer")} joined YES.`, focus: "YES" };
    if (nj > yj && nj >= COMPARE.minJoined)
      return { story: `${plural(nj, "believer")} joined NO.`, focus: "NO" };
    // Both sides gaining at the same rate is its own, better story.
    return { story: "Both sides are gaining believers.", focus: null };
  }

  // CAPITAL. Weaker than people — it is one person's decision restated in
  // dollars — so it only speaks when nobody arrived.
  const yc = yes.capitalChangePct;
  const nc = no.capitalChangePct;
  const ym = yc != null && Math.abs(yc) >= COMPARE.minCapitalMovePct ? yc : 0;
  const nm = nc != null && Math.abs(nc) >= COMPARE.minCapitalMovePct ? nc : 0;
  if (ym > 0 && ym >= Math.abs(nm)) return { story: "Capital moved toward YES.", focus: "YES" };
  if (nm > 0 && nm >= Math.abs(ym)) return { story: "Capital moved toward NO.", focus: "NO" };
  if (ym < 0 && Math.abs(ym) > Math.abs(nm))
    return { story: "Capital pulled back from YES.", focus: "YES" };
  if (nm < 0 && Math.abs(nm) > Math.abs(ym))
    return { story: "Capital pulled back from NO.", focus: "NO" };

  // STANDING BALANCE — nothing moved, so describe what is rather than what
  // changed. This is the honest dull answer, and most markets most of the time.
  const ratio = Math.max(yb, nb) / Math.max(1, Math.min(yb, nb));
  if (ratio < COMPARE.leadRatio) {
    return { story: "Both sides are evenly matched.", focus: null };
  }
  const lead: Side = yb > nb ? "YES" : "NO";
  return {
    story: `${lead} holds most of the room, ${Math.max(yb, nb)} to ${Math.min(yb, nb)}.`,
    focus: lead,
  };
}

/** One side's row in the comparison strip — the two numbers that matter. */
export interface StripSide {
  side: Side;
  believers: number;
  capitalUsd: number | null;
  /** New believers this window. Zero renders nothing rather than "+0". */
  joined: number;
  /** Share of the two sides' believers, 0..1, for the proportional bar. */
  share: number;
}

/**
 * The two sides as one comparable pair.
 *
 * `share` is computed HERE rather than in the component so the bar and the
 * numbers can never disagree — the bug this shape exists to make impossible.
 * An empty market splits it evenly rather than dividing by zero, so the bar
 * renders as a neutral line instead of vanishing.
 */
export function comparisonStrip(yes: SideSnapshot, no: SideSnapshot): [StripSide, StripSide] {
  const yb = Math.floor(n(yes.believers));
  const nb = Math.floor(n(no.believers));
  const total = yb + nb;
  const yShare = total > 0 ? yb / total : 0.5;
  return [
    {
      side: "YES",
      believers: yb,
      capitalUsd: yes.capitalUsd,
      joined: Math.floor(n(yes.joined)),
      share: yShare,
    },
    {
      side: "NO",
      believers: nb,
      capitalUsd: no.capitalUsd,
      joined: Math.floor(n(no.joined)),
      share: 1 - yShare,
    },
  ];
}
