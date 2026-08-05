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
import {
  orderForMode,
  toFeedMode,
  availableModes,
  type FeedMode,
  type ModeCandidate,
} from "@/domain/feed/mode";
import { shouldInsertSuggestion } from "@/domain/market-suggestion";
import { listFeed, type VolumeWindow } from "@/lib/markets.functions";
import {
  EMPTY_SIGNALS,
  loadMarketAnalyses,
  loadOriginOverlap,
  loadViewerSignals,
} from "@/lib/feed/viewer-signals.server";
import { serviceClient } from "@/lib/supabase-clients";

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
  /**
   * Which social perspective the viewer chose — "for_you" | "tribe" | "rivals".
   * Replaces the old opportunity `lens`: unrecognised values (including saved
   * `?lens=hot` links) fall back to For You rather than emptying the feed.
   */
  mode?: string;
  /**
   * The market the viewer arrived at from OUTSIDE the running order — a search
   * result, a Live row, one of their positions. Its people become a weak signal
   * for what follows, which is what turns a search into an entry point rather
   * than a lookup that ends when the result opens.
   */
  originMarketId?: number | null;
  limit?: number;
}

type Row = Record<string, unknown> & { onchain_id: number };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** Epoch-ms → hours ago, or null when we were never told. */
const hoursSince = (v: unknown, now: number): number | null => {
  const t = Number(v);
  return Number.isFinite(t) && t > 0 ? Math.max(0, (now - t) / 3_600_000) : null;
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
function signalsOf(r: Row, followedHere = 0, connectedToOrigin = 0): FeedMarketSignals {
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
    tribeCount: num(r["tribe_count"]),
    oppCount: num(r["opp_count"]),
    followedHere,
    connectedToOrigin,
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
  /** The perspective this result was built for. */
  mode: FeedMode;
  /**
   * The perspectives this viewer's network can actually seat. Always contains
   * "for_you"; Tribe and Rivals appear only once the evidence exists to fill
   * them, so the picker never offers a tab that would read "nothing here".
   */
  modes: FeedMode[];
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

  const mode = toFeedMode(input.mode);
  const feed = await listFeed({ data: { window: win, ...(wallet ? { wallet } : {}) } });
  const rows = (feed.data ?? []) as unknown as Row[];
  const ids = rows.map((r) => Number(r.onchain_id));

  const origin =
    typeof input.originMarketId === "number" && Number.isFinite(input.originMarketId)
      ? input.originMarketId
      : null;
  const [signals, analyses, ideaResult, originOverlap] = await Promise.all([
    wallet && ids.length ? loadViewerSignals(wallet, ids) : Promise.resolve(EMPTY_SIGNALS),
    loadMarketAnalyses(ids),
    ideaFor(wallet, input.sessionToken ?? null, input),
    // Anonymous viewers get this too: it is a fact about the MARKET they opened,
    // not about them, so it needs no wallet and no history.
    loadOriginOverlap(serviceClient(), origin, ids),
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
    const s = signalsOf(r, here.size, originOverlap.get(Number(r.onchain_id)) ?? 0);
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

  // What each market looks like to a MODE. Kept parallel rather than folded
  // into SequenceCandidate: sequencing is about rhythm and diversity and has no
  // business knowing which social perspective produced its input.
  const modeOf = new Map<number, ModeCandidate>();
  for (const r of rows) {
    const id = Number(r.onchain_id);
    modeOf.set(id, {
      onchainId: id,
      score: candidates.find((c) => c.onchainId === id)?.scored.score ?? 0,
      tribeCount: num(r["tribe_count"]),
      oppCount: num(r["opp_count"]),
      tribeOverlap: num(r["tribe_overlap"]),
      oppOverlap: num(r["opp_overlap"]),
      recencyHours: hoursSince(r["network_last_at"], now),
    });
  }

  /**
   * The mode re-orders and, for Tribe and Rivals, FILTERS — before sequencing,
   * so the rhythm and diversity rules still apply to whatever survives. For You
   * hands the list through untouched: it is a blend, not a perspective on a
   * subset, and re-sorting it would undo the ranking that produced it.
   */
  const candidateById = new Map(candidates.map((c) => [c.onchainId, c]));
  const ordered = orderForMode(
    mode,
    candidates.flatMap((c) => modeOf.get(c.onchainId) ?? []),
  ).flatMap((m) => candidateById.get(m.onchainId) ?? []);

  const { items, engineVersion, excluded } = sequenceFeed({
    candidates: ordered,
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
    mode,
    // A viewer whose network shrank below the gate keeps whatever they chose
    // for THIS response — the result says what it is, and the picker decides
    // separately what to offer next.
    modes: (feed as { modes?: FeedMode[] }).modes ?? ["for_you"],
    engineVersion,
    excluded,
    error: feed.error ?? null,
  };
}
