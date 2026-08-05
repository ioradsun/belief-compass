/**
 * Server side of the discovery feed (v2).
 *
 * One place assembles everything: the live market read-model, the stored AI
 * meaning, and the viewer's real history. The pure engine in `@/domain/feed`
 * then gates (hard exclusions), ranks (composite score) and sequences (rhythm +
 * diversity). The client receives a finished queue and renders it as-is.
 */
import { eligibilityFor, reentryFor, type ViewerMarketState } from "@/domain/feed/eligibility";
import { scoreMarket, type FeedAiAnalysis, type FeedMarketSignals } from "@/domain/feed/score";
import { reasonFor } from "@/domain/feed/reasons";
import {
  sequenceFeed,
  type FeedIdeaCandidate,
  type OpportunityFeedItem,
  type SequenceCandidate,
} from "@/domain/feed/sequence";
import { SEQUENCE } from "@/domain/feed/config";
import { shouldInsertSuggestion } from "@/domain/market-suggestion";
import { listFeed, type VolumeWindow } from "@/lib/markets.functions";
import {
  EMPTY_SIGNALS,
  loadMarketAnalyses,
  loadViewerSignals,
} from "@/lib/feed/viewer-signals.server";

export interface FeedSessionState {
  /** Market ids already shown to this viewer in this browsing session. */
  seenIds?: number[];
  /** Market ids already queued later in this session (never duplicated). */
  queuedIds?: number[];
  cardsViewed?: number;
  cardsSinceIdea?: number;
  ideasShownThisSession?: number;
}

export interface OpportunityFeedInput extends FeedSessionState {
  wallet?: string | null;
  /** Signed wallet session — required before any personal idea is offered. */
  sessionToken?: string | null;
  window?: VolumeWindow;
  /** Opportunity classification filter chosen by the viewer, or "all". */
  lens?: string;
  limit?: number;
}

type Row = Record<string, unknown> & { onchain_id: number };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Read-model row → the bounded live signals the ranker is allowed to see.
 *
 * `followedHere` cannot come from the row — it is a fact about the VIEWER, not
 * the market — so it is passed in and defaults to zero. An anonymous feed then
 * scores exactly as it always did.
 */
function signalsOf(r: Row, followedHere = 0): FeedMarketSignals {
  const meta = (r["markets"] ?? null) as {
    category?: string | null;
    author_wallet?: string | null;
  } | null;
  return {
    onchainId: Number(r.onchain_id),
    category: meta?.category ?? null,
    creator: meta?.author_wallet ? String(meta.author_wallet).toLowerCase() : null,
    createdAt: (r["market_created_at"] as string | null) ?? null,
    newBelievers1h: num(r["new_believers_1h"]),
    newBelievers24h: num(r["new_believers_24h"]),
    tradeCount1h: num(r["trade_count_1h"]),
    tradeCount24h: num(r["trade_count_24h"]),
    uniqueWallets1h: num(r["unique_wallets_1h"]),
    uniqueWallets24h: num(r["unique_wallets_24h"]),
    velocity5m: num(r["velocity_5m"]),
    volumeUsd24h: num(r["window_volume_usd"] ?? r["volume_24h_usd"]),
    directionalBelievers: num(r["directional_believers"]),
    divergence: num(r["divergence"]),
    priceMovePct: Math.abs(num(r["chg_24h"])),
    opportunityType: (r["opportunity_type"] as string | null) ?? null,
    opportunityReason: (r["opportunity_reason"] as string | null) ?? null,
    opportunityScore: numOrNull(r["opportunity_score"]),
    opportunityEligible: Boolean(r["opportunity_eligible"]),
    tribeSide: (r["tribe_side"] as "YES" | "NO" | null) ?? null,
    oppSide: (r["opp_side"] as "YES" | "NO" | null) ?? null,
    followedHere,
    hasMedia: Boolean(r["has_media"]),
  };
}

