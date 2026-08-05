/**
 * Feed sequencing — variety, not a sorted list.
 *
 * Ranking says which markets are worth showing. Sequencing decides the ORDER a
 * person experiences them in: a rhythm of personal match → fast-rising → social
 * → fresh → early → exploration, with hard limits on category runs, repeated
 * creators and near-duplicate questions. Re-entry cards (markets the viewer has
 * already acted on) are rare and always labelled.
 *
 * Pure and deterministic: server and client always agree on the same order.
 */
import { SEQUENCE, FEED_ENGINE_VERSION, type ScoreComponent } from "./config";
import type { ScoredMarket, Components } from "./score";
import type { Eligibility, ExclusionReason, Reentry } from "./eligibility";
import type { FeedReason } from "./reasons";

export type FeedItemKind = "market" | "market_idea";

/** One fully-evaluated market entering sequencing. */
export interface SequenceCandidate {
  onchainId: number;
  category: string | null;
  creator: string | null;
  clusterId: string | null;
  scored: ScoredMarket;
  eligibility: Eligibility;
  reason: FeedReason | null;
  /** Set only when this is an already-acted market with a material update. */
  reentry: Reentry | null;
}

export interface FeedIdeaCandidate {
  id: string;
  question: string;
  category: string;
  shortReason: string;
}

/** Why this card is in this slot — the developer answer, shipped with the card. */
export interface FeedDiagnostics {
  eligible: boolean;
  exclusionReason: ExclusionReason | null;
  score: number;
  components: Components;
  driver: ScoreComponent;
  acceleration: number;
  ageHours: number | null;
  clusterId: string | null;
  /** Sequencing moves applied when placing this card. */
  diversityAdjustments: string[];
  slotIntent: ScoreComponent | "reentry" | "fill";
  reasonCode: string | null;
}

