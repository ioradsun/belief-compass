/**
 * THE CONVICTION WHALE — one honorary seat at the end of the participant strip.
 *
 *   The largest current directional position among people who have continuously
 *   held that position for at least seven days. Tie-break by longest hold.
 *
 * WHY BOTH, AND WHY NOT "BIGGEST". Size alone is a leaderboard: somebody can buy
 * the title five minutes before you look at it. Duration alone is a participation
 * trophy. Requiring size to be EARNED THROUGH TIME makes the badge say something
 * a headcount cannot — that one person has planted a flag here and stayed — and
 * makes it impossible to purchase on impulse.
 *
 * The threshold is eligibility, not the ranking. Everyone past seven days is
 * "established"; among the established, the largest position wins. Demanding
 * somebody be BOTH the biggest and the longest-held would usually name nobody.
 *
 * CONTINUOUS MEANS THE PRODUCT'S DEFINITION, NOT A NEW ONE. `daysHeld` here must
 * come from `directional_since` — the reducer's transition table, which preserves
 * across adds and trims, RESETS on a flip, and CLEARS on exit. It must never come
 * from `first_backed_at`, which is set once and never reset: by that measure
 * somebody who bought a year ago, left, and returned yesterday reads as a
 * year-long holder, and the badge would decorate exactly the people who did not
 * stick around. See src/domain/domain.ts.
 *
 * MARKET-SPECIFIC, NEVER A USER BADGE. The whale of one question is an ordinary
 * participant in the next, which is what keeps the status truthful.
 *
 * NO FALLBACK. A market with nobody past seven days has no whale. It has not
 * earned one yet, and inventing a "best available" would spend the scarcity that
 * makes the seat mean anything.
 */

export const WHALE = {
  /** Days of unbroken directional holding before a position counts as established. */
  minDays: 7,
} as const;

/** One current holder, as the read model already knows them. */
export interface WhaleCandidate {
  wallet: string;
  /** The reducer's expressed side. Only YES or NO can hold the seat. */
  side: string | null;
  /** Days since `directional_since` — continuous holding, not first-ever. */
  daysHeld: number;
  /** True when `daysHeld` is a lower bound (belief predates the index). */
  tenureIsFloor?: boolean;
  /** Current position value in USD. Decides the winner among the established. */
  valueUsd: number;
}

export interface ConvictionWhale {
  wallet: string;
  side: "YES" | "NO";
  daysHeld: number;
  tenureIsFloor: boolean;
}

const directional = (s: string | null): s is "YES" | "NO" => s === "YES" || s === "NO";

/**
 * The one holder who has earned the seat, or null.
 *
 * Deterministic to the last field: value, then tenure, then wallet. Without the
 * final key two identical holders could swap the badge between two reads of the
 * same state, which reads as a bug rather than a distinction.
 */
export function findConvictionWhale(candidates: WhaleCandidate[]): ConvictionWhale | null {
  const eligible = candidates.filter(
    (c) =>
      directional(c.side) &&
      Number.isFinite(c.daysHeld) &&
      c.daysHeld >= WHALE.minDays &&
      Number.isFinite(c.valueUsd) &&
      c.valueUsd > 0,
  );
  if (eligible.length === 0) return null;

  const [best] = [...eligible].sort(
    (a, b) =>
      b.valueUsd - a.valueUsd || b.daysHeld - a.daysHeld || a.wallet.localeCompare(b.wallet),
  );

  return {
    wallet: best.wallet,
    side: best.side as "YES" | "NO",
    daysHeld: best.daysHeld,
    tenureIsFloor: best.tenureIsFloor === true,
  };
}

/** "19d", or "19d+" when the start is only a lower bound. */
export function whaleTenureText(whale: ConvictionWhale): string {
  return `${Math.floor(whale.daysHeld)}d${whale.tenureIsFloor ? "+" : ""}`;
}
