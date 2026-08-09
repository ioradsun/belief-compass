/**
 * Live tape — server loader. Reads canonical `events` in reverse-chronological
 * order (occurred_at DESC, block DESC, log DESC — never ingested_at), excludes
 * reorg-orphaned events (is_canonical), groups bursts via the pure live-tape
 * module, then turns each row into a human event via the conviction grammar:
 *   "John joined the YES tribe for $25 — YES is heating up, 12 joined this hour"
 * The actor is named from pov.co (alias fallback); the momentum clause comes from
 * market_state; the relationship tag ("(Twin)") is added when signed in. Multi-
 * wallet bursts read as the crowd.
 *
 * WHAT GETS IN is decided here in two passes: every row is scored, then the bar
 * is set from the distribution of that batch (src/domain/feed-density) so a
 * quiet window says something true instead of nothing at all. WHAT ORDER is
 * decided at the render boundary, because delta-sync re-sorts (see LiveTape).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase-clients";
import { peekSwr, swrCache } from "@/lib/server-cache";

import { aliasFor } from "@/lib/wallet-identity";
import { showedUpInMarket } from "@/domain/dependability";
import {
  flattenStory,
  groupLiveRows,
  type LiveEventInput,
  type LiveFace,
  type LiveRow,
} from "@/lib/live-tape";
import {
  classifyConvictionEvent,
  isCelebration,
  type ConvictionAction,
} from "@/domain/conviction-event";
import { tellPiStory, voiceLevel, applyViewerAngle } from "@/domain/pi-voice";
import { retellTransition, type CopyLevel } from "@/domain/transition-denominator";
import { scoreFeedEvent, type NetTag } from "@/domain/feed-event";
import { adaptiveFloor, admitToFeed } from "@/domain/feed-density";
import {
  scoreLiveAction,
  scoreDiscoveryMoment,
  SIGNIFICANCE,
  isCovered,
  fallbackRate,
} from "@/domain/significance";
import { familyOf, type MixCandidate } from "@/domain/feed-cadence";
import { signalVector } from "@/domain/signal-vector";
import { factsForRow } from "@/domain/signal-facts";
import {
  groupPricePaths,
  priceProofSince,
  type PriceSample,
} from "@/domain/price-proof";
import { editFeed } from "@/domain/feed-editorial";
import { findPersonPatterns } from "@/domain/person-pattern";

import { enrichPeople, orderForViewer, relationshipBoost } from "@/domain/viewer-relationship";
import { discoveryValue, markSeen, type DiscoverySubject } from "@/domain/discovery";
import { stakeBoost, NO_STAKES } from "@/domain/viewer-stake";
import { currentHoldDays, holdStartIsFloor } from "@/domain/tenure";
import { classifyPace } from "@/domain/feed-scheduler";
import { buildStandingFacts } from "@/lib/standing-facts.server";
import { buildPersonMilestones } from "@/lib/person-milestones.server";
import { tellConvictionMilestone } from "@/domain/person-milestone";
import { tellStandingFact } from "@/domain/standing-fact";
import {
  findDiscoveryMoments,
  tellDiscoveryMoment,
  type DiscoveryMoment,
} from "@/domain/discovery-moment";
import { viewerNetwork } from "@/domain/viewer-network";
import { namePerson, knownFirst, type ProfileLike } from "@/domain/feed-people";
import type { CachedRelationship } from "@/lib/dna/viewer-dna-cache.server";
import { weiToEth } from "@/domain/money";
import {
  cohortKindForViewer,
  renderCohort,
  type CohortHolder,
  type CohortKind,
  type ConvictionCohort,
  type HoldingRung,
} from "@/domain/conviction-cohort";
import { fetchMarketNames } from "@/lib/market-titles.server";

type NetLabel = "twin" | "tribe" | "opp" | "inverse";

/** The conviction actions the importance engine understands. */
const BELIEF_ACTIONS = new Set(["enter", "add", "reduce", "exit", "flip", "round_trip"]);

/**
 * Narrow the grammar's action to the subset the scorer weighs. `open_market`,
 * `milestone` and `surge` are not things a PERSON did to a belief, so they carry
 * no tenure meaning and are scored on their own structural terms.
 */
function beliefAction(a: ConvictionAction | undefined) {
  return a && BELIEF_ACTIONS.has(a) ? (a as "enter" | "add" | "reduce" | "exit" | "flip") : null;
}

/**
 * Market-wide story types that are moments rather than reports.
 *
 * The story engine (src/domain/story-event) already names what it noticed and
 * the emitter persists that name in the payload. A side doubling, a crowd
 * crossing a round number, a Tribe forming — these are the community growing,
 * and they belong beside the personal celebrations rather than beside a decline.
 * `losing_conviction` and `material_move` deliberately are not here: a fall and
 * a five-percent move are news, not causes for celebration.
 */
const CELEBRATION_TRANSITIONS = new Set([
  "side_doubled",
  "believer_milestone",
  "capital_milestone",
  "market_reawakened",
  "tribe_forming",
  "participation_broadening",
  "market_dividing",
]);

const LIVE_KINDS = [
  "trade",
  "market_created",
  "position_changed_side",
  "believer_milestone",
  "tribe_doubled",
  "market_transition",
  "conviction_cohort",
];

/** The live feed only reports the last 72 hours. Older events are history. */
const LIVE_WINDOW_MS = 72 * 60 * 60_000;

const input = z
  .object({
    limit: z.number().int().min(1).max(300).optional(),
    wallet: z.string().min(3).optional(),
    /** Scope the tape to specific markets (center deck, position rows). */
    marketIds: z.array(z.number().int()).min(1).max(60).optional(),
    /**
     * Scope to ONE side of a market — the YES/NO rails. A side panel is asking
     * "what is happening to this belief", so market-wide rows (a market opening,
     * a transition about both sides) are deliberately excluded: the column
     * already sits inside that context and repeating it is noise.
     */
    side: z.enum(["YES", "NO"]).optional(),
    /**
     * Delta sync: only events at/after this ISO time. The client passes its
     * newest event minus an OVERLAP that exceeds every grouping window, so the
     * server re-groups the boundary exactly as a full fetch would — the client
     * then merges these fresh head rows onto its cached (immutable) tail. Omit
     * for a full fetch.
     */
    since: z.string().datetime().optional(),
  })
  .optional();

type Momentum = {
  believersYes: number | null;
  believersNo: number | null;
  newBackers1h: number | null;
  moneyYesPct: number | null;
  peopleYesPct: number | null;
  opportunityType: string | null;
  /** Days since the market opened — lets a standing fact claim "since the start". */
  marketAgeDays: number | null;
  // ---- Signal inputs. Carried, not yet read by any story. ----
  /** The level the moves are relative to — the quiet band is a percentage, not cents. */
  yesPrice: number | null;
  /** Price moves. Null means "not computed", never "flat" — the difference matters. */
  yesPriceChange1h: number | null;
  yesPriceChange24h: number | null;
  yesPriceChange7d: number | null;
  /** Capital direction over 24h, per side. */
  yesCapitalDelta24h: number | null;
  noCapitalDelta24h: number | null;
  capitalHeldYes: number | null;
  capitalHeldNo: number | null;
  /** Trade counts at three horizons — the raw material for market-relative "normal". */
  tradeCount1h: number | null;
  tradeCount24h: number | null;
  tradeCount7d: number | null;
  uniqueWallets1h: number | null;
  uniqueWallets24h: number | null;
  newBelievers24h: number | null;
  newBelieversYes24h: number | null;
  newBelieversNo24h: number | null;
  peopleYesChange24h: number | null;
  sideFlips24h: number | null;
  lastTradeAt: string | null;
};


/**
 * How many standing facts one full fetch puts in reserve.
 *
 * Six was a reserve that ran dry inside one quiet stretch: the scheduler draws
 * one every 15–30s of silence, so six is about two minutes of material for a
 * feed that can be quiet for an hour. This is the cheap half of the fetch (one
 * wallet_beliefs read the tape already needs), so the depth is close to free.
 */
const STANDING_RESERVE = 18;

/** How far back an answered call can be and still be news. */
const SHOWED_UP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Rows per fetch. Already one per market, so this is a second, gentler cap. */
const SHOWED_UP_MAX = 4;

/**
 * THE SHARED TAPE IS ONE ANSWER, NOT ONE PER READER.
 *
 * The unscoped, signed-out tape is identical for every visitor, and building it
 * is several reads plus the whole grammar pass. Cached under one key it is
 * built once per window and handed to everyone else — which is what lets SSR
 * peek at it (see `getWarmTape`) and the phone paint "Now" on arrival instead of
 * waiting a round trip for it.
 *
 * A wallet, a market scope, a side or a delta `since` is a DIFFERENT question
 * and never touches this cache.
 */
export const TAPE_KEY = "tape:anon";
const TAPE_TTL_MS = 10_000;

function isSharedTape(data: z.output<typeof input>): boolean {
  return !data?.wallet && !data?.marketIds?.length && !data?.side && !data?.since;
}

export const listLiveEvents = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof input>) => input.parse(d ?? {}))
  .handler(async ({ data }) => {
    if (!isSharedTape(data)) return buildTape(data);
    return swrCache(`${TAPE_KEY}:${data?.limit ?? 120}`, { ttlMs: TAPE_TTL_MS }, () =>
      buildTape(data),
    );
  });

/**
 * The SSR read: this isolate's warm tape, or null. NEVER builds — a shell that
 * waits on the tape is the stall this whole path exists to remove.
 */
