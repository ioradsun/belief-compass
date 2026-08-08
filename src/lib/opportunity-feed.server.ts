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
import {
  atSensitivity,
  NO_MOMENTUM,
  type MomentumFacts,
  type MomentumLens,
} from "@/domain/feed/momentum";
import { orderForLens, toLens, type Lens, type LensCandidate } from "@/domain/feed/lens";
import { participantCount } from "@/domain/participants";
import { peekSwr, swrCache } from "@/lib/server-cache";
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
   * WHICH QUESTION THE READER ASKED — see @/domain/feed/lens.
   *
   * "for_you" is the blend and the default, and it leaves every line below this
   * one behaving exactly as it always has. The other four are RANKINGS: they
   * admit only markets they can speak about and order strictly on their own
   * measure, so the sequencer's rhythm and diversity rules are skipped for them.
   * Unrecognised values fall back to For You rather than emptying the feed.
   */
  lens?: string;
  /**
   * The reader's own lens: network groups and topics. OR within a group, AND
   * across groups (see @/domain/feed/filters). Empty means "All", which is the
   * unfiltered feed and the default.
   */
  networks?: string[];
  topics?: string[];
  /** Momentum lenses — see @/domain/feed/momentum. Empty means "any". */
  momentum?: string[];
  /**
   * The reader's floor: how much has to happen before it is worth showing.
   * A row in the one bar table (@/domain/market-change#BARS). Unrecognised
   * values fall back to the default rather than emptying the feed.
   */
  sensitivity?: string;
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
  /** Already narrowed to the reader's floor by the caller. */
  mo: { weight?: number } | null = null,
): FeedMarketSignals {
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
  /** The lens this result was RANKED by — what the playlist should explain. */
  lens: Lens;
  /** The canonical filter selection this result was built for. */
  filters: FeedFilters;
  /**
   * The perspectives this viewer's network can actually seat. Always contains
   * "for_you"; Tribe and Rivals appear only once the evidence exists to fill
   * them, so the picker never offers a tab that would read "nothing here".
   */
  modes: FeedMode[];
  engineVersion: number;
  /**
   * The lens has nothing further to offer — see `SequenceResult.exhausted`.
   *
   * Read together with `lens` above and never on its own: a response is only
   * evidence about the lens it was BUILT for, and the client holds the previous
   * feed on screen while a new one is in flight.
   */
  exhausted: boolean;
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
    momentum: (input.momentum ?? []) as never,
  });
  // A single network chosen IS a perspective, so the Tribe / Rivals rankings
  // still apply; everything else keeps the blend the ranker produced.
  const mode = input.mode ? toFeedMode(input.mode) : toFeedMode(orderingMode(filters));
  // Which question the reader asked. Declared here because it also decides what
  // the card's one sentence leads on, not only the order — see `preferMomentum`.
  const lens: Lens = toLens(input.lens);
  const feed = await listFeed({ data: { window: win, ...(wallet ? { wallet } : {}) } });
  const rows = (feed.data ?? []) as unknown as Row[];
  const ids = rows.map((r) => Number(r.onchain_id));
  /** The read-model row by id — the lens ranks off the same rows the client renders. */
  const byOnchainId = new Map(rows.map((r) => [Number(r.onchain_id), r]));

  const origin =
    typeof input.originMarketId === "number" && Number.isFinite(input.originMarketId)
      ? input.originMarketId
      : null;
  const [signals, analyses, ideaResult, originOverlap] = await Promise.all([
    wallet && ids.length ? loadViewerSignals(wallet, ids) : Promise.resolve(EMPTY_SIGNALS),
    // The vector only when a viewer exists to compare against. An anonymous
    // request — the SSR path that sets first-paint TTFB — has no taste
    // embedding by construction, so `cosine` would return 0 without reading it.
    loadMarketAnalyses(ids, Boolean(wallet)),
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
      momentum: MomentumLens[];
      mine: boolean;
    }
  >();

  /**
   * THE READER'S FLOOR, applied to a classification computed ONCE.
   *
   * `listFeed` classifies momentum in its viewer-independent, SWR-cached block
   * at the most permissive bar. Every reader's view is a subset of that, so this
   * filters rather than recomputing — which is what keeps one cache per window
   * instead of one per window per sensitivity.
   */
  const momentumCache = new Map<number, MomentumFacts>();
  const momentumFor = (r: Row): MomentumFacts => {
    // MEMOISED. Both the candidate map and the lens ranking need this, and
    // narrowing the same classification twice would be two answers waiting to
    // disagree the day one caller passes a different floor.
    const id = Number(r.onchain_id);
    const hit = momentumCache.get(id);
    if (hit) return hit;
    const raw = (r["momentum"] ?? null) as MomentumFacts | null;
    const out = raw ? atSensitivity(raw, input.sensitivity as never, win) : NO_MOMENTUM;
    momentumCache.set(id, out);
    return out;
  };

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
    const mo = momentumFor(r);
    const s = signalsOf(
      r,
      { here: here.size, yes, no, names },
      originOverlap.get(Number(r.onchain_id)) ?? 0,
      mo,
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
      // Which momentum lenses this market belongs in, from the shared,
      // drift-corrected classifier — never re-derived here.
      momentum: mo.lenses,
      // Created it, or holding a side. One relationship to a market, not two —
      // the same rule `stakesIn` applies, and the interface never distinguishes.
      mine:
        signals.held.has(Number(r.onchain_id)) ||
        (!!wallet &&
          String(
            ((r["markets"] ?? null) as { author_wallet?: string | null } | null)?.author_wallet ??
              "",
          ).toLowerCase() === wallet),
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
        momentum: mo,
        window: win,
        // Under the Moving lens the reader asked what is CHANGING, so the move
        // leads even when it is too small to be a headline in a blended feed.
        preferMomentum: lens === "moving",
      }),
      reentry,
      poolSlices: Array.isArray(r["pool_slices"]) ? (r["pool_slices"] as string[]) : [],
      // Spacing input only — see SEQUENCE.MAX_SAME_DIRECTION_RUN.
      moveDirection: mo.top?.direction ?? null,
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

  /**
   * THE LENS RANKS. For You is the blend and keeps every line of the existing
   * behaviour — the mode ordering, then the sequencer's rhythm and diversity.
   * The other four are RANKINGS on one measure, so they order themselves and
   * tell the sequencer to leave that order alone.
   *
   * PARTICIPANTS ARE COUNTED THE WAY THE ROW PRINTS THEM — one definition, in
   * @/domain/participants, shared by the ranking here, the hero copy, the scale
   * line and the search index. NOT `directional_believers`, which the `believed`
   * pool slice uses: that counts who holds a side RIGHT NOW, it is a narrower
   * population than everyone who ever traded, and it has drifted from the side
   * columns — market #101 reads 2 there while holding zero believers on both
   * sides. A lens that ranks on one number and prints another is a label that
   * lies, and it would top "Most Participants" with a row saying it has none.
   */
  const ordered =
    lens === "for_you"
      ? orderForMode(
          mode,
          kept.flatMap((c) => modeOf.get(c.onchainId) ?? []),
        ).flatMap((m) => candidateById.get(m.onchainId) ?? [])
      : orderForLens(
          lens,
          kept.flatMap((c) => {
            const r = byOnchainId.get(c.onchainId);
            if (!r) return [];
            const created = Date.parse(String(r["market_created_at"] ?? ""));
            const mo = momentumFor(r);
            const lc: LensCandidate & { onchainId: number } = {
              onchainId: c.onchainId,
              capitalUsd: Math.max(0, num(r["yes_capital_usd"]) + num(r["no_capital_usd"])),
              participants: participantCount({
                reachParticipants: num(r["participants"]),
                believersYes: num(r["believers_yes"]),
                believersNo: num(r["believers_no"]),
              }),
              createdAtMs: Number.isFinite(created) ? created : null,
              momentumWeight: mo.weight,
              moving: mo.lenses.includes("moving"),
              score: c.scored.score,
            };
            return [lc];
          }),
        ).flatMap((m) => candidateById.get(m.onchainId) ?? []);

  const { items, engineVersion, excluded, exhausted } = sequenceFeed({
    candidates: ordered,
    idea: ideaResult.idea,
    // A ranking is taken as given; a blend is sequenced. See sequence.ts.
    preserveOrder: lens !== "for_you",
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
    lens,
    filters,
    // A viewer whose network shrank below the gate keeps whatever they chose
    // for THIS response — the result says what it is, and the picker decides
    // separately what to offer next.
    modes: (feed as { modes?: FeedMode[] }).modes ?? ["for_you"],
    engineVersion,
    exhausted,
    excluded,
    error: feed.error ?? null,
  };
}

