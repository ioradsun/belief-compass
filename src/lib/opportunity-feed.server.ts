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
import {
  matches as matchesFilters,
  normalize as normalizeFilters,
  orderingMode,
  type FeedFilters,
  type FeedNetwork,
} from "@/domain/feed/filters";
import { shouldInsertSuggestion } from "@/domain/market-suggestion";
import { listFeed, type VolumeWindow } from "@/lib/markets.functions";
import {
  EMPTY_SIGNALS,
  loadMarketAnalyses,
  loadOriginOverlap,
  loadViewerSignals,
} from "@/lib/feed/viewer-signals.server";
import { serviceClientOrNull } from "@/lib/supabase-clients";

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
   * The reader's own lens: network groups and topics. OR within a group, AND
   * across groups (see @/domain/feed/filters). Empty means "All", which is the
   * unfiltered feed and the default.
   */
  networks?: string[];
  topics?: string[];
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

/** What the viewer's follows are doing here. Empty for an anonymous feed. */
interface FollowedPresence {
  here: number;
  yes: number;
  no: number;
  names: string[];
}
const NO_FOLLOWS: FollowedPresence = { here: 0, yes: 0, no: 0, names: [] };

/**
 * Read-model row → the bounded live signals the ranker is allowed to see.
 *
 * The follow facts cannot come from the row — they are about the VIEWER, not the
 * market — so they are passed in and default to empty. An anonymous feed then
 * scores exactly as it always did.
 */
function signalsOf(
  r: Row,
  followed: FollowedPresence = NO_FOLLOWS,
  connectedToOrigin = 0,
): FeedMarketSignals {
  const mo = (r["momentum"] ?? null) as { weight?: number } | null;
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
    priceMovePct: Math.abs(num(r["chg_window_yes"])),
    momentumWeight: num(mo?.weight),
    opportunityType: (r["opportunity_type"] as string | null) ?? null,
    opportunityReason: (r["opportunity_reason"] as string | null) ?? null,
    opportunityScore: numOrNull(r["opportunity_score"]),
    opportunityEligible: Boolean(r["opportunity_eligible"]),
    tribeSide: (r["tribe_side"] as "YES" | "NO" | null) ?? null,
    oppSide: (r["opp_side"] as "YES" | "NO" | null) ?? null,
    tribeCount: num(r["tribe_count"]),
    oppCount: num(r["opp_count"]),
    followedHere: followed.here,
    followedYes: followed.yes,
    followedNo: followed.no,
    followedNames: followed.names,
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
  /** The canonical filter selection this result was built for. */
  filters: FeedFilters;
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

  const filters: FeedFilters = normalizeFilters({
    networks: (input.networks ?? []) as FeedNetwork[],
    topics: input.topics ?? [],
  });
  // A single network chosen IS a perspective, so the Tribe / Rivals rankings
  // still apply; everything else keeps the blend the ranker produced.
  const mode = input.mode ? toFeedMode(input.mode) : toFeedMode(orderingMode(filters));
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
    loadOriginOverlap(serviceClientOrNull(), origin, ids),
  ]);

  const sessionSeen = new Set<number>(input.seenIds ?? []);
  const sessionQueued = new Set<number>(input.queuedIds ?? []);
  // A rotating epoch keeps the exploration slot moving without reshuffling the
  // rest of the feed between polls.
  const epoch = Math.floor(now / 3_600_000);

  /** What each market looks like to the reader's filter — filled as we map. */
  const filterFacts = new Map<
    number,
    {
      category: string | null;
      tribeCount: number;
      oppCount: number;
      followedHere: number;
      tribeTouched: boolean;
      oppTouched: boolean;
    }
  >();

  const candidates: SequenceCandidate[] = rows.map((r) => {
    // Followed people connected to this market: the ones holding a position,
    // plus the creator when the viewer follows them. ONE set, because the
    // product never distinguishes creating from participating — and a set
    // rather than a sum, so a followed creator who also backed their own market
    // is the one person they are.
    const creator = ((r["markets"] ?? null) as { author_wallet?: string | null } | null)
      ?.author_wallet;
    const here = new Map(signals.followedInMarket.get(Number(r.onchain_id)) ?? []);
    // A followed creator who never backed their own market is connected without
    // a side — `set` only when absent, so authorship never overwrites a real one.
    const cw = creator ? String(creator).toLowerCase() : null;
    if (cw && signals.following.has(cw) && !here.has(cw)) here.set(cw, null);
    // Names for the sides only. Naming someone whose sole connection is having
    // written the question would put them in a sentence about backing.
    const names: string[] = [];
    let yes = 0;
    let no = 0;
    for (const [w, side] of here) {
      if (side === "YES") yes += 1;
      else if (side === "NO") no += 1;
      else continue;
      const n = signals.followedNames.get(w);
      if (n) names.push(n);
    }
    const s = signalsOf(
      r,
      { here: here.size, yes, no, names },
      originOverlap.get(Number(r.onchain_id)) ?? 0,
    );
    filterFacts.set(s.onchainId, {
      category: s.category,
      tribeCount: s.tribeCount,
      oppCount: s.oppCount,
      followedHere: s.followedHere,
      // Created or traded here, side or no side — what "My Tribe" / "Rivals"
      // actually asks about (see @/domain/feed/filters).
      tribeTouched: Boolean(r["tribe_touched"]),
      oppTouched: Boolean(r["opp_touched"]),
    });
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
            positionMovePct: holds ? num(r["chg_window_yes"]) : 0,
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
      reason: reasonFor(s, scored, {
        category: s.category ?? ai?.category ?? null,
        momentum: (r["momentum"] ?? null) as never,
        window: win,
      }),
      reentry,
      poolSlices: Array.isArray(r["pool_slices"]) ? (r["pool_slices"] as string[]) : [],
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
  // The reader's filter runs BEFORE the mode ordering and before sequencing, so
  // rhythm and diversity still apply to whatever survives it. A filter that
  // empties the feed returns an empty feed honestly rather than silently
  // widening back out to All.
  const kept = candidates.filter((c) => {
    const facts = filterFacts.get(c.onchainId);
    return facts ? matchesFilters(filters, facts) : true;
  });

  const candidateById = new Map(kept.map((c) => [c.onchainId, c]));
  const ordered = orderForMode(
    mode,
    kept.flatMap((c) => modeOf.get(c.onchainId) ?? []),
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
    filters,
    // A viewer whose network shrank below the gate keeps whatever they chose
    // for THIS response — the result says what it is, and the picker decides
    // separately what to offer next.
    modes: (feed as { modes?: FeedMode[] }).modes ?? ["for_you"],
    engineVersion,
    excluded,
    error: feed.error ?? null,
  };
}
