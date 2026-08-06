/**
 * HOW MANY PEOPLE ARE IN THIS MARKET — one definition, every surface.
 *
 * THE WORD WAS ALREADY IN THE PRODUCT WITH TWO MEANINGS. `market_participation`
 * counts DISTINCT WALLETS over the canonical event tape — everyone who has ever
 * traded a market — and the feed row carried that number raw. The search index
 * carried `Math.max(reach, believers_yes + believers_no)` instead, with a real
 * reason attached: a market whose trades pre-date event indexing has a reach of
 * zero while visibly holding believers, and printing "0 participants" over a
 * market with people in it is the confident zero this codebase keeps producing.
 *
 * Both are defensible. Having both is not. The same market could be called 5
 * participants in the running order and 12 in a search result one keystroke
 * away, and a reader who notices stops trusting either number.
 *
 * So the fallback wins — it is strictly more honest — and it lives here, where
 * the feed, the search index and the Explore lens all read it.
 *
 * WHY THIS IS THE NUMBER "MOST PARTICIPANTS" RANKS ON. It is the only count in
 * the data model that means what the label says: how many people are in this
 * market, irrespective of side. The alternatives each answer a narrower
 * question — `believers_yes`/`believers_no` are per-side, `directional_believers`
 * counts who is holding a side RIGHT NOW (and has drifted: it reads 2 on market
 * #101, which holds zero believers on both sides), and `unique_wallets_24h` is a
 * window. A lens that ranks on one of those while its label promises "people in
 * this market" is a label that lies.
 *
 * ZERO IO, pure, fully testable.
 */

export interface ParticipantInput {
  /**
   * Distinct wallets that ever traded, from `market_participation`. Null or
   * absent when the tape has nothing for this market — which is NOT the same as
   * zero people, and is exactly why the fallback exists.
   */
  reachParticipants?: number | null;
  /** Standing believers per side, from the read model. */
  believersYes?: number | null;
  believersNo?: number | null;
}

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

/**
 * The canonical count. Never returns less than the people visibly holding a
 * side, and never invents anyone the tape did not see.
 *
 * MAX, not sum: the two inputs describe overlapping populations — a standing
 * believer is someone who traded — so adding them would double-count everyone
 * the tape did record. Max takes the better-informed of the two answers.
 */
export function participantCount(i: ParticipantInput): number {
  return Math.max(n(i.reachParticipants), n(i.believersYes) + n(i.believersNo));
}

/** "1 participant" / "42 participants". */
export function participantsLabel(count: number): string {
  const c = n(count);
  return `${c} participant${c === 1 ? "" : "s"}`;
}