/**
 * THE SSR SNAPSHOT — the only feed read the HTML shell is allowed to make.
 *
 * First principles: the landing page's first byte must not depend on any
 * database work. `buildOpportunityFeed` is a multi-query assembly; on a cold
 * serverless isolate awaiting it made TTFB the entire page budget (measured in
 * production: 10.0s, i.e. the in-flight watchdog firing). So SSR PEEKS. If this
 * isolate already holds a snapshot the shell paints real markets for free; if
 * not, the shell ships instantly with `null` and the browser fetches the feed
 * in the background, exactly like any other panel.
 *
 * Nothing is started here on a miss: background work belonging to a request
 * that has already responded is cancelled by the runtime, and a cancelled build
 * is what wedged the shared cache before.
 */
export const SSR_FEED_KEY = "feed:ssr:anon:24h";

/**
 * THE SEED — the first few cards, kept somewhere a cold isolate can reach.
 *
 * The peek above only pays off on a WARM isolate; a cold one had nothing and
 * shipped a skeleton. The feed build is far too expensive to await there, but a
 * single-row read of a stored snapshot is not — so every successful anonymous
 * build leaves the first few finished cards behind in `feed_snapshot`, and a
 * cold SSR reads that one row. The reader gets a real first market immediately
 * while the browser fetches the full feed in the background.
 *
 * The seed is marked `partial`, which is the whole contract: the client adopts
 * it for paint only and must still fetch. Trimmed to SEED_ITEMS so the row stays
 * small enough that reading it is never a second page budget.
 */
