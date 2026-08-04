/**
 * FEED DENSITY — the bar adapts to the day, instead of the day going silent.
 *
 * The materiality gate (src/domain/feed-event) asks one question: "is this event
 * big?" It is an ABSOLUTE test, and on a quiet chain the honest answer is "no"
 * for everything — so a real market with real people trading real money renders
 * as two rows and an empty column. Measured against production: in a market with
 * 50 or more believers, EVERY lone trade between $0.20 and $78 scored Tier 4 and
 * was discarded. A lone trade needed roughly $200 to clear the bar in a
 * 100-believer market. The chain was alive; the feed was not.
 *
 * The missing question is the editorial one:
 *
 *     Not "is this big?" but "is this the biggest thing that happened today?"
 *
 * On a busy day those have the same answer. On a quiet day they do not, and the
 * second one is the one a reader actually cares about. So the floor is set from
 * the DISTRIBUTION of what is available rather than from a constant: take the
 * score of the Nth-best candidate, and admit everything at or above it.
 *
 *   busy day   → the Nth-best is already strong → the floor is the normal bar,
 *                and this module changes nothing at all.
 *   quiet day  → the Nth-best is modest → the floor drops toward it, and the
 *                small true things get to speak.
 *   dead day   → the floor stops at `hardFloor`, and a short feed is correct.
 *                Emptiness is a fact; padding it with dust would be a lie.
 *
 * WHAT NEVER COMES BACK, however dead the day:
 *
 *   · WASHES. A wallet that bought and sold the same size in a minute changed
 *     nothing. Volume is not conviction, and a round trip is the clearest case
 *     of the two being confused.
 *   · DUST. Under `dustUsd` a trade says nothing about anyone's belief. Note this
 *     gates only the RELAXED path — a small trade that earned Tier 3 on its own
 *     merits (a Twin's $3 buy) is still the product working, not noise.
 *
 * The floor only ever RELAXES. It can never rise above the standard bar, so a
 * busy feed is never made stricter than it is today — this can add rows, never
 * remove them.
 *
 * ZERO IO, pure, fully testable.
 */
import { scoreFeedEvent, type FeedCandidate } from "@/domain/feed-event";

export const DENSITY = {
  /**
   * How many rows a feed wants before it reads as inhabited. Below this, a
   * reader assumes the product is broken rather than the day being slow.
   */
  target: 14,
  /** The normal bar — today's Tier-3 boundary. The floor never exceeds it. */
  standard: 25,
  /**
   * The floor's floor. Note the narrow band this lives in: the people term plus
   * novelty put a structural minimum of ~14 under EVERY lone trade, so a score
   * threshold alone cannot tell $0.20 from $70. That job belongs to `dustUsd`;
   * this is only a safety net under the relaxation.
   */
  hardFloor: 15,
  /**
   * Money so small it says nothing about anyone's belief.
   *
   * This was $5, set when the only priced trades I could see were another
   * product's ($54–$78) and I asserted that "under five dollars is not a story
   * anywhere". Once conviction.company's own ETH price came back, that turned
   * out to be false HERE: measured over six hours, real trades ran $0.02, $0.04,
   * $0.72, $2.46 — so a $5 floor was silently rejecting most genuine activity
   * and re-creating the empty feed the adaptive floor exists to prevent.
   *
   * Absolute still, but calibrated to the platform: at ~$1,870/ETH, two cents is
   * a rounding error and cannot be a position. Anything a person would notice
   * spending is left to the market-relative scoring above, which is the part
   * that adapts.
   */
  dustUsd: 0.5,
} as const;

/** A wash: bought and sold the same size in minutes. Volume, not conviction. */
const NEVER_RELAXED = new Set(["round_trip"]);

export interface DensityDecision {
  /** The admitting score, 0..100. */
  floor: number;
  /** True when the day was quiet enough that the bar had to come down. */
  relaxed: boolean;
}

/**
 * Where to set the bar for this batch. `scores` is every candidate's importance
 * — including the ones today's gate would drop, because the whole point is to
 * decide whether they were dropped for being weak or for being the only thing
 * that happened.
 */
export function adaptiveFloor(scores: number[], target: number = DENSITY.target): DensityDecision {
  if (scores.length === 0) return { floor: DENSITY.standard, relaxed: false };
  const sorted = [...scores].sort((a, b) => b - a);
  // The Nth-best score IS the bar: admit everything at least that good. When
  // fewer than N candidates exist we take the weakest, since there is nothing
  // to be selective about.
  const nth = sorted[Math.min(target, sorted.length) - 1];
  const floor = Math.max(DENSITY.hardFloor, Math.min(DENSITY.standard, nth));
  return { floor, relaxed: floor < DENSITY.standard };
}

/**
 * Does this row belong in the feed at this density?
 *
 * A row that EARNS its place is admitted exactly as before (`tier <= 3`) — which
 * matters for the small trades that carry a relationship, since a Twin's $3 buy
 * is the product working, not dust. The dust rule gates only the RELAXED path:
 * quiet days lower the bar for real moves, never for noise.
 */
export function admitToFeed(c: FeedCandidate, floor: number): boolean {
  if (NEVER_RELAXED.has(c.kind)) return false;
  const { score, tier } = scoreFeedEvent(c);
  if (tier <= 3) return true;
  const dust = c.amountUsd != null && c.amountUsd < DENSITY.dustUsd;
  return !dust && score >= floor;
}