export const getWarmTape = createServerFn({ method: "GET" }).handler(async () => {
  return peekSwr<Awaited<ReturnType<typeof buildTape>>>(`${TAPE_KEY}:120`) ?? null;
});

/**
 * THE FACTUAL HALF OF THE TAPE — everything true regardless of who is reading.
 *
 * The first seam in a path that had none. `buildTape` interleaved global reads,
 * the viewer's reads and composition across ~1100 lines, which is why a signed-in
 * reader could not share a build with anyone else: there was no boundary to cache
 * on. This is that boundary's factual side, and nothing here may ever depend on
 * `data.wallet`.
 *
 * DELIBERATELY PARTIAL. Three of the eight reads live here — events, market
 * names + market_state, and the eth/usd snapshot. Two more (signal-market holders
 * and actor beliefs) are provably global and belong here next; they are left in
 * place so this change stays a mechanical move. Profile resolution can NEVER move
 * here: its wallet set includes the viewer's discovery moments, so it straddles
 * the boundary and is the reason this is a source loader rather than the whole
 * global half.
 *
 * Returns plain data only — arrays, Maps and numbers, no row objects — so nothing
 * a later viewer-relative pass mutates can reach anything cached from here.
 */
interface TapeSource {
  /**
   * Raw event rows, newest first. Untyped by PostgREST and cast field-by-field
   * where they are read, exactly as before this extraction. Never mutated
   * downstream — grouping builds new objects — so these are safe to share.
   */
  rows: Record<string, unknown>[];
  marketIds: number[];
  titleById: Map<number, string>;
  /** Who asked each question — the strongest stake a reader can have in one. */
  creatorByMarket: Map<number, string>;
  momentumById: Map<number, Momentum>;
  /** 0 means "no rate", never "free" — callers must not price rows with it. */
  ethUsd: number;
  error: string | null;
}

const EMPTY_SOURCE: TapeSource = {
  rows: [],
  marketIds: [],
  titleById: new Map(),
  creatorByMarket: new Map(),
  momentumById: new Map(),
  ethUsd: 0,
  error: null,
};

async function loadTapeSource(
  sb: ReturnType<typeof serviceClient>,
  data: z.output<typeof input>,
): Promise<TapeSource> {
  const limit = data?.limit ?? 120;
  const scope = data?.marketIds?.map((n) => String(n)) ?? null;

  let q = sb
    .from("events")
    // NOTE: the full `payload` (raw_log) is deliberately NOT selected — the raw
    // log is pure over-the-wire weight for limit*3 rows. We select only the one
    // JSON sub-field a milestone row needs (its threshold), which is tiny.
    .select(
      // `transition_significance` and `transition_type` are not decoration.
      // The emitter computes a universal significance at emission and stores
      // it "so the mixer compares this against every other family on the one
      // shared scale" — and until they were selected here, the reader never
      // saw them, so every market signal fell through to the derived score or
      // the 0.5 fallback. The number existed on disk and was thrown away on
      // the way to the only place it mattered.
      // A conviction cohort stores its PEOPLE (not prose) in the payload, so
      // the sentence can be written per surface. Those sub-fields must be
      // selected too — without them the row reached the renderer with no
      // kind, no rung and no people, and read "undefined — 0 believers
      // reached NaN months."
      "source_key, kind, market_id, side, action, amount_eth, wallet, occurred_at, block_number, log_index, milestone_threshold:payload->>threshold, transition_headline:payload->>headline, transition_detail:payload->>detail, transition_type:payload->>type, transition_significance:payload->>significance, cohort_kind:payload->>kind, cohort_rung:payload->>rung, cohort_crossed_on:payload->>crossedOn, cohort_people:payload->people",
    )
    .eq("is_canonical", true)
    .in("kind", LIVE_KINDS);
  if (scope) q = q.in("market_id", scope);
  if (data?.side) q = q.eq("side", data.side);
  // The live feed is a 72-hour window: anything older is history, not "live".
  q = q.gte("occurred_at", new Date(Date.now() - LIVE_WINDOW_MS).toISOString());
  // Delta: bound by the overlap window instead of over-reading the full list.
  // The window is small, so this fetches only what changed since last poll.
  if (data?.since) q = q.gte("occurred_at", data.since);
  const { data: rows, error } = await q
    .order("occurred_at", { ascending: false })
    .order("block_number", { ascending: false, nullsFirst: false })
    .order("log_index", { ascending: false, nullsFirst: false })
    .limit(limit * 3); // over-read so grouping still yields ~limit rows
  if (error) return { ...EMPTY_SOURCE, error: error.message };

  const marketIds = [...new Set((rows ?? []).map((r) => Number(r.market_id)))];
  const titleById = new Map<number, string>();
  /** Who asked each question — the strongest stake a reader can have in one. */
  const creatorByMarket = new Map<number, string>();
  const momentumById = new Map<number, Momentum>();
  if (marketIds.length > 0) {
    const [mk, ms] = await Promise.all([
      // ONE lookup for what a market is called (and who asked it), shared with
      // every other surface. It used to select `creator_wallet`, which does
      // not exist on `markets` — PostgREST failed the whole request and every
      // row in the tape silently degraded to "Market #<id>". The author column
      // is `author_wallet`; the shared helper is the only place that knows.
      fetchMarketNames(sb, marketIds),
      sb
        .from("market_state")
        .select(
          "onchain_id, believers_yes, believers_no, new_believers_1h, money_yes_pct, people_yes_pct, opportunity_type, market_age_days, yes_price_usd, yes_price_change_1h, yes_price_change_24h, yes_price_change_7d, yes_capital_delta_24h, no_capital_delta_24h, capital_held_yes, capital_held_no, trade_count_1h, trade_count_24h, trade_count_7d, unique_wallets_1h, unique_wallets_24h, new_believers_24h, new_believers_yes_24h, new_believers_no_24h, people_yes_change_24h, side_flips_24h, last_trade_at",
        )
        .in("onchain_id", marketIds),
    ]);
    for (const [id, m] of mk) {
      // ONLY A REAL TITLE GOES IN — the helper already nulls blanks, because a
      // present-but-empty string survives every layer of null-coalescing and
      // renders as nothing at all.
      if (m.title) titleById.set(id, m.title);
      if (m.authorWallet) creatorByMarket.set(id, m.authorWallet);
    }
    for (const s of ms.data ?? []) {
      const r = s as Record<string, unknown>;
      const num = (k: string) => (r[k] as number | null) ?? null;
      momentumById.set(Number(r.onchain_id), {
        believersYes: num("believers_yes"),
        believersNo: num("believers_no"),
        newBackers1h: num("new_believers_1h"),
        moneyYesPct: num("money_yes_pct"),
        peopleYesPct: num("people_yes_pct"),
        opportunityType: (r.opportunity_type as string | null) ?? null,
        marketAgeDays: num("market_age_days"),
        yesPrice: num("yes_price_usd"),
        yesPriceChange1h: num("yes_price_change_1h"),
        yesPriceChange24h: num("yes_price_change_24h"),
        yesPriceChange7d: num("yes_price_change_7d"),
        yesCapitalDelta24h: num("yes_capital_delta_24h"),
        noCapitalDelta24h: num("no_capital_delta_24h"),
        capitalHeldYes: num("capital_held_yes"),
        capitalHeldNo: num("capital_held_no"),
        tradeCount1h: num("trade_count_1h"),
        tradeCount24h: num("trade_count_24h"),
        tradeCount7d: num("trade_count_7d"),
        uniqueWallets1h: num("unique_wallets_1h"),
        uniqueWallets24h: num("unique_wallets_24h"),
        newBelievers24h: num("new_believers_24h"),
        newBelieversYes24h: num("new_believers_yes_24h"),
        newBelieversNo24h: num("new_believers_no_24h"),
        peopleYesChange24h: num("people_yes_change_24h"),
        sideFlips24h: num("side_flips_24h"),
        lastTradeAt: (r.last_trade_at as string | null) ?? null,
      });
    }

  }

  // ETH/USD comes from the cron-refreshed snapshot (calc_cache), NOT the live
  // eth_usd_calibration() aggregate — that RPC scans the entire events trade
  // history joined to market_state on every load. Same value listFeed reads.
  const { data: cal } = await sb
    .from("calc_cache")
    .select("value")
    .eq("key", "eth_usd")
    .maybeSingle();
  // A zero rate is NOT a price: it is the absence of one, and pretending
  // otherwise prices every trade at $0 and empties the tape (see live-tape).
  //
  // TWO WAYS THIS GOES WRONG, and they need different fixes — which is why the
  // warning distinguishes them. `cal == null` means the row is INVISIBLE to
  // this client, not absent: calc_cache shipped with RLS on and no anon
  // policy, so the public read returned 200 with zero rows for months while
  // the stored value was perfectly fine. A present-but-null value is the other
  // case: the calibration itself returns NULL when no market has volume.
  /**
   * A MISSED TITLE IS A BUG, NOT A DEFAULT.
   *
   * `events.market_id` is text and `markets.onchain_id` is numeric, so every
   * lookup here crosses a type boundary via Number(). A row whose market_id is
   * not numeric — or a market the join simply did not return — misses the map
   * and renders as "Market #123", which looks like a deliberate placeholder
   * and is indistinguishable from a market that genuinely has no title. It is
   * neither. Say so once per request rather than shipping the id as a name.
   */
  const missing = marketIds.filter((id) => !titleById.has(id));
  if (missing.length > 0)
    console.warn(
      `[feed] ${missing.length}/${marketIds.length} market titles did not resolve ` +
        `(ids ${missing.slice(0, 5).join(",")}${missing.length > 5 ? "…" : ""}). ` +
        `Rows for these render as "Market #<id>". Check that events.market_id ` +
        `values are numeric onchain ids and that markets rows exist for them.`,
    );

  const ethUsd = Number((cal as { value?: number } | null)?.value ?? 0) || 0;
  if (!(ethUsd > 0))
    console.warn(
      cal == null
        ? "[feed] calc_cache.eth_usd is UNREADABLE by this client (RLS/grant), so every trade is reported WITHOUT an amount. Refreshing the value will not help — check SELECT access for anon."
        : "[feed] calc_cache.eth_usd is null or zero, so every trade is reported WITHOUT an amount. Check refresh_eth_usd_calibration() and market_state.volume_total_usd.",
    );

  return {
    rows: rows ?? [],
    marketIds,
    titleById,
    creatorByMarket,
    momentumById,
    ethUsd,
    error: null,
  };
}

