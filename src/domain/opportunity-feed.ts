/**
 * The unified opportunity feed — one authoritative sequencing engine.
 *
 * The center column is a single ordered sequence of items. An item is either a
 * `market` (a real, tradeable market) or a `market_idea` ("The House has an
 * idea"). Both compete for the same slots under the same rules, so there is
 * exactly ONE place that decides what a person sees next.
 *
 * This module is PURE: no IO, no React, no Supabase. The server gathers the
 * candidates and the viewer context and calls `sequenceFeed`; the client
 * renders the result in the order it arrives and never re-scores, re-sorts or
 * re-filters it.
 *
 * Honesty rules encoded here:
 *  - Global opportunity score is the base. Personalization only MODULATES it
 *    within a bounded multiplier — it can never manufacture an opportunity out
 *    of a dead market.
 *  - Every item carries the human reason it surfaced, and every personal reason
 *    is derived from a real viewer fact (a held position, a tribe member's
 *    stance, a category you actually act in).
 */

export type FeedItemKind = "market" | "market_idea";

/** Every tunable in one place. */
export const FEED = {
  ENGINE_VERSION: 1,
  /** Personalization band: relevance can only modulate the global score. */
  MIN_MULTIPLIER: 0.7,
  MAX_MULTIPLIER: 1.6,
  /** Per-reason multiplier contributions (additive, then clamped). */
  BOOST: {
    CATEGORY_AFFINITY: 0.3,
    TRIBE_ACTIVE: 0.2,
    OPP_ACTIVE: 0.15,
    HELD_POSITION: 0.25,
  },
  /** Already-decided markets step back so the feed keeps moving forward. */
  DECIDED_PENALTY: 0.25,
  /** Seen this session (but not decided) — a gentle step back, never a ban. */
  SEEN_PENALTY: 0.12,
  /** Ineligible markets rank below every eligible one, on volume order. */
  INELIGIBLE_BASE: -1,
  /** No more than this many consecutive items from one category. */
  MAX_SAME_CATEGORY_RUN: 2,
  /** The idea card never takes one of the first slots. */
  IDEA_MIN_POSITION: 3,
  DEFAULT_LIMIT: 30,
  MAX_LIMIT: 60,
} as const;

export type RelevanceReasonCode =
  "category_affinity" | "tribe_active" | "opp_active" | "held_position" | "already_decided";

export interface RelevanceReason {
  code: RelevanceReasonCode;
  /** Human sentence, shown as-is. Never invents demand or urgency. */
  text: string;
}

export interface FeedRelevance {
  multiplier: number;
  reasons: RelevanceReason[];
}

/** One market as it enters sequencing (server read-model projection). */
export interface FeedMarketCandidate {
  onchainId: number;
  category: string | null;
  opportunityEligible: boolean;
  opportunityScore: number | null;
  opportunityType: string | null;
  opportunityReason: string | null;
  windowVolumeUsd: number | null;
}

/** The idea candidate, if one is ready and allowed for this viewer. */
export interface FeedIdeaCandidate {
  id: string;
  question: string;
  category: string;
  shortReason: string;
}

/**
 * Everything personal the sequencer is allowed to know. All of it comes from
 * real, already-computed viewer state (DNA cache, positions, answers).
 */
export interface ViewerFeedContext {
  /** category → affinity in 0..1, from the viewer's own recent actions. */
  categoryAffinity: Record<string, number>;
  /** Markets where a tribe/twin match holds a directional stance. */
  tribeMarkets: number[];
  /** Markets where an opp/inverse match holds a directional stance. */
  oppMarkets: number[];
  /** Markets the viewer holds a position in. */
  heldMarkets: number[];
  /** Markets the viewer has already answered (YES/NO/PASS). */
  decidedMarkets: number[];
}

export const EMPTY_VIEWER_CONTEXT: ViewerFeedContext = {
  categoryAffinity: {},
  tribeMarkets: [],
  oppMarkets: [],
  heldMarkets: [],
  decidedMarkets: [],
};

export interface FeedMarketItem {
  kind: "market";
  position: number;
  onchainId: number;
  /** Global, viewer-independent opportunity score (or null when ineligible). */
  baseScore: number | null;
  /** baseScore modulated by relevance — the value this order was built from. */
  rankScore: number;
  relevance: FeedRelevance;
  /** The single sentence to show. Personal reason wins over the global one. */
  primaryReason: string | null;
  opportunityType: string | null;
}

