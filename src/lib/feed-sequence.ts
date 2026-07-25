/**
 * conviction.company — Timeline Director (sequencing engine).
 *
 * Ranking decides WHAT deserves to appear. This decides the ORDER that makes the
 * feed read like turning pages instead of a stack of duplicates. It is pure
 * composition after ranking: a greedy re-order that, at each slot, prefers the
 * highest-ranked remaining card that doesn't clash with what came just before —
 * same format, same actor, same market too close, or three high-intensity cards
 * in a row. It never invents or drops cards; it only reorders.
 *
 * ZERO IO. Pure and unit-tested.
 */
import type { FeedCard } from "./conviction-feed";
import type { CardFormat } from "./feed-copy";

const WEIGHTS = {
  rankPerSlot: 1.0, // cost of pulling a card one slot past its rank
  sameFormat: 3.5, // don't show the same visual shape twice in a row
  sameActor: 2.5, // don't open two adjacent cards with the same actor label
  sameMarketInWindow: 9, // >2 cards from one market within MARKET_WINDOW rows
  tripleIntensity: 4, // after two high-intensity cards, force a breather
  groupAfterIndividual: 1.5, // prefer a crowd scene after a person scene
  calmAfterIntense: 1.2, // prefer a quieter beat after a dramatic one
} as const;

const MARKET_WINDOW = 6; // no more than 2 cards from the same market per 6 rows

function fmt(c: FeedCard): CardFormat {
  return c.copy?.format ?? "quiet";
}
function role(c: FeedCard): string {
  return c.actor?.role ?? "none";
}
function intensity(c: FeedCard): number {
  return c.copy?.intensity ?? 0;
}
function isGroup(c: FeedCard): boolean {
  return c.actor?.scale === "market" || fmt(c) === "crowd";
}
function isIndividual(c: FeedCard): boolean {
  return c.actor?.scale === "individual";
}

/** How well card `c` (ranked at `rankIdx`) fits the next slot after `out`. */
function placementScore(c: FeedCard, rankIdx: number, out: FeedCard[]): number {
  let s = -rankIdx * WEIGHTS.rankPerSlot; // stay close to rank order by default
  const prev = out[out.length - 1];
  const prev2 = out[out.length - 2];

  if (prev) {
    if (fmt(c) === fmt(prev)) s -= WEIGHTS.sameFormat;
    if (role(c) !== "none" && role(c) === role(prev)) s -= WEIGHTS.sameActor;
    if (isIndividual(prev) && isGroup(c)) s += WEIGHTS.groupAfterIndividual;
    if (intensity(prev) >= 2 && intensity(c) <= 1) s += WEIGHTS.calmAfterIntense;
  }
  if (prev && prev2 && intensity(prev) >= 2 && intensity(prev2) >= 2 && intensity(c) >= 2) {
    s -= WEIGHTS.tripleIntensity;
  }
  // Keep one market from dominating a run of rows.
  const window = out.slice(-MARKET_WINDOW);
  if (window.filter((x) => x.onchain_id === c.onchain_id).length >= 2) {
    s -= WEIGHTS.sameMarketInWindow;
  }
  return s;
}

/**
 * Reorder ranked cards for rhythm. Greedy: at each slot pick the remaining card
 * with the best placement score (rank proximity minus adjacency clashes). When
 * nothing fits cleanly the penalties simply net out and the best available card
 * is taken, so the feed never stalls.
 */
export function sequenceFeed(cards: FeedCard[]): FeedCard[] {
  const remaining = cards.map((c, idx) => ({ c, idx }));
  const out: FeedCard[] = [];
  while (remaining.length > 0) {
    let bestK = 0;
    let bestScore = -Infinity;
    for (let k = 0; k < remaining.length; k++) {
      const s = placementScore(remaining[k].c, remaining[k].idx, out);
      if (s > bestScore) {
        bestScore = s;
        bestK = k;
      }
    }
    out.push(remaining.splice(bestK, 1)[0].c);
  }
  return out;
}