const SEED_KEY = "anon:24h";
const SEED_ITEMS = 3;
/** A seed that cannot be read quickly is not a seed. Bound the SSR read. */
const SEED_READ_MS = 700;

function trimToSeed(feed: OpportunityFeedResult): OpportunityFeedResult {
  const items = feed.items.filter((i) => i.kind === "market").slice(0, SEED_ITEMS);
  const rows: Record<number, FeedRowPayload> = {};
  for (const it of items) {
    const row = feed.rows[(it as { onchainId: number }).onchainId];
    if (row) rows[(it as { onchainId: number }).onchainId] = row;
  }
  return {
    ...feed,
    items: items.map((it, n) => ({ ...it, position: n })),
    rows,
    // Ideas are a session decision, never a cached one.
    idea: null,
    excluded: [],
    partial: true,
  };
}

async function writeSeed(feed: OpportunityFeedResult): Promise<void> {
  try {
    if (!feed.items.some((i) => i.kind === "market")) return;
    const sb = serviceClientOrNull();
    if (!sb) return;
    await sb
      .from("feed_snapshot")
      .upsert(
        { key: SEED_KEY, payload: trimToSeed(feed) as unknown as never, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
  } catch {
    // A cache that fails to write must never fail the feed.
  }
}

async function readSeed(): Promise<OpportunityFeedResult | null> {
  try {
    const sb = serviceClientOrNull();
    if (!sb) return null;
    const read = sb.from("feed_snapshot").select("payload").eq("key", SEED_KEY).maybeSingle();
    const res = await Promise.race([
      read,
      new Promise<null>((r) => setTimeout(() => r(null), SEED_READ_MS)),
    ]);
    const payload = (res as { data?: { payload?: unknown } } | null)?.data?.payload;
    if (!payload || typeof payload !== "object") return null;
    return { ...(payload as OpportunityFeedResult), partial: true };
  } catch {
    return null;
  }
}

/** Warm read first, stored seed second — never a build, never a long await. */
export async function warmAnonFeed(): Promise<OpportunityFeedResult | null> {
  const warm = peekSwr<OpportunityFeedResult>(SSR_FEED_KEY);
  if (warm) return warm;
  return readSeed();
}

/** The shape the SSR shell asks for: anonymous, 24h, no filters, no lens. */
function isAnonDefault(input: OpportunityFeedInput): boolean {
  return (
    !input.wallet &&
    !input.sessionToken &&
    (input.window ?? "24h") === "24h" &&
    !input.lens &&
    !input.mode &&
    !input.originMarketId &&
    !(input.networks?.length || input.topics?.length || input.momentum?.length) &&
    !(input.seenIds?.length || input.queuedIds?.length)
  );
}

/**
 * The client's build, which ALSO fills the SSR slot. That is what makes the
 * peek above pay off: the first browser fetch on a fresh isolate warms the
 * snapshot every later SSR request on that isolate serves for free.
 */
export async function opportunityFeed(
  input: OpportunityFeedInput,
): Promise<OpportunityFeedResult> {
  if (!isAnonDefault(input)) return buildOpportunityFeed(input);
  return swrCache(SSR_FEED_KEY, { ttlMs: 15_000 }, async () => {
    const feed = await buildOpportunityFeed(input);
    // Awaited on purpose: work left running after a response is cancelled by
    // the runtime, and a seed that never lands is a seed that never helps.
    await writeSeed(feed);
    return feed;
  });
}