export interface FeedIdeaItem {
  kind: "market_idea";
  position: number;
  suggestionId: string;
  question: string;
  category: string;
  shortReason: string;
}

export type OpportunityFeedItem = FeedMarketItem | FeedIdeaItem;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const has = (list: number[], id: number) => list.includes(id);

/**
 * V1 discovery rule: once a viewer makes a REAL decision on a market (a confirmed
 * YES/NO purchase, or a PASS), that market leaves the normal discovery queue — it
 * is never asked again. Pure exclusion by id; the caller supplies the completed
 * set (persisted, first-write-wins). Applied BEFORE sequencing so completed
 * markets stay out under every lens. Anonymous viewers pass an empty set.
 */
export function excludeDecided<T extends { onchainId: number }>(
  markets: T[],
  completed: ReadonlySet<number>,
): T[] {
  return completed.size === 0 ? markets : markets.filter((m) => !completed.has(m.onchainId));
}

/**
 * The next market in the sequence — NO modulo wrapping. Returns the id after
 * `currentIdx`, or null when there is none (the caller shows the caught-up state
 * instead of looping back to the start).
 */
export function nextMarketId(ids: number[], currentIdx: number): number | null {
  const next = ids[currentIdx + 1];
  return next == null ? null : next;
}

/**
 * How relevant is this market TO THIS PERSON, and why. The multiplier is always
 * inside [MIN_MULTIPLIER, MAX_MULTIPLIER]: personalization reorders the feed,
 * it never creates opportunity.
 */
export function relevanceFor(
  candidate: FeedMarketCandidate,
  viewer: ViewerFeedContext,
): FeedRelevance {
  const reasons: RelevanceReason[] = [];
  let m = 1;

  const cat = candidate.category;
  const affinity = cat ? (viewer.categoryAffinity[cat] ?? 0) : 0;
  if (affinity > 0) {
    m += FEED.BOOST.CATEGORY_AFFINITY * clamp(affinity, 0, 1);
    reasons.push({ code: "category_affinity", text: `You act in ${cat}.` });
  }
  if (has(viewer.heldMarkets, candidate.onchainId)) {
    m += FEED.BOOST.HELD_POSITION;
    reasons.push({ code: "held_position", text: "You hold a position here." });
  }
  if (has(viewer.tribeMarkets, candidate.onchainId)) {
    m += FEED.BOOST.TRIBE_ACTIVE;
    reasons.push({ code: "tribe_active", text: "Someone in your tribe has taken a side." });
  }
  if (has(viewer.oppMarkets, candidate.onchainId)) {
    m += FEED.BOOST.OPP_ACTIVE;
    reasons.push({ code: "opp_active", text: "Someone you disagree with has taken a side." });
  }
  if (has(viewer.decidedMarkets, candidate.onchainId)) {
    m -= FEED.DECIDED_PENALTY;
    reasons.push({ code: "already_decided", text: "You've already answered this one." });
  }

  return { multiplier: clamp(m, FEED.MIN_MULTIPLIER, FEED.MAX_MULTIPLIER), reasons };
}

/**
 * Base (viewer-independent) rank value. Eligible markets rank on the global
 * opportunity score; everything else falls back to window volume BELOW every
 * eligible market, so the feed is never empty before the engine warms up.
 */
export function baseRankFor(c: FeedMarketCandidate): number {
  if (c.opportunityEligible && c.opportunityScore != null && Number.isFinite(c.opportunityScore)) {
    return Math.max(0, Number(c.opportunityScore));
  }
  const vol = Number(c.windowVolumeUsd ?? 0);
  // Compress volume into a small negative band so ordering is preserved but it
  // can never outrank a scored market.
  return FEED.INELIGIBLE_BASE - 1 / (1 + Math.max(0, vol));
}

interface Scored {
  candidate: FeedMarketCandidate;
  base: number;
  rank: number;
  relevance: FeedRelevance;
}

