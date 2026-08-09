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
  /**
   * THE HEARTBEAT FLOOR — the bar when the reader has seen nothing for a while.
   *
   * The adaptive floor above answers "is this the biggest thing that happened
   * today". It cannot answer the second question a live column raises, which is
   * "has this reader been looking at a still page for four minutes". A world
   * that is ordinary but ALIVE should let some humans breathe through; a world
   * that is actually dead should stay quiet. So there is one more step below
   * `hardFloor`, reachable only under silence, and nothing else changes: a row
   * admitted here is still scored, voiced and ranked exactly as it was.
   */
  pulseFloor: 10,
} as const;

/** A wash: bought and sold the same size in minutes. Volume, not conviction. */
const NEVER_RELAXED = new Set(["round_trip"]);

export interface DensityDecision {
  /** The admitting score, 0..100. */
  floor: number;
  /** True when the day was quiet enough that the bar had to come down. */
  relaxed: boolean;
}

/** How a row got in — or that it did not. */
export type Admission = "standard" | "pulse" | null;

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
 * The batch bar, lowered by how long the feed has been silent.
 *
 * `pressure` is 0..1 and means one thing only: how much this reader needs a
 * sign of life. At 0 this returns the ordinary floor and the whole feature is
 * inert. At 1 it reaches `pulseFloor` and no further — silence can lower the
 * bar for admission and can never touch what a row MEANS once admitted.
 */
export function silenceAdjustedFloor(floor: number, pressure: number): number {
  const p = Math.max(0, Math.min(1, pressure));
  return floor - p * Math.max(0, floor - DENSITY.pulseFloor);
}

/**
 * HOW a row got in, decided comparatively.
 *
 * "Pulse" is NOT "the floor happened to be relaxed" — that would misclassify a
 * genuinely meaningful row unlucky enough to arrive during a quiet window, and
 * then permanently strip its right to be questioned. It is the exact statement
 * `would fail at standard admission, passes at the silence-adjusted one`, i.e.
 * this row exists only because the feed needed a heartbeat.
 */
export function admissionOf(
  c: FeedCandidate,
  bars: { floor: number; silenceFloor: number },
): Admission {
  if (admitToFeed(c, bars.floor)) return "standard";
  if (bars.silenceFloor >= bars.floor) return null;
  return admitToFeed(c, bars.silenceFloor) ? "pulse" : null;
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
