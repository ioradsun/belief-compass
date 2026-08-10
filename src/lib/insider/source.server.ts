/**
 * INSIDER — THE TAPE'S SOURCE LAYER.
 *
 * Every way the live tape touches the world, extracted from `live.functions`
 * so composition can be read (and tested) without a database in the way. Each
 * loader is declared GLOBAL or VIEWER at its signature; that classification is
 * what the shared-tape cache key relies on.
 */
import type { z } from "zod";
import { serviceClient } from "@/lib/supabase-clients";
import { currentHoldDays, holdStartIsFloor } from "@/domain/tenure";
import { groupPricePaths, type PriceSample } from "@/domain/price-proof";
import { fetchMarketNames } from "@/lib/market-titles.server";
import type { ProfileLike } from "@/domain/feed-people";
import type { tapeInput } from "@/lib/insider/tape-input";

type TapeQuery = z.output<typeof tapeInput>;

export const LIVE_KINDS = [
  "trade",
  "market_created",
  "position_changed_side",
  "believer_milestone",
  "tribe_doubled",
  "market_transition",
  "conviction_cohort",
];

/** The live feed only reports the last 72 hours. Older events are history. */
export const LIVE_WINDOW_MS = 72 * 60 * 60_000;

export type Momentum = {
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
export interface TapeSource {
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

export const EMPTY_SOURCE: TapeSource = {
  rows: [],
  marketIds: [],
  titleById: new Map(),
  creatorByMarket: new Map(),
  momentumById: new Map(),
  ethUsd: 0,
  error: null,
};

export async function loadTapeSource(
  sb: ReturnType<typeof serviceClient>,
  data: TapeQuery,
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
      "source_key, kind, market_id, side, action, amount_eth, wallet, occurred_at, block_number, log_index, milestone_threshold:payload->>threshold, transition_type:payload->>type, transition_metric:payload->>metric, transition_direction:payload->>direction, transition_significance:payload->>significance, cohort_kind:payload->>kind, cohort_rung:payload->>rung, cohort_crossed_on:payload->>crossedOn, cohort_people:payload->people",
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
export type BeliefByKey = Map<
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
export async function loadBelieverFaces(
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
export async function loadActorBeliefs(
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
export interface ViewerDnaRow {
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
export async function loadViewerDna(viewer: string): Promise<ViewerDnaRow | null> {
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
export async function loadViewerHoldings(viewer: string, marketIds: number[]): Promise<Set<number>> {
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

export const REAL_DEPS: TapeDeps = {
  client: () => serviceClient(),
  // The factual half is viewer-blind by contract, so it is shared across
  // readers rather than rebuilt per wallet — see insider/source-cache.server.
  loadTapeSource: (sb, data) =>
    import("@/lib/insider/source-cache.server").then((m) => m.loadSharedTapeSource(sb, data)),

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
export async function loadPricePaths(
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