/** Tenure facts per (wallet, market), as the grammar and the scorers read them. */
type BeliefByKey = Map<
  string,
  {
    daysHeld: number | null;
    tenureIsFloor: boolean;
    enteredBefore: boolean;
    yesShares: number;
    noShares: number;
  }
>;

/**
 * GLOBAL READ — the largest current holders of markets whose rows have no actor.
 *
 * Viewer-independent: `signalMarkets` comes from grouping, which never sees a
 * wallet. Returns a plain Map, so nothing that later decorates rows for one
 * reader can reach it.
 */
async function loadBelieverFaces(
  sb: ReturnType<typeof serviceClient>,
  signalMarkets: number[],
): Promise<Map<number, string[]>> {
  const believersByMarket = new Map<number, string[]>();
  if (signalMarkets.length > 0) {
    const { serviceClientOrNull } = await import("@/lib/supabase-clients");
    const svc = serviceClientOrNull();
    const { data: holders } = svc
      ? await svc
          .from("wallet_beliefs")
          .select("wallet, onchain_id, yes_shares, no_shares")
          .in("onchain_id", signalMarkets)
          .limit(600)
      : { data: null };
    const byMarket = new Map<number, Array<{ wallet: string; size: number }>>();
    for (const h of (holders ?? []) as Array<Record<string, unknown>>) {
      const size = Number(h.yes_shares ?? 0) + Number(h.no_shares ?? 0);
      if (!(size > 0)) continue;
      const id = Number(h.onchain_id);
      const list = byMarket.get(id) ?? [];
      list.push({ wallet: String(h.wallet).toLowerCase(), size });
      byMarket.set(id, list);
    }
    for (const [id, list] of byMarket) {
      believersByMarket.set(
        id,
        list
          .sort((a, b) => b.size - a.size)
          .slice(0, 6)
          .map((x) => x.wallet),
      );
    }
  }
  return believersByMarket;
}

/**
 * GLOBAL READ — how long each actor on screen has believed what they believe.
 *
 * Viewer-independent: keyed on the wallets the rows are ABOUT, never on the
 * wallet reading them. Returns a plain Map, for the same reason as above.
 */
async function loadActorBeliefs(
  sb: ReturnType<typeof serviceClient>,
  actorWallets: string[],
  marketIds: number[],
): Promise<BeliefByKey> {
  const beliefByKey = new Map<
    string,
    {
      daysHeld: number | null;
      tenureIsFloor: boolean;
      enteredBefore: boolean;
      yesShares: number;
      noShares: number;
    }
  >();
  if (actorWallets.length > 0 && marketIds.length > 0) {
    const { serviceClientOrNull } = await import("@/lib/supabase-clients");
    const svc = serviceClientOrNull();
    if (!svc)
      console.warn(
        "[feed] no service key — rows lose their tenure, so no story can say how long anyone believed it.",
      );
    const { data: beliefs, error: beliefErr } = svc
      ? await svc
          .from("wallet_beliefs")
          .select("wallet, onchain_id, yes_shares, no_shares, directional_since")
          .in("wallet", actorWallets)
          .in("onchain_id", marketIds)
          .limit(500)
      : { data: null, error: null };
    if (beliefErr)
      console.warn(
        `[feed] wallet_beliefs unreadable (${beliefErr.message}) — rows lose their tenure, so no story can say how long anyone believed it.`,
      );
    const now = Date.now();
    for (const b of (beliefs ?? []) as Array<Record<string, unknown>>) {
      // CURRENT conviction, not first-ever participation. This read
      // `first_backed_at`, which never resets — so somebody who bought a year
      // ago, left, and returned yesterday had every sentence about them claim a
      // year. See src/domain/tenure.
      const startedAt = b.directional_since ? Date.parse(String(b.directional_since)) : NaN;
      const days = currentHoldDays(b.directional_since as string | null, now);
      beliefByKey.set(`${String(b.wallet).toLowerCase()}:${Number(b.onchain_id)}`, {
        // Sub-day tenure is not a story; don't dress one up as "a day".
        daysHeld: days != null && days >= 1 ? days : null,
        // A belief that was already there when the index opened has no
        // knowable start. The sentence says "43+ days", not "43 days".
        tenureIsFloor: holdStartIsFloor(startedAt),
        // They were in this market before today's move.
        enteredBefore: Number.isFinite(startedAt) && now - startedAt > 86_400_000,
        yesShares: Number(b.yes_shares ?? 0),
        noShares: Number(b.no_shares ?? 0),
      });
    }
  }
  return beliefByKey;
}

/** The four relationship buckets the DNA engine caches per viewer. */
interface ViewerDnaRow {
  twin_matches: unknown;
  tribe_matches: unknown;
  opp_matches: unknown;
  inverse_matches: unknown;
}

/**
 * VIEWER READ — the reader's own relationship graph, as the DNA engine cached it.
 *
 * The last two reads in this file that depend on WHO IS ASKING. Naming them is
 * the point: with the five global loaders above, every query in the tape is now
 * declared as global or viewer-specific at its definition, so the eventual cache
 * key can be checked by reading signatures instead of tracing 1100 lines.
 *
 * Returns the raw cached row. Turning it into labels, relationships and
 * discovery moments is pure and stays at the call site — this moves the IO, not
 * the meaning.
 */
async function loadViewerDna(viewer: string): Promise<ViewerDnaRow | null> {
  const { serviceClient } = await import("@/lib/supabase-clients");
  const { data } = await serviceClient()
    .from("viewer_dna_cache")
    .select("twin_matches, tribe_matches, opp_matches, inverse_matches")
    .eq("viewer_wallet", viewer)
    .maybeSingle();
  return (data as ViewerDnaRow | null) ?? null;
}

/**
 * VIEWER READ — which of these markets the reader actually has money in.
 *
 * A closed position is not a stake: holding nothing here is the same as never
 * having been here, for the purpose of what to show someone. Failure is
 * swallowed deliberately — no key means the feed is impersonal, never absent.
 */
async function loadViewerHoldings(viewer: string, marketIds: number[]): Promise<Set<number>> {
  const holding = new Set<number>();
  try {
    const { serviceClientOrNull } = await import("@/lib/supabase-clients");
    const svc = serviceClientOrNull();
    if (svc) {
      const { data: mine } = await svc
        .from("wallet_beliefs")
        .select("onchain_id, yes_shares, no_shares")
        .eq("wallet", viewer)
        .in("onchain_id", marketIds);
      for (const b of (mine ?? []) as Record<string, unknown>[]) {
        if (Number(b.yes_shares ?? 0) > 0 || Number(b.no_shares ?? 0) > 0)
          holding.add(Number(b.onchain_id));
      }
    }
  } catch {
    // No key, no stake. The feed is impersonal rather than absent.
  }
  return holding;
}

/**
 * EVERY WAY THE TAPE TOUCHES THE WORLD, in one injectable record.
 *
 * buildTape had no test coverage for one reason: it reached for a Supabase
 * client and seven queries inline, so there was no way to run it twice with two
 * readers and compare. That is also why the remaining work — removing row
 * mutation so composition can be pure — has been too dangerous to attempt: it is
 * an all-or-nothing change across four passes with nothing to catch a slip.
 *
 * Naming the five loaders made this cheap. Each is already classified global or
 * viewer-specific by its signature; collecting them here lets a test supply
 * fixtures instead of a database, which is what finally makes the multi-viewer
 * guarantees assertable against the REAL composition path rather than against
 * the pure pieces alone.
 *
 * Production passes nothing and gets the real ones. The default is the only
 * behaviour that ships.
 */
export interface TapeDeps {
  client: () => ReturnType<typeof serviceClient>;
  loadTapeSource: typeof loadTapeSource;
  loadBelieverFaces: typeof loadBelieverFaces;
  loadActorBeliefs: typeof loadActorBeliefs;
  loadViewerDna: typeof loadViewerDna;
  loadViewerHoldings: typeof loadViewerHoldings;
  resolveProfiles: (wallets: string[], budget: number) => Promise<Map<string, ProfileLike>>;
}

const REAL_DEPS: TapeDeps = {
  client: () => serviceClient(),
  loadTapeSource,
  loadBelieverFaces,
  loadActorBeliefs,
  loadViewerDna,
  loadViewerHoldings,
  resolveProfiles: (wallets, budget) =>
    import("@/lib/profiles.server").then((m) => m.resolveProfiles(wallets, budget)),
};

/**
 * Hourly price observations for the candidate markets, 72h back.
 *
 * Bounded by construction: one row per market per hour (see `market_price_path`).
 * A failure here is not a feed failure — the tape simply loses the ability to say
 * "since then", which is exactly the behaviour before temporal proof existed.
 */