function scoreAll(
  candidates: FeedMarketCandidate[],
  viewer: ViewerFeedContext,
  seen: number[],
): Scored[] {
  return candidates.map((candidate) => {
    const base = baseRankFor(candidate);
    const relevance = relevanceFor(candidate, viewer);
    let rank = base >= 0 ? base * relevance.multiplier : base;
    if (has(seen, candidate.onchainId)) rank -= Math.abs(rank) * FEED.SEEN_PENALTY + 0.001;
    return { candidate, base, rank, relevance };
  });
}

/**
 * Reorder so no category runs longer than MAX_SAME_CATEGORY_RUN, by pulling the
 * best-ranked item of a different category forward. Order is otherwise
 * preserved — this breaks monotony, it does not re-rank.
 */
export function applyCategoryDiversity<T extends { candidate: FeedMarketCandidate }>(
  items: T[],
): T[] {
  const pool = [...items];
  const out: T[] = [];
  let runCat: string | null = null;
  let run = 0;
  while (pool.length) {
    let pick = 0;
    if (runCat != null && run >= FEED.MAX_SAME_CATEGORY_RUN) {
      const alt = pool.findIndex((p) => (p.candidate.category ?? null) !== runCat);
      if (alt >= 0) pick = alt;
    }
    const [chosen] = pool.splice(pick, 1);
    const cat = chosen!.candidate.category ?? null;
    if (cat === runCat) run += 1;
    else {
      runCat = cat;
      run = 1;
    }
    out.push(chosen!);
  }
  return out;
}

export interface SequenceInput {
  markets: FeedMarketCandidate[];
  viewer?: ViewerFeedContext;
  /** Ready idea, already gated server-side. Omit to run a pure market feed. */
  idea?: FeedIdeaCandidate | null;
  /** Market ids the viewer has already been shown this session. */
  seenIds?: number[];
  /** Cards viewed this session — the idea never appears before it warms up. */
  ideaSlot?: number;
  limit?: number;
}

export interface SequenceResult {
  items: OpportunityFeedItem[];
  engineVersion: number;
}

/**
 * The one function that decides what comes next. Deterministic for a given
 * input, so SSR and the client always agree.
 */
export function sequenceFeed(input: SequenceInput): SequenceResult {
  const viewer = input.viewer ?? EMPTY_VIEWER_CONTEXT;
  const seen = input.seenIds ?? [];
  const limit = clamp(input.limit ?? FEED.DEFAULT_LIMIT, 1, FEED.MAX_LIMIT);

  const scored = scoreAll(input.markets, viewer, seen).sort(
    (a, b) => b.rank - a.rank || a.candidate.onchainId - b.candidate.onchainId,
  );
  const diversified = applyCategoryDiversity(scored).slice(0, limit);

  const items: OpportunityFeedItem[] = diversified.map((s, i) => ({
    kind: "market",
    position: i,
    onchainId: s.candidate.onchainId,
    baseScore: s.base >= 0 ? s.base : null,
    rankScore: s.rank,
    relevance: s.relevance,
    primaryReason: primaryReasonFor(s.candidate, s.relevance),
    opportunityType: s.candidate.opportunityType,
  }));

  if (input.idea) {
    const slot = clamp(
      input.ideaSlot ?? FEED.IDEA_MIN_POSITION,
      FEED.IDEA_MIN_POSITION,
      items.length,
    );
    items.splice(slot, 0, {
      kind: "market_idea",
      position: slot,
      suggestionId: input.idea.id,
      question: input.idea.question,
      category: input.idea.category,
      shortReason: input.idea.shortReason,
    });
    items.forEach((it, i) => {
      it.position = i;
    });
  }

  return { items, engineVersion: FEED.ENGINE_VERSION };
}

/**
 * One sentence per card. A personal fact beats the global classification —
 * "someone in your tribe took a side" is more useful than "volume is up" — but
 * a demotion reason ("already answered") never becomes the headline.
 */
export function primaryReasonFor(
  candidate: FeedMarketCandidate,
  relevance: FeedRelevance,
): string | null {
  const order: RelevanceReasonCode[] = [
    "held_position",
    "tribe_active",
    "opp_active",
    "category_affinity",
  ];
  for (const code of order) {
    const hit = relevance.reasons.find((r) => r.code === code);
    if (hit) return hit.text;
  }
  return candidate.opportunityReason ?? null;
}
