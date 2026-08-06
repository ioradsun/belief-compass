/**
 * YOUR OWN STAKE — the personalization axis the feed never had.
 *
 * The ranker already knows about PEOPLE the viewer is connected to: a Twin, a
 * Tribe member, a Rival. It knew nothing about the viewer's own MARKETS. A
 * question you opened, or one you have money on, produced exactly the same row
 * for you as for a stranger.
 *
 * That gap was invisible because the machinery for it existed and was populated
 * for one row kind. `viewerBoost` is documented as "read-time, viewer-relative
 * score bump per row" and was set only for conviction cohorts — so a market
 * transition in the market you created, a celebration in the market you are
 * holding, and an anonymous trade in a market you have never seen were ranked
 * identically.
 *
 * TWO STAKES, IN THE ORDER THEY MATTER:
 *
 *   CREATED   you asked this question. Everything that happens to it is a
 *             consequence of a thing you did, and no other relationship to a
 *             market is stronger.
 *   HOLDING   your money is on this. What moves here moves you.
 *
 * THERE IS NO "FOLLOWING" STAKE, and its absence is deliberate. `follows` is
 * wallet-to-wallet: you follow PEOPLE, not questions. That signal is real and it
 * already has an axis — a followed person's rows carry them as a subject, which
 * is the discovery dimension's job. Adding a market-following stake here would
 * mean shipping a third weight nothing could ever populate, which is the exact
 * shape of the bug that left the celebration family reserved and empty.
 *
 * BOUNDED, AND FOR THE SAME REASON THE RELATIONSHIP BOOST IS. Personalization
 * competes inside the queue; it never skips it. A market flip in a stranger's
 * market is still bigger news than a dust trade in yours, and a feed that
 * inverted that would be a feed about you rather than about the platform. The
 * ceiling here is the ceiling relationship personalization already uses, so the
 * two axes cannot outbid each other into a different product.
 *
 * ZERO IO, pure, fully testable.
 */
import { MAX_RELATIONSHIP_BOOST } from "./viewer-relationship";

export type Stake = "created" | "holding";

/**
 * Relative strength of each stake, before the shared ceiling is applied.
 *
 * `created` is 1 because there is no stronger claim on a question than having
 * asked it. `holding` sits just below: money is a strong signal, but a position
 * can be a few cents and a question is always wholly yours.
 */
export const STAKE_WEIGHT: Record<Stake, number> = {
  created: 1,
  holding: 0.75,
};

/** The same ceiling relationship personalization uses. See the header. */
export const MAX_STAKE_BOOST = MAX_RELATIONSHIP_BOOST;

/** What the viewer is to a set of markets. Absent = no stake. */
export interface ViewerStakes {
  created: ReadonlySet<number>;
  holding: ReadonlySet<number>;
}

export const NO_STAKES: ViewerStakes = { created: new Set(), holding: new Set() };

/** Every stake the viewer has in this market, strongest first. */
export function stakesIn(marketId: number, s: ViewerStakes): Stake[] {
  const out: Stake[] = [];
  if (s.created.has(marketId)) out.push("created");
  if (s.holding.has(marketId)) out.push("holding");
  return out;
}

/**
 * The bump for a row in this market.
 *
 * The STRONGEST stake decides it, never the sum: someone who created a market
 * and also holds it has one relationship to it, not two, and adding them would
 * let a bookkeeping detail outrank a genuinely bigger stake elsewhere. This is
 * the same rule `relationshipBoost` applies to people, for the same reason.
 */
export function stakeBoost(marketId: number, s: ViewerStakes): number {
  let best = 0;
  for (const stake of stakesIn(marketId, s)) best = Math.max(best, STAKE_WEIGHT[stake]);
  return best * MAX_STAKE_BOOST;
}

/**
 * Why a row is being shown to this viewer, in two words. Null when the answer
 * is "no reason particular to you" — which must read as silence, not as a label
 * saying so.
 */
export function stakeReason(marketId: number, s: ViewerStakes): string | null {
  const [strongest] = stakesIn(marketId, s);
  if (!strongest) return null;
  return strongest === "created" ? "Your question" : "You're in this";
}