/** Stored analysis row → the ranker's AI view. */
function aiOf(row: Record<string, unknown> | undefined): FeedAiAnalysis | undefined {
  if (!row) return undefined;
  return {
    category: (row["category"] as string | null) ?? null,
    topic: (row["topic"] as string | null) ?? null,
    summary: (row["summary"] as string | null) ?? null,
    clarity: numOrNull(row["clarity_score"]),
    answerability: numOrNull(row["answerability_score"]),
    novelty: numOrNull(row["novelty_score"]),
    debate: numOrNull(row["debate_score"]),
    identity: numOrNull(row["identity_score"]),
    timeSensitivity: numOrNull(row["time_sensitivity"]),
    mediaRelevance: numOrNull(row["media_relevance"]),
    quality: numOrNull(row["quality_score"]),
    riskFlags: Array.isArray(row["risk_flags"]) ? (row["risk_flags"] as string[]) : [],
    embedding: Array.isArray(row["embedding"]) ? (row["embedding"] as number[]).map(Number) : null,
    duplicateClusterId: (row["duplicate_cluster_id"] as string | null) ?? null,
    duplicateSimilarity: numOrNull(row["duplicate_similarity"]),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- read-model rows are opaque JSON payloads */

/** The ready idea for this viewer, if the session gate also allows one now. */
async function ideaFor(
  wallet: string | null,
  sessionToken: string | null,
  s: FeedSessionState,
): Promise<{ idea: FeedIdeaCandidate | null; raw: Record<string, any> | null }> {
  if (!wallet || !sessionToken) return { idea: null, raw: null };
  const allowed = shouldInsertSuggestion({
    cardsViewed: s.cardsViewed ?? 0,
    cardsSinceSuggestion: s.cardsSinceIdea ?? Number.POSITIVE_INFINITY,
    suggestionsThisSession: s.ideasShownThisSession ?? 0,
    dismissedAt: null, // server-side cooldowns already gate the stored suggestion
    createdAt: null,
    hasReadySuggestion: true,
  });
  if (!allowed) return { idea: null, raw: null };
  try {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const w = await assertWalletOwnership(wallet, sessionToken);
    const { readySuggestionFor } = await import("@/lib/market-suggestion.server");
    const ready = await readySuggestionFor(w);
    if (!ready) return { idea: null, raw: null };
    return {
      idea: {
        id: ready.id,
        question: ready.question,
        category: ready.category,
        shortReason: ready.shortReason,
      },
      raw: ready,
    };
  } catch {
    // A missing session, an expired signature or a generation failure must
    // never degrade the market feed.
    return { idea: null, raw: null };
  }
}

/** Read-model row as it travels to the client (already JSON-serializable). */
export type FeedRowPayload = Record<string, any>;

export interface OpportunityFeedResult {
  items: OpportunityFeedItem[];
  /** The full read-model row for each `market` item, keyed by onchain_id. */
  rows: Record<number, FeedRowPayload>;
  /** The suggestion payload behind a `market_idea` item, when present. */
  idea: FeedRowPayload | null;
  window: VolumeWindow;
  ethUsd: number;
  historyFrom: string | null;
  tribe: FeedRowPayload | null;
  opp: FeedRowPayload | null;
  engineVersion: number;
  /** Why each dropped market was dropped — feed diagnostics, never rendered. */
  excluded: { onchainId: number; reason: string | null }[];
  error: string | null;
}

export async function buildOpportunityFeed(
  input: OpportunityFeedInput,
): Promise<OpportunityFeedResult> {
  const win: VolumeWindow = input.window ?? "24h";
  const wallet = input.wallet?.toLowerCase() ?? null;
  const now = Date.now();

  const feed = await listFeed({ data: { window: win, ...(wallet ? { wallet } : {}) } });
  const all = (feed.data ?? []) as unknown as Row[];
  const lens = input.lens && input.lens !== "all" ? input.lens : null;
  const rows = lens ? all.filter((r) => r["opportunity_type"] === lens) : all;
  const ids = rows.map((r) => Number(r.onchain_id));

  const [signals, analyses, ideaResult] = await Promise.all([
    wallet && ids.length ? loadViewerSignals(wallet, ids) : Promise.resolve(EMPTY_SIGNALS),
    loadMarketAnalyses(ids),
    ideaFor(wallet, input.sessionToken ?? null, input),
  ]);

  const sessionSeen = new Set<number>(input.seenIds ?? []);
  const sessionQueued = new Set<number>(input.queuedIds ?? []);
  // A rotating epoch keeps the exploration slot moving without reshuffling the
  // rest of the feed between polls.
  const epoch = Math.floor(now / 3_600_000);

  const candidates: SequenceCandidate[] = rows.map((r) => {
    // Followed people connected to this market: the ones holding a position,
    // plus the creator when the viewer follows them. ONE set, because the
    // product never distinguishes creating from participating — and a set
    // rather than a sum, so a followed creator who also backed their own market
    // is the one person they are.
    const creator = ((r["markets"] ?? null) as { author_wallet?: string | null } | null)
      ?.author_wallet;
    const here = new Set(signals.followedInMarket.get(Number(r.onchain_id)) ?? []);
    if (creator && signals.following.has(String(creator).toLowerCase()))
      here.add(String(creator).toLowerCase());
    const s = signalsOf(r, here.size);
    const ai = aiOf(analyses.get(s.onchainId));
    const state: ViewerMarketState | undefined = signals.states.get(s.onchainId);
    const scored = scoreMarket({ signals: s, ai, viewer: signals.profile, now, epoch });
    const eligibility = eligibilityFor({
      onchainId: s.onchainId,
      state,
      sessionSeen,
      sessionQueued,
      now,
    });
    const holds = signals.held.has(s.onchainId);
    const reentry = eligibility.eligible
      ? null
      : reentryFor(
          {
            acceleration: scored.acceleration,
            newBelievers1h: s.newBelievers1h,
            priceMovePct: s.priceMovePct,
            divergence: s.divergence,
            tribeEntered: Boolean(s.tribeSide),
            oppEntered: Boolean(s.oppSide),
            positionMovePct: holds ? num(r["chg_24h"]) : 0,
          },
          { holdsPosition: holds, now },
        );

    return {
      onchainId: s.onchainId,
      category: s.category ?? ai?.category ?? null,
      creator: s.creator,
      clusterId: ai?.duplicateClusterId ?? null,
      scored,
      eligibility,
      reason: reasonFor(s, scored, { category: s.category ?? ai?.category ?? null }),
      reentry,
    };
  });

  const { items, engineVersion, excluded } = sequenceFeed({
    candidates,
    idea: ideaResult.idea,
    ...(input.limit ? { limit: input.limit } : { limit: SEQUENCE.DEFAULT_LIMIT }),
  });

  // Carry the market's classification onto the card for the existing UI badges.
  const byId: Record<number, FeedRowPayload> = {};
  for (const r of rows) byId[Number(r.onchain_id)] = r;
  for (const it of items) {
    if (it.kind !== "market") continue;
    it.opportunityType = (byId[it.onchainId]?.["opportunity_type"] as string | null) ?? null;
  }

  return {
    items,
    rows: byId,
    idea: ideaResult.raw,
    window: win,
    ethUsd: feed.ethUsd ?? 0,
    historyFrom: feed.historyFrom ?? null,
    tribe: (feed.tribe as FeedRowPayload | null) ?? null,
    opp: (feed.opp as FeedRowPayload | null) ?? null,
    engineVersion,
    excluded,
    error: feed.error ?? null,
  };
}