export interface FeedMarketItem {
  kind: "market";
  position: number;
  onchainId: number;
  score: number;
  /** The one sentence shown on the card. */
  primaryReason: string | null;
  reasonCode: string | null;
  /** Present ONLY on a re-entry card, and always shown as its own label. */
  reentryLabel: string | null;
  reentryDetail: string | null;
  opportunityType: string | null;
  diagnostics: FeedDiagnostics;
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

/** The rhythm. Each slot asks for a card whose dominant component matches. */
const RHYTHM: (ScoreComponent | "any")[] = [
  "personal",
  "momentum",
  "social",
  "freshness",
  "quality",
  "any",
  "early",
  "exploration",
];

interface Placed {
  c: SequenceCandidate;
  adjustments: string[];
  intent: ScoreComponent | "reentry" | "fill";
}

function violates(out: Placed[], c: SequenceCandidate): string | null {
  const n = out.length;
  if (c.category) {
    let run = 0;
    for (let i = n - 1; i >= 0 && out[i]!.c.category === c.category; i -= 1) run += 1;
    if (run >= SEQUENCE.MAX_SAME_CATEGORY_RUN) return "category_run";
  }
  if (c.creator) {
    let run = 0;
    for (let i = n - 1; i >= 0 && out[i]!.c.creator === c.creator; i -= 1) run += 1;
    if (run >= SEQUENCE.MAX_SAME_CREATOR_RUN) return "creator_run";
  }
  if (c.clusterId) {
    for (let i = n - 1; i >= Math.max(0, n - SEQUENCE.MIN_CLUSTER_GAP); i -= 1) {
      if (out[i]!.c.clusterId === c.clusterId) return "semantic_duplicate";
    }
  }
  return null;
}

export interface SequenceInput {
  candidates: SequenceCandidate[];
  idea?: FeedIdeaCandidate | null;
  ideaSlot?: number;
  limit?: number;
}

export interface SequenceResult {
  items: OpportunityFeedItem[];
  engineVersion: number;
  /** Markets the gate removed, with the reason — feed diagnostics. */
  excluded: { onchainId: number; reason: ExclusionReason | null }[];
}

/**
 * Build the ordered queue. Ineligible markets are dropped BEFORE anything else;
 * only a labelled re-entry can re-enter, capped at one per REENTRY_EVERY cards.
 */
export function sequenceFeed(input: SequenceInput): SequenceResult {
  const limit = Math.min(Math.max(1, input.limit ?? SEQUENCE.DEFAULT_LIMIT), SEQUENCE.MAX_LIMIT);

  const excluded: { onchainId: number; reason: ExclusionReason | null }[] = [];
  const pool: SequenceCandidate[] = [];
  const reentries: SequenceCandidate[] = [];

  for (const c of input.candidates) {
    if (c.eligibility.eligible) {
      pool.push(c);
      continue;
    }
    // Hidden and session-duplicates can NEVER come back, whatever happened.
    const r = c.eligibility.reason;
    const banned = r === "hidden" || r === "seen_this_session" || r === "queued_this_session";
    if (c.reentry && !banned) reentries.push(c);
    else excluded.push({ onchainId: c.onchainId, reason: r });
  }

  pool.sort((a, b) => b.scored.score - a.scored.score || a.onchainId - b.onchainId);
  reentries.sort((a, b) => b.scored.score - a.scored.score || a.onchainId - b.onchainId);

  const out: Placed[] = [];
  let reentryIdx = 0;

  while (out.length < limit && (pool.length > 0 || reentryIdx < reentries.length)) {
    const slot = out.length;
    // Rare, evenly-spaced re-entry slots — never more than 1 in REENTRY_EVERY.
    if (slot > 0 && slot % SEQUENCE.REENTRY_EVERY === 0 && reentryIdx < reentries.length) {
      out.push({ c: reentries[reentryIdx]!, adjustments: [], intent: "reentry" });
      reentryIdx += 1;
      continue;
    }
    if (pool.length === 0) break;

    const want = RHYTHM[slot % RHYTHM.length]!;
    const adjustments: string[] = [];

    // Prefer the best-scoring candidate whose dominant component matches the
    // slot's intent; fall back to the best remaining one.
    let pick = want === "any" ? -1 : pool.findIndex((c) => c.scored.driver === want);
    let intent: ScoreComponent | "fill" = pick >= 0 ? (want as ScoreComponent) : "fill";
    if (pick < 0) pick = 0;

    // Respect diversity: skip forward past anything that would clump.
    let cursor = pick;
    let conflict = violates(out, pool[cursor]!);
    while (conflict && cursor < pool.length - 1) {
      if (!adjustments.includes(conflict)) adjustments.push(conflict);
      cursor += 1;
      conflict = violates(out, pool[cursor]!);
      intent = "fill";
    }

    const [chosen] = pool.splice(cursor, 1);
    out.push({ c: chosen!, adjustments, intent });
  }

  const items: OpportunityFeedItem[] = out.map((p, i) => ({
    kind: "market",
    position: i,
    onchainId: p.c.onchainId,
    score: p.c.scored.score,
    primaryReason: p.c.reentry ? p.c.reentry.detail : (p.c.reason?.text ?? null),
    reasonCode: p.c.reentry ? "reentry" : (p.c.reason?.code ?? null),
    reentryLabel: p.c.reentry?.label ?? null,
    reentryDetail: p.c.reentry?.detail ?? null,
    opportunityType: null,
    diagnostics: {
      eligible: p.c.eligibility.eligible,
      exclusionReason: p.c.eligibility.reason,
      score: p.c.scored.score,
      components: p.c.scored.components,
      driver: p.c.scored.driver,
      acceleration: p.c.scored.acceleration,
      ageHours: p.c.scored.ageHours,
      clusterId: p.c.clusterId,
      diversityAdjustments: p.adjustments,
      slotIntent: p.intent,
      reasonCode: p.c.reentry ? "reentry" : (p.c.reason?.code ?? null),
    },
  }));

  if (input.idea && items.length >= SEQUENCE.IDEA_MIN_POSITION) {
    const slot = Math.min(
      Math.max(input.ideaSlot ?? SEQUENCE.IDEA_MIN_POSITION, SEQUENCE.IDEA_MIN_POSITION),
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

  return { items, engineVersion: FEED_ENGINE_VERSION, excluded };
}

/** Forward-only: the id after `currentIdx`, or null when the queue is done. */
export function nextMarketId(ids: number[], currentIdx: number): number | null {
  return ids[currentIdx + 1] ?? null;
}