async function loadPricePaths(
  sb: ReturnType<typeof serviceClient>,
  marketIds: number[],
): Promise<Map<number, PriceSample[]>> {
  if (marketIds.length === 0) return new Map();
  // Test doubles and any client without this RPC simply yield no proof, which is
  // the same state as an empty history: the feed keeps working and stays silent
  // about ordering.
  if (typeof (sb as { rpc?: unknown }).rpc !== "function") return new Map();
  try {
    const { data, error } = await sb.rpc("market_price_path", {
      p_ids: marketIds,
      p_hours: 72,
    });
    if (error || !Array.isArray(data)) return new Map();
    return groupPricePaths(data as Parameters<typeof groupPricePaths>[0]);
  } catch {
    return new Map();
  }
}

export async function buildTape(data: z.output<typeof input>, deps: TapeDeps = REAL_DEPS) {
  const sb = deps.client();
  const limit = data?.limit ?? 120;
  const viewer = data?.wallet?.toLowerCase() ?? null;

  const scope = data?.marketIds?.map((n) => String(n)) ?? null;
  // Scoped to specific markets == rendered inside a market panel, which already
  // shows the question and the side. Unscoped == the app-wide tape, which does not.
  const scoped = scope != null;
  const source = await deps.loadTapeSource(sb, data);
  if (source.error)
    return { rows: [] as LiveRow[], standing: [] as LiveRow[], error: source.error };
  const { rows, marketIds, titleById, creatorByMarket, momentumById, ethUsd } = source;

  const events: LiveEventInput[] = (rows ?? []).map((r) => ({
    source_key: r.source_key as string,
    kind: r.kind as string,
    market_id: String(r.market_id),
    market_title: titleById.get(Number(r.market_id)) ?? null,

    occurred_at: r.occurred_at as string,
    block_number: r.block_number as number | null,
    log_index: r.log_index as number | null,
    side: (r.side as "YES" | "NO" | null) ?? null,
    action: (r.action as "BUY" | "SELL" | null) ?? null,
    amount_eth: weiToEth(r.amount_eth as string | null),
    wallet: (r.wallet as string) ?? null,
    // System milestones carry their threshold in payload so the copy can render
    // it; trades keep payload null (their raw_log was never fetched).
    payload:
      r.kind === "believer_milestone"
        ? { threshold: Number((r as Record<string, unknown>).milestone_threshold ?? 0) }
        : r.kind === "conviction_cohort"
          ? {
              kind: ((r as Record<string, unknown>).cohort_kind as string) ?? null,
              side: (r.side as string | null) ?? null,
              rung: (() => {
                const v = Number((r as Record<string, unknown>).cohort_rung);
                return Number.isFinite(v) ? v : null;
              })(),
              crossedOn:
                ((r as Record<string, unknown>).cohort_crossed_on as string | null) ?? null,
              people: Array.isArray((r as Record<string, unknown>).cohort_people)
                ? ((r as Record<string, unknown>).cohort_people as unknown[])
                : [],
              significance: (() => {
                const v = Number((r as Record<string, unknown>).transition_significance);
                return Number.isFinite(v) ? v : undefined;
              })(),
            }
          : r.kind === "market_transition"
            ? {
                headline: ((r as Record<string, unknown>).transition_headline as string) ?? "",
                detail: ((r as Record<string, unknown>).transition_detail as string | null) ?? null,
                type: ((r as Record<string, unknown>).transition_type as string | null) ?? null,
                // Stored as text by `payload->>`; a malformed value stays absent
                // so the mixer falls back rather than ranking on a NaN.
                significance: (() => {
                  const v = Number((r as Record<string, unknown>).transition_significance);
                  return Number.isFinite(v) ? v : undefined;
                })(),
              }
            : null,
  }));

  const live = groupLiveRows(events, ethUsd).slice(0, limit);

  // Turn each row into a story. Single-actor rows get named (pov.co, alias
  // fallback) + a relationship tag when the actor is in the viewer's network;
  // bursts read as the crowd. The momentum clause comes from market_state.
  // Resolve identity for every single-actor row AND the creator of a fresh
  // market, so attribution can name them ("Bob joined." / "@dana opened this").
  const actorWallets = [
    ...new Set(live.map((r) => r.wallet?.toLowerCase()).filter((w): w is string => !!w)),
  ];

  /**
   * THE CROWD HAS FACES TOO. A burst row carries the wallets behind it (see
   * live-tape) with what each committed, so "6 people backed YES" can be six
   * clickable people instead of a number.
   */
  type BurstStake = { wallet: string; usd: number | null };
  const burstStakes = new Map<string, BurstStake[]>();
  for (const r of live) {
    const raw = (r.payload as { wallets?: BurstStake[] }).wallets;
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const list = raw
      .filter((s) => s && typeof s.wallet === "string")
      .map((s) => ({ wallet: s.wallet.toLowerCase(), usd: s.usd ?? null }));
    if (list.length > 0) burstStakes.set(r.id, list);
  }

  /**
   * A MARKET SIGNAL HAS PEOPLE TOO. "Believers in YES doubled" is a statement
   * about a crowd, but the crowd was invisible: these rows carry no wallet and
   * no burst payload, so they were the only rows in the feed with nothing to
   * tap. The believers ARE the story, so we borrow the market's largest
   * current holders (a few faces, not a directory) and let the reader in.
   */
  const signalMarkets = [
    ...new Set(
      live
        .filter((r) => !r.wallet && !burstStakes.has(r.id) && Number.isFinite(Number(r.marketId)))
        .map((r) => Number(r.marketId)),
    ),
  ];
  /** marketId → believer wallets, biggest position first. */
  const believersByMarket = await deps.loadBelieverFaces(sb, signalMarkets);

  const labelByWallet = new Map<string, NetLabel>();
  /**
   * The viewer's relationships in full, not just their names. Discovery asks
   * how much EVIDENCE stands behind a label and how recently it was formed —
   * a 100% match on three shared markets is a coincidence, not a Twin — so the
   * feed reads the same rows the People page does instead of a thin label map.
   */
  const relByWallet = new Map<string, CachedRelationship>();
  /**
   * Read-time, viewer-relative score bump per row. Never persisted.
   *
   * This existed and was populated for ONE row kind (conviction cohorts), so
   * a market transition in the question you created, a celebration in the
   * market you are holding, and an anonymous trade in a market you have never
   * seen were ranked identically. See src/domain/viewer-stake.
   */
  const viewerBoost = new Map<string, number>();
  let moments: DiscoveryMoment[] = [];
  if (viewer) {
    const net = viewerNetwork(await deps.loadViewerDna(viewer), scoped);
    for (const [w, l] of net.labelByWallet) labelByWallet.set(w, l);
    for (const [w, r] of net.relByWallet) relByWallet.set(w, r);
    moments = net.moments;
  }

  const profileWallets = [
    ...new Set([
      ...actorWallets,
      ...moments.flatMap((m) => m.people.map((p) => p.wallet)),
      ...[...burstStakes.values()].flatMap((l) => l.map((s) => s.wallet)),
      ...[...believersByMarket.values()].flat(),
    ]),
  ];

  const profiles =
    profileWallets.length > 0 ? await deps.resolveProfiles(profileWallets, 15) : new Map();

  /**
   * WHAT MAKES A MOVE MEAN SOMETHING. A sale is just a sale until you know the
   * person had believed it for 43 days, or that nothing of theirs is left. One
   * batched read over the (wallet, market) pairs already on screen turns the
   * feed from transactions into stories. Rows we can't resolve simply lose the
   * extra clause — the grammar degrades to the plain sentence, never invents.
   *
   * READ WITH THE SERVICE CLIENT, deliberately. This used the public client and
   * `wallet_beliefs` returns 401 to anon — so the map was ALWAYS empty and the
   * whole feature was silently dead: no tenure in any sentence, every sell an
   * "exit" and never a "reduce", every buy an "enter" and never an "add", and
   * the tenure terms in scoring and discovery permanently at zero. The
   * degradation was so graceful that it looked like a design choice.
   *
   * The fix is NOT to open the table to anon. `wallet_beliefs` is every
   * wallet's position book; the app publishes what it means (a sentence), not
   * a bulk-queryable table of who holds what. Every other server path already
   * reads it with the service role — this now matches them.
   */
  const beliefByKey = await deps.loadActorBeliefs(sb, actorWallets, marketIds);

  /** Cohort members with their tenure kept — the face stack only needs names. */
  const cohortPeople = new Map<string, CohortHolder[]>();
  /**
   * What each row did to a BELIEF, as the grammar below already worked it out.
   * Recorded rather than re-derived, so the sentence a reader sees and the
   * score that let it through can never disagree about what happened.
   */
  const actionById = new Map<string, ConvictionAction>();
  /** Which rows the grammar classified as a moment rather than a transaction. */
  const celebrationById = new Map<string, boolean>();
  /**
   * Cohort rows we cannot describe honestly (no kind, no rung, or nobody in
   * them). Better silence than "undefined — 0 believers reached NaN months".
   */
  const unrenderable = new Set<string>();
  /**
   * THE CEILING A ROW'S OWN COPY PUTS ON ITS VOLUME.
   *
   * A "−100% over 24H" on $1.80, or a bare "first believers just stepped in",
   * is factually fine and editorially a receipt (see transition-denominator).
   * The signal vector cannot see this — it reads market state, not the sentence
   * we ended up printing — so the copy pass records the ceiling here and the
   * mixer applies it.
   */
  const copyLevel = new Map<string, CopyLevel>();

  for (const r of live) {
    const w = r.wallet?.toLowerCase();
    // Name the actor / creator when we have one; tag the network relationship.
    if (w) {
      const { name, avatarUrl, relationship } = namePerson(w, profiles, labelByWallet, aliasFor);
      r.face = { name, avatarUrl, relationship } satisfies LiveFace;
    }

    // The crowd behind a burst, named. Ordered by what they committed (the
    // grouping already did that), with the viewer's own people pulled to the
    // front so a familiar face is the first one they see.
    //
    // ONE PERSON, ONE FACE. When the row already has an actor (`r.face`), that
    // wallet is dropped from the stack — the row was showing the same person
    // twice, once as the subject of the sentence and again as "the crowd".
    const stakes = burstStakes.get(r.id);
    if (stakes && !r.people) {
      const seen = new Set<string>(w ? [w] : []);
      const named = stakes
        .filter((s) => !seen.has(s.wallet) && (seen.add(s.wallet), true))
        .map((s) => namePerson(s.wallet, profiles, labelByWallet, aliasFor));
      if (named.length > 0) r.people = knownFirst(named);
    } else if (!r.face && !r.people) {
      // A market signal: no actor, no burst — the believers it is about.
      const believers = believersByMarket.get(Number(r.marketId)) ?? [];
      if (believers.length > 0) {
        r.people = knownFirst(
          believers.map((wallet) => namePerson(wallet, profiles, labelByWallet, aliasFor)),
        );
      }
    }

    // A CONVICTION COHORT — the people still holding. The event stored PEOPLE,
    // not prose, precisely so the sentence can be written for where it is
    // being read: this request knows whether it is the app-wide tape or one
    // market's panel (`marketIds` is set only by the panel), so it strips the
    // market title and the side exactly when the surrounding UI supplies them.
    if (r.kind === "conviction_cohort") {
      const p = r.payload as unknown as {
        kind: CohortKind;
        side: "YES" | "NO";
        rung: HoldingRung;
        significance: number;
        crossedOn?: string;
        people: CohortHolder[];
      };
      // A cohort sentence is only true if we know WHO, WHICH SIDE and HOW
      // LONG. Missing any of the three, the row is dropped, never guessed.
      if (
        !p?.kind ||
        !p?.side ||
        !Number.isFinite(Number(p?.rung)) ||
        !Array.isArray(p?.people) ||
        p.people.length === 0
      ) {
        unrenderable.add(r.id);
        continue;
      }
      const cohort: ConvictionCohort = {
        kind: p.kind,
        side: p.side,
        rung: p.rung,
        people: p.people ?? [],
        fingerprint: `cohort:${p.side}:${p.kind}:${p.rung}:${p.crossedOn ?? ""}`,
        crossedOn: p.crossedOn ?? "",
        significance: p.significance ?? 0,
      };
      // VIEWER LENS, applied here and nowhere else. The stored event is
      // universal; this labels the people against THIS reader's DNA cache and
      // leads the stack with the ones they know. Identity is untouched — same
      // row, same fingerprint, same members, same overflow count.
      const mine = enrichPeople(cohort.people, labelByWallet);
      cohort.people = orderForViewer(mine);
      cohortPeople.set(r.id, cohort.people);
      // "YOUR PEOPLE ARE HERE" is a claim about the READER, so it is decided
      // here rather than stored. The emitter has no viewer and could never
      // reach this kind — which is why the headline was unreachable until now.
      cohort.kind = cohortKindForViewer(cohort);
      const surface = scoped ? "panel" : "app";
      const story = renderCohort(cohort, surface, r.marketTitle);
      r.story = {
        category: cohort.kind === "tribe_holding" ? "tribe" : "growing",
        headline: story.headline,
        body: story.body,
        attribution: null,
        tone: p.side === "YES" ? "yes" : "no",
        personal: cohort.kind === "tribe_holding",
      };
      r.people = cohort.people;
      r.text = flattenStory(r.story);
      // Bounded, and only ever a nudge — see viewer-relationship.
      viewerBoost.set(r.id, relationshipBoost(cohort.people));
      continue;
    }

    // Market-wide transitions carry their own composed copy in the payload
    // (the emitter already ran the interpretation + dedup) — render it directly.
    if (r.kind === "market_transition") {
      const p = r.payload as { headline?: string; detail?: string | null; type?: string | null };
      /**
       * THE EVENT OWNS ITS OWN ROW.
       *
       * "MAJOR MOVE / Money is leaving YES" spends the loudest line in the row
       * on a category name and demotes the only interesting phrase to the
       * subtitle. Both wrappers were generic by construction — every signal got
       * one of two labels — which is exactly what makes a feed read as
       * machine-generated. The composed headline IS the kicker now; the detail
       * (the number and the window) is the sentence under it.
       */
      /* STORED COPY IS FROZEN AT EMIT TIME, so rows written before the PI voice
         still speak the old product's language forever. modernizeTransitionCopy
         recognises those labels at read time and re-says them in the current
         voice, using only the numbers the stored detail already printed. */
      /* AND THE PERCENTAGE GETS ITS DENOMINATOR BACK. The emitter froze
         "−100% over 24H" without knowing whether that was $2,000 or $1.80; the
         side's 24h capital movement is the money the percentage was computed
         over, and it lives in market state, here. */
      const mkt = momentumById.get(Number(r.marketId));
      const delta = r.side === "NO" ? mkt?.noCapitalDelta24h : mkt?.yesCapitalDelta24h;
      const modern = retellTransition(p.headline ?? "", p.detail ?? "", String(r.id), {
        usd: typeof delta === "number" && Number.isFinite(delta) ? Math.abs(delta) : null,
        side: r.side ?? null,
      });
      copyLevel.set(r.id, modern.level);
      const kicker = modern.headline.trim();
      r.story = {
        category: "momentum",
        headline: kicker ? kicker.toUpperCase() : "MARKET SIGNAL",
        body: modern.detail,
        attribution: null,
        tone: r.side === "YES" ? "yes" : r.side === "NO" ? "no" : "neutral",
        personal: false,
      };

      r.text = flattenStory(r.story);
      continue;
    }


    // Milestone / surge rows are already final from grouping (no actor to name).
    if (r.kind === "believer_milestone" || r.kind === "tribe_doubled") continue;

    const market = momentumById.get(Number(r.marketId)) ?? null;
    const buySell = (r.payload as { action?: "BUY" | "SELL" }).action ?? null;
    const actor = r.face ? { name: r.face.name, relationship: r.face.relationship } : null;
    const belief = w ? beliefByKey.get(`${w}:${Number(r.marketId)}`) : undefined;

    // WHAT THEY DID TO THEIR BELIEF, not which way the tokens went. A buy on
    // top of an existing position is an ADD (doubling down); a sell that
    // leaves nothing is an EXIT, one that leaves something is a REDUCE. The
    // read model is the state AFTER the trade, so shares==0 means they're out.
    const heldSide = r.side === "YES" ? belief?.yesShares : belief?.noShares;
    const action: ConvictionAction =
      r.kind === "market_created"
        ? "open_market"
        : r.kind === "believer_milestone"
          ? "milestone"
          : r.kind === "tribe_doubled"
            ? "surge"
            : r.kind === "side_shift"
              ? "flip"
              : r.kind === "round_trip"
                ? "round_trip"
                : buySell === "SELL"
                  ? heldSide != null && heldSide > 0
                    ? "reduce"
                    : "exit"
                  : belief?.enteredBefore
                    ? "add"
                    : "enter";

    actionById.set(r.id, action);

    const sideBelievers =
      r.side === "YES" ? market?.believersYes : r.side === "NO" ? market?.believersNo : null;

    // ONE CLASSIFICATION, USED TWICE. The grammar already decides whether this
    // is a moment or a transaction; the mixer needed to know and was never
    // told, so every celebration competed as an ordinary buy. See
    // `familyOf` (src/domain/feed-cadence) for what that cost.
    const convictionEvent = {
      action,
      side: r.side,
      actor,
      context: {
        amountUsd: r.amountUsd,
        // Only claim a tenure when this row has ONE actor we actually looked up.
        daysHeld: belief?.daysHeld ?? null,
        tenureIsFloor: belief?.tenureIsFloor ?? null,
        heldBefore: belief?.enteredBefore ?? null,
        sideBelieversAfter: sideBelievers ?? null,
        peopleCount: r.walletCount,
        question: r.kind === "market_created" ? r.marketTitle : null,
        threshold:
          r.kind === "believer_milestone"
            ? Number((r.payload as { threshold?: number }).threshold ?? 0)
            : null,
      },
    };
    celebrationById.set(r.id, isCelebration(classifyConvictionEvent(convictionEvent)));
    // Facts above, voice here — the PI layer only chooses HOW this is said
    // (src/domain/pi-voice); the row id keeps that choice frozen per row.
    r.story = tellPiStory(convictionEvent, r.id);
    r.text = flattenStory(r.story);
  }

  // Materiality: the feed reports changes in conviction, not dust — "volume earns
  // attention only when it changes the meaning of the market". The importance
  // engine judges each row MARKET-RELATIVE (the same $6 is dust in a whale market
  // and a movement in a tiny one), keeping structural transitions and personal
  // (network) actions and dropping lone dust + washes (Tier 4). Order is left
  // untouched — the live tape stays chronological so delta-sync merging holds.
  // SIGNIFICANCE, DERIVED WHERE IT CANNOT BE EMITTED. A chain trade is written
  // by the indexer, which knows nothing about meaning — but the materiality
  // gate below ALREADY scores every one of them and was throwing the number
  // away, leaving the mixer to rank most of the feed on recency alone. The
  // same candidate now feeds both the gate and the score. No migration, no
  // second scoring system, nothing viewer-relative.
  // ONE CANDIDATE PER ROW, built once and used three times: to decide whether
  // the row belongs in the feed at all, to score its significance, and to set
  // the bar the whole batch is judged against.
  //
  // The candidate now carries WHAT THE MOVE DID TO A BELIEF — added, reduced,
  // exited, flipped, and how long it had been held — not just how much it
  // cost. Judged on dollars alone this feed reported capital and missed the
  // only thing it is about: a $12 exit after three months is a story, and a
  // $200 entry by someone who arrived this morning often is not.
  const scored = live
    .filter((r) => !unrenderable.has(r.id))
    .map((r) => {
      const m = momentumById.get(Number(r.marketId));
      const marketBelievers = m ? (m.believersYes ?? 0) + (m.believersNo ?? 0) : null;
      const b = r.wallet
        ? beliefByKey.get(`${r.wallet.toLowerCase()}:${Number(r.marketId)}`)
        : null;
      const heldSide = r.side === "YES" ? b?.yesShares : b?.noShares;
      const sell = (r.payload as { action?: string }).action === "SELL";
      const fullExit = sell && heldSide != null && heldSide <= 0;
      const conviction = beliefAction(actionById.get(r.id));
      const candidate = {
        kind: r.kind,
        side: r.side,
        amountUsd: r.amountUsd,
        walletCount: r.walletCount,
        tradeCount: r.tradeCount,
        windowMs: Number((r.payload as { window_ms?: number }).window_ms ?? 0) || null,
        relationship: (r.face?.relationship as NetTag | null) ?? null,
        marketBelievers,
        conviction,
        daysHeld: b?.daysHeld ?? null,
      };
      return { r, candidate, fullExit, daysHeld: b?.daysHeld ?? null };
    });

  // ADAPTIVE DENSITY. The gate above is absolute — "is this big?" — and on a
  // quiet chain the honest answer is no for everything, which is how a live
  // market renders as two rows. The editorial question is "is this the biggest
  // thing that happened today?", so the bar comes from the distribution of
  // what actually exists. On a busy day this changes nothing; on a quiet one
  // the small true things get to speak. Washes and dust never return.
  const { floor, relaxed } = adaptiveFloor(
    scored.map(({ candidate }) => scoreFeedEvent(candidate).score),
  );

  /* ANOMALY, MEASURED ONCE PER ROW (plan §11 step 5).
     The vector is viewer-blind and pure, so it is computed here — before
     significance — and reused by the diagnostic attach further down. It feeds
     significance as SUPPORTING evidence only: `scoreLiveAction` still caps an
     individual action below the exceptional band, so an anomalous market can
     never manufacture a structural story.
     `preEventHolders` is deliberately null in-feed: reconstructing the holder
     hierarchy needs a bounded historical read the tape does not do, and a large
     amount is never allowed to stand in for "a whale left". Concentration
     therefore stays 0 here and is reviewed in the corpus script. */
  const signalNowMs = Date.now();
  /* TEMPORAL PROOF (plan §8/§9).
     One bounded read — hourly price observations for just the markets with a
     candidate row — is what licenses "since then". Without it the vector can
     only ever say `new`, which is the correct silence rather than a guess. */
  const pricePaths = await loadPricePaths(
    sb,
    [...new Set(scored.map(({ r }) => Number(r.marketId)).filter(Number.isFinite))],
  );
  const signalById = new Map<string, ReturnType<typeof signalVector>>();
  for (const { r } of scored) {
    const m = momentumById.get(Number(r.marketId));
    const occurredMs = r.occurredAt ? Date.parse(r.occurredAt) : NaN;
    const proof = Number.isFinite(occurredMs)
      ? priceProofSince(pricePaths.get(Number(r.marketId)), occurredMs, signalNowMs)
      : null;
    signalById.set(
      r.id,
      signalVector(
        factsForRow(
          {
            kind: r.kind,
            wallet: r.wallet,
            action: (r.payload as { action?: "BUY" | "SELL" }).action ?? null,
            amountUsd: r.amountUsd,
            occurredAt: r.occurredAt,
          },
          m
            ? {
                yesPrice: m.yesPrice,
                yesPriceChange1h: m.yesPriceChange1h,
                yesPriceChange24h: m.yesPriceChange24h,
                yesPriceChange7d: m.yesPriceChange7d,
                yesCapitalDelta24h: m.yesCapitalDelta24h,
                noCapitalDelta24h: m.noCapitalDelta24h,
                capitalHeldYes: m.capitalHeldYes,
                capitalHeldNo: m.capitalHeldNo,
                tradeCount24h: m.tradeCount24h,
                tradeCount7d: m.tradeCount7d,
                believersYes: m.believersYes,
                believersNo: m.believersNo,
                newBelievers24h: m.newBelievers24h,
                newBelieversYes24h: m.newBelieversYes24h,
                newBelieversNo24h: m.newBelieversNo24h,
                peopleYesChange24h: m.peopleYesChange24h,
                sideFlips24h: m.sideFlips24h,
                lastTradeAt: m.lastTradeAt,
              }
            : null,
          signalNowMs,
          proof,
        ),
      ),
    );
  }

  const derived = new Map<string, number>();
  // The tier the admission gate computes and used to discard. It is exactly
  // "how much of the reader's attention is this owed", already calculated —
  // without carrying it forward every row arrived at the client looking
  // equally important, whatever it was.
  const tierById = new Map<string, number>();
  const material = scored
    .filter(({ candidate }) => admitToFeed(candidate, floor))
    .map(({ r, candidate, fullExit, daysHeld }) => {
      const v = signalById.get(r.id);
      derived.set(
        r.id,
        scoreLiveAction(candidate, {
          daysHeld,
          fullExit,
          signal: v ? { informationGain: v.informationGain, primary: v.primary } : null,
        }).score,
      );
      tierById.set(r.id, scoreFeedEvent(candidate).tier);
      return r;
    });

  // ── YOUR OWN STAKE ───────────────────────────────────────────────────────
  // The ranker knew about PEOPLE the reader is connected to and nothing about
  // their own MARKETS: a transition in the question you opened was ranked
  // exactly like one in a market you have never seen. The mechanism existed —
  // `viewerBoost` — and was populated for a single row kind.
  //
  // Bounded by the same ceiling relationship personalization uses, so the two
  // axes cannot outbid each other, and neither can lift a dust trade into the
  // breaking band. See src/domain/viewer-stake.
  let stakes = NO_STAKES;
  if (viewer && marketIds.length > 0) {
    const created = new Set<number>();
    for (const [id, w] of creatorByMarket) if (w === viewer) created.add(id);
    const holding = await deps.loadViewerHoldings(viewer, marketIds);
    stakes = { created, holding };
  }

  // ── PERSON MILESTONES: the second story one action tells ────────────────
  // Every other family reports what happened to a MARKET. "Sarah backed AI"
  // and "AI gained a new believer" are both here; "Sarah now backs five
  // questions" was not, and it is the one that makes a reader feel they are
  // watching people rather than transactions.
  //
  // Read-time, no table, no emitter — see src/lib/person-milestones.server for
  // why the crossing needs no ledger: a belief already knows when it began, so
  // the moment somebody reached five is the start date of the newest of their
  // five, recoverable identically forever.
  //
  // Full fetch only, like standing facts: a delta poll merges into a tail that
  // already carries them, and a conviction count does not move in 30 seconds.
  if (data?.since == null && actorWallets.length > 0) {
    const reached = await buildPersonMilestones({
      wallets: actorWallets,
      nameByWallet: new Map(
        [...profiles].map(([w, p]) => [w, p.displayName ?? aliasFor(w)] as const),
      ),
      titleById,
      sinceMs: Date.now() - LIVE_WINDOW_MS,
      nowMs: Date.now(),
    }).catch(() => []);
    for (const m of reached) {
      const told = tellConvictionMilestone(m);
      material.push({
        id: m.id,
        kind: "person_milestone",
        marketId: String(m.marketId),
        marketTitle: m.marketTitle,
        occurredAt: m.occurredAt,
        startedAt: m.occurredAt,
        side: null,
        walletCount: 1,
        tradeCount: null,
        amountEth: null,
        amountUsd: null,
        wallet: m.wallet,
        people: [{ wallet: m.wallet, name: m.name, avatarUrl: null }],
        story: {
          category: "milestone",
          headline: told.headline,
          body: told.body,
          attribution: told.attribution,
          tone: "neutral",
          personal: false,
        },
        text: `${told.headline} — ${told.body}`,
        // `pace` is set by the scheduling loop below, from classifyPace —
        // setting it here would be overwritten and would read as though this
        // row paced itself.
        //
        // A person crossing a rung is a real community moment, and the scale
        // is the shared one: this sits with a believer milestone, not with a
        // market flip. Persisted in the payload because that is where the
        // mixer reads an EMITTED significance from.
        // `rung` travels with the row so the editorial pass can ask whether a
        // count is interesting to a STRANGER, not merely true.
        payload: { significance: m.rung >= 10 ? 0.72 : 0.6, rung: m.rung },

      } as (typeof material)[number]);
    }
  }

  // ── DISCOVERY: "is there someone here I should meet?" ────────────────────
  // The second ranking dimension, and the one the product is actually for.
  // Significance says how big an event is; this says whether it opens a
  // relationship. Both are needed: a $5,000 anonymous trade really is the
  // bigger event, and a $50 buy by your Twin really is the better row.
  //
  // Walked in chronological order so `seen` is deterministic — the reader's
  // eventual order comes from the mixer, which cannot be an input to its own
  // inputs, so "most recent appearance is the first one" is the honest proxy.
  const discovery = new Map<string, number>();
  const seen = new Map<string, number>();
  const subjectsFor = (r: (typeof material)[number]): DiscoverySubject[] => {
    const group = cohortPeople.get(r.id);
    const wallets = group?.length ? group.map((p) => p.wallet) : r.wallet ? [r.wallet] : [];
    const founding =
      r.kind === "conviction_cohort" && (r.payload as { kind?: string }).kind === "founding";
    return wallets.map((raw) => {
      const w = raw.toLowerCase();
      const rel = relByWallet.get(w);
      const held = group?.find((p) => p.wallet.toLowerCase() === w)?.daysHeld;
      return {
        wallet: w,
        relationship: labelByWallet.get(w) ?? null,
        sharedConvictions: rel?.sharedBeliefs ?? null,
        confidence: rel?.confidence ?? null,
        topicCount: rel?.topicCount ?? null,
        since: rel?.since ?? null,
        daysHeld: held ?? beliefByKey.get(`${w}:${Number(r.marketId)}`)?.daysHeld ?? null,
        founding,
      } satisfies DiscoverySubject;
    });
  };
  for (const r of material) {
    const subs = subjectsFor(r);
    discovery.set(r.id, discoveryValue(subs, { seen }).score);
    markSeen(
      seen,
      subs.map((s) => s.wallet),
    );
  }

  // ── MEETING SOMEONE ──────────────────────────────────────────────────────
  // The rarest rows in the feed, and the only ones not about a market. They
  // are synthesized here rather than stored because they exist for exactly one
  // reader — see src/domain/discovery-moment for why that needs no ledger.
  for (const m of moments) {
    // Name the people first: the copy speaks about them, and the DNA cache
    // stores wallets, not names. `aliasFor` is the last resort so a row never
    // shows a hex address where a person should be.
    const named = m.people.map((p) => {
      const prof = profiles.get(p.wallet.toLowerCase());
      return { ...p, name: prof?.displayName ?? aliasFor(p.wallet) };
    });
    const story = tellDiscoveryMoment({ ...m, people: named });
    const lead = named[0];
    const significance = scoreDiscoveryMoment({
      rarity: m.rarity,
      sharedConvictions: lead?.sharedBeliefs ?? null,
      people: named.length,
    }).score;
    const subs: DiscoverySubject[] = named.map((p) => ({
      wallet: p.wallet.toLowerCase(),
      relationship:
        p.relationship === "neutral" || p.relationship === "insufficient" ? null : p.relationship,
      sharedConvictions: p.sharedBeliefs,
      confidence: p.confidence,
      topicCount: p.topicCount ?? null,
      since: p.since ?? null,
    }));
    const row: LiveRow = {
      id: m.id,
      kind: "discovery_moment",
      // Not about a market. The renderer treats a non-positive id as "no
      // destination" and lets the faces be the only way in — which is what
      // this row is for.
      marketId: "0",
      marketTitle: "",
      occurredAt: m.occurredAt,
      startedAt: m.occurredAt,
      side: null,
      walletCount: named.length,
      tradeCount: null,
      amountEth: null,
      amountUsd: null,
      wallet: null,
      people: named.map((p) => ({
        wallet: p.wallet,
        name: p.name,
        avatarUrl: profiles.get(p.wallet.toLowerCase())?.pfpUrl ?? null,
      })),
      story,
      text: flattenStory(story),
      payload: { significance },
      mix: {
        id: m.id,
        family: "relationship_story",
        significance,
        discovery: discoveryValue(subs, { seen }).score,
        occurredAt: m.occurredAt,
        marketId: "0",
        side: null,
        subjects: subs.map((s) => s.wallet),
        motif: `discovery:${m.kind}`,
      },
    };
    material.unshift(row);
    markSeen(
      seen,
      subs.map((s) => s.wallet),
    );
  }

  // MIXER INPUTS, not the mix itself. The server is where significance, the
  // viewer's relationships and the event families live, so it computes them —
  // but it must NOT reorder here. Delta-sync merges the fresh head into the
  // client's cached tail and re-sorts chronologically (mergeLiveRows), which
  // would throw a server-side ordering away on every poll. So the ordering is
  // applied once, after the merge, at the render boundary. One mixer, one
  // implementation, applied where the final order actually lives.
  for (const r of material) {
    if (r.kind === "discovery_moment") continue; // already carries its own inputs
    r.mix = {
      id: r.id,
      family: familyOf({
        kind: r.kind,
        category: r.story.category,
        // A market-wide story names its own type in the payload; a trade's
        // comes from the grammar above. Either way the mixer now learns WHAT
        // happened, not merely which table the row came from.
        celebration:
          celebrationById.get(r.id) ??
          CELEBRATION_TRANSITIONS.has(String((r.payload as { type?: string } | null)?.type ?? "")),
        personal: r.story.personal,
      }),
      discovery: discovery.get(r.id) ?? 0,
      // Emitted (our own emitters persist it) → derived (scored just above)
      // → fallback, which is now only reachable by a legacy or unknown kind.
      significance: Math.min(
        1,
        (typeof (r.payload as { significance?: number }).significance === "number"
          ? (r.payload as { significance: number }).significance
          : (derived.get(r.id) ?? SIGNIFICANCE.fallback)) +
          (viewerBoost.get(r.id) ?? 0) +
          // Your own question, or one your money is in. Never both added —
          // stakeBoost takes the strongest, not the sum.
          stakeBoost(Number(r.marketId), stakes),
      ),
      occurredAt: r.occurredAt,
      marketId: String(r.marketId),
      side: r.side,
      subjects: r.people?.length
        ? r.people.map((x) => x.wallet)
        : r.wallet
          ? [r.wallet.toLowerCase()]
          : [],
      /* A ROLLING STATE STORY IS IDENTIFIED BY ITS CATEGORY, NOT ITS NUMBERS.
         "More believers. Less capital." read at 09:10 and again at 10:00 is one
         evolving state, but the composed headline/detail carry the window's
         figures, so keying the motif on copy made two readings look like two
         developments. Derived market reads therefore key on the TRANSITION TYPE
         (and metric) alone — a change of category still earns a second row,
         a change of numbers does not. Named acts keep the headline key, so the
         genuine beats (new believer → side opens → pile-in → flip) survive. */
      motif:
        r.kind === "market_transition"
          ? `state:${(r.payload as { type?: string } | null)?.type ?? "move"}:${(r.payload as { metric?: string } | null)?.metric ?? ""}`
          : `${r.kind}:${r.side ?? "market"}:${r.story.headline}`,
      /* HOW LOUD THIS ROW IS ALLOWED TO BE, and what it costs to be that loud
         again (plan §6). The level is the viewer-blind vector's, so the mixer
         charges for a run of contradictions without ever being able to turn a
         true clue into a receipt — a high `signalGain` skips the cost. */
      /* The vector's level, CAPPED by what the printed copy can support. A row
         whose only claim is an unsized percentage cannot be Intelligence no
         matter what the market state around it looks like. */
      voice: capVoice(voiceLevel(signalById.get(r.id) ?? null), copyLevel.get(r.id)),
      signalGain: signalById.get(r.id)?.informationGain ?? 0,
      /* THE SHAPE OF THE CLUE, capped window-wide (plan §11.8). The motif keys
         on composed copy, so the same observation across four markets reads as
         four different rows to the mixer and as one sentence to the reader. */
      signalPrimary: signalById.get(r.id)?.primary ?? null,
      signalKind: signalById.get(r.id)?.tensionKind ?? null,
    } satisfies MixCandidate;
  }

  /* The vector is computed once per row in `signalById` (above the scoring
     pass) and is now INFLUENTIAL through significance. It is still only
     ATTACHED to the shipped payload under SIGNAL_DIAGNOSTIC=1, so review keeps
     the same shape and the client payload does not grow. */
  if (process.env["SIGNAL_DIAGNOSTIC"] === "1") {
    for (const r of material) r.signal = signalById.get(r.id);
  }

  /* VIEWER-RELATIVE ANGLE, AFTER ADMISSION (plan §7).
     Ranking is viewer-blind — the vector never sees who is reading. Once a row
     is in, the relationship may choose WHICH fact leads: the kicker names the
     reader's person. The clue is not spent to buy that: `applyViewerAngle`
     keeps the market observation in the third line, so a signal-bearing row
     never degrades into a personal-only headline. A zero-vector social row is
     left exactly as the voice layer wrote it. */
  for (const r of material) {
    const rel = (r.face?.relationship as NetLabel | null) ?? null;
    if (!rel || !r.story) continue;
    const angled = applyViewerAngle(r.story, { relationship: rel, signal: signalById.get(r.id) });
    if (angled === r.story) continue;
    r.story = angled;
    r.text = flattenStory(angled);
  }



  // ── THE EDITORIAL PASS: subtraction, after everything is composed ────────
  // Two rules a reader would state out loud — a second row about the same
  // market has to say something the first didn't, and low-value truth is still
  // not news. It runs HERE because it needs the finished copy (the motif is the
  // composed headline) and the finished amounts, and it only ever removes rows,
  // so nothing downstream — ordering, pacing, delta merge — changes shape.
  {
    const keep = new Set(
      editFeed(
        material.map((r) => ({
          id: r.id,
          kind: r.kind,
          marketId: String(r.marketId),
          occurredAt: r.occurredAt,
          motif: r.mix?.motif ?? null,
          amountUsd: r.amountUsd ?? null,
          significance: r.mix?.significance ?? null,
          action: actionById.get(r.id) ?? null,
          personal: r.story?.personal ?? false,
          rung: (r.payload as { rung?: number } | null)?.rung ?? null,
          side: r.side === "YES" || r.side === "NO" ? r.side : null,
          // A market_transition is a DERIVED reading of state; every other
          // family is somebody doing something, with a name attached.
          derived: r.kind === "market_transition",
          metric: (r.payload as { metric?: "capital" | "price" | "believers" } | null)?.metric ?? null,
          // Every derived market read is a rolling-window statement ("in the
          // last hour"), so two of them are two looks at one state.
          rolling: r.kind === "market_transition",
          family:
            r.kind === "market_transition"
              ? ((r.payload as { type?: string } | null)?.type ?? null)
              : r.kind,
          // Market-scoped rows need the question to make sense standalone.
          context: r.marketId ? (r.marketTitle ?? "").trim().length > 0 : true,
        })),
      ).map((r) => r.id),
    );
    for (let i = material.length - 1; i >= 0; i--)
      if (!keep.has(material[i]!.id)) material.splice(i, 1);
  }

  // ── CROSS-MARKET PERSON PATTERNS ─────────────────────────────────────────
  // Everything above reasons about ONE question at a time. A person watching
  // the room also notices what one row structurally cannot: that the same
  // person has now backed their third question this afternoon, that everything
  // they touched today is NO, that they sold one belief and bought another.
  //
  // It runs AFTER subtraction, so a pattern only ever describes rows the reader
  // will actually see, and it adds no rows — one aside on the person's newest
  // surviving row. See src/domain/person-pattern.
  for (const p of findPersonPatterns(
    material.map((r) => ({
      id: r.id,
      wallet: r.wallet ?? null,
      marketId: String(r.marketId),
      side: r.side === "YES" || r.side === "NO" ? r.side : null,
      action: actionById.get(r.id) ?? null,
      amountUsd: r.amountUsd ?? null,
      occurredAt: r.occurredAt,
    })),
  )) {
    const target = material.find((r) => r.id === p.rowId);
    if (target?.story) target.story = { ...target.story, pattern: p.note };
  }





  // PACING INPUTS. How urgent (from what the row is) and how heavy (from the
  // tier the gate already computed). Every row gets these, including the
  // synthesized discovery moments, so the client never has to guess — a row
  // with no pace would be scheduled as ordinary, which for a NEW TWIN is the
  // one outcome that would make the whole thing pointless.
  for (const r of material) {
    r.pace = {
      perishability: classifyPace({
        kind: r.kind,
        action: actionById.get(r.id) ?? null,
        isViewer: viewer != null && r.wallet?.toLowerCase() === viewer,
      }),
      // A discovery moment is the rarest row the product has; nothing about
      // it should ever be scheduled as texture. A person milestone has no
      // trade tier to inherit and would default to texture — it is a moment,
      // and the scheduler must not pace it like a dust buy.
      weight:
        r.kind === "discovery_moment"
          ? 1
          : r.kind === "person_milestone"
            ? 2
            : (tierById.get(r.id) ?? 3),
    };
  }

  // Telemetry: how much of this feed is still guessing? A new LIVE_KIND that
  // ships without a scorer shows up here instead of silently ranking at 0.5.
  if (import.meta.env.DEV) {
    if (relaxed)
      console.info(
        `[feed] quiet window: bar relaxed to ${floor} (standard 25) — ${material.length}/${scored.length} rows admitted.`,
      );
    const uncovered = [...new Set(material.map((r) => r.kind).filter((k) => !isCovered(k)))];
    if (uncovered.length)
      console.warn(
        `[feed] kind(s) with no entry in SIGNIFICANCE_COVERAGE: ${uncovered.join(", ")} — add a scorer or they rank at the fallback forever.`,
      );
    const t = fallbackRate(
      material.map((r) => ({
        kind: r.kind,
        significance:
          typeof (r.payload as { significance?: number }).significance === "number"
            ? (r.payload as { significance: number }).significance
            : (derived.get(r.id) ?? null),
      })),
    );
    if (t.fallback > 0)
      console.warn(
        `[feed] ${t.fallback}/${t.total} rows (${Math.round(t.rate * 100)}%) fell back to a default significance. Unscored kinds: ${t.kinds.join(", ")}`,
      );
  }

  // ── STANDING FACTS ───────────────────────────────────────────────────────
  // Not timeline rows, and returned separately for that reason. Every other
  // row answers "what changed"; these answer "who is still here", which is
  // the only honest thing a feed has to say when nothing changed at all. The
  // client holds them in reserve and the scheduler draws one during genuine
  // silence — see src/domain/standing-fact for why they never expire.
  //
  // Built only on a FULL fetch: a delta poll merges into a cached tail that
  // already carries the reserve, and continuity does not change in 30 seconds.
  const standing: LiveRow[] = [];
  if (data?.since == null && marketIds.length > 0) {
    const facts = await buildStandingFacts({
      marketIds,
      labelByWallet,
      crossingsByWallet: new Map([...relByWallet].map(([w, r]) => [w, r.sharedBeliefs ?? 0])),
      titleById,
      ageByMarket: new Map([...momentumById].map(([id, m]) => [id, m.marketAgeDays])),
      now: Date.now(),
      limit: STANDING_RESERVE,
    }).catch(() => []);
    for (const f of facts) {
      // A YES/NO activity rail is a side ledger. Standing facts are built from
      // the whole market after the event query, so apply the same side boundary
      // here or a quiet YES rail can be filled with a NO continuity fact.
      if (data?.side && f.side !== data.side) continue;
      const story = tellStandingFact(f);
      standing.push({
        id: `standing:${f.key}`,
        kind: "standing_fact",
        marketId: String(f.marketId),
        marketTitle: f.marketTitle,
        // A standing fact has no "when". The reserve is ordered by strength,
        // not by time, and `timeless` stops the renderer printing an age that
        // would read as "this just happened".
        occurredAt: new Date(0).toISOString(),
        startedAt: new Date(0).toISOString(),
        timeless: true,
        side: f.side,
        walletCount: f.people.length,
        tradeCount: null,
        amountEth: null,
        amountUsd: null,
        wallet: null,
        people: f.people.map((p) => ({
          wallet: p.wallet,
          name: p.name,
          avatarUrl: p.avatarUrl,
        })),
        story: {
          category: "conviction",
          headline: story.headline,
          body: story.body,
          attribution: null,
          tone: "neutral",
          personal: f.side == null,
        },
        text: `${story.headline} — ${story.body}`,
        pace: { perishability: "standing", weight: f.strength >= 0.65 ? 2 : 3 },
        payload: { significance: f.strength },
      });
    }
  }

  // ── SOMEBODY SHOWED UP ───────────────────────────────────────────────────
  // The one family in this tape that is about the READER rather than a market:
  // people who answered a call the reader's own conviction created.
  //
  // AGGREGATED, ONE ROW PER MARKET. Three people answering the same question is
  // one thing that happened to you, not three, and a row each would turn the
  // tape into a notification inbox that gets loudest on your best day. The
  // domain composes the sentence; see showedUpInMarket.
  //
  // Unscoped only: inside a market panel the reader is already looking at the
  // question, and a "somebody showed up here" row would be talking about the
  // thing on screen. Full fetches only, like standing facts — a delta poll
  // merges into a tail that already carries them.
  if (!scoped && viewer && data?.since == null) {
    const { showedUpForMe } = await import("@/lib/challenge.server");
    const since = Date.now() - SHOWED_UP_WINDOW_MS;
    const answers = await showedUpForMe(viewer, since).catch(() => []);
    for (const a of answers.slice(0, SHOWED_UP_MAX)) {
      const body = showedUpInMarket(a.people.map((p) => p.name ?? ""));
      // The domain refuses to speak about people it cannot name, and an
      // unnamed row here would read as "somebody showed up", which is worse
      // than silence — it is the feeling without the person.
      if (!body) continue;
      material.push({
        id: `showed-up:${a.marketId}:${a.atMs}`,
        kind: "showed_up",
        marketId: String(a.marketId),
        marketTitle: a.title,
        occurredAt: new Date(a.atMs).toISOString(),
        startedAt: new Date(a.atMs).toISOString(),
        // Answering is PARTICIPATION. Which side they took is Conviction
        // Match's question and never this one, so no side is carried here.
        side: null,
        walletCount: a.people.length,
        tradeCount: null,
        amountEth: null,
        amountUsd: null,
        wallet: a.people.length === 1 ? a.people[0].wallet : null,
        people: a.people.map((p) => ({ wallet: p.wallet, name: p.name, avatarUrl: null })),
        story: {
          category: "tribe",
          headline: "Showed up",
          body,
          attribution: null,
          // NEUTRAL, and not merely because "positive" is not a BeatTone. The
          // other tones are `yes` and `no` — they carry a SIDE, and tinting
          // this row by one would say the answer counted because of which way
          // it went. Showing up is participation; the side is Conviction
          // Match's question and never this one.
          tone: "neutral",
          // The "about you" wash, and the one row in the tape that has earned
          // it most: this did not merely involve your network, it happened
          // BECAUSE of something you did.
          personal: true,
        },
        text: `Showed up — ${body}`,
        // Newsworthy but not urgent: it stays true all day, and it should
        // never preempt a market that is actually moving right now.
        pace: { perishability: "soon", weight: 1 },
        payload: { significance: 0.9 },
      });
    }
  }

  return { rows: material, standing, error: null };
}
