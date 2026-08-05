/**
 * Public server functions used by the client. No auth required —
 * these read public tables via the publishable key.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchPovPositions } from "@/lib/pov.server";
import { publicClient, serviceClient } from "@/lib/supabase-clients";
import { costBasisUsd } from "@/domain/position-value";
import { aliasFor } from "@/lib/wallet-identity";
import { readLatestTradesPerMarket, readLatestTradeEvents } from "@/lib/events.functions";
import type { TapeTrade } from "@/domain/conviction-series";
import { toLegacyFeedEventRow } from "@/lib/events";
import { composeMarketStory, type NetworkFace, type NetworkLabel } from "@/domain/story";
import { accelerationFrom } from "@/domain/feed/score";
import { swrCache } from "@/lib/server-cache";
import { rankMarkets } from "@/domain/market-search";

/** SSR/anon feed snapshots live this long before a background refresh. */
const ANON_FEED_TTL_MS = 5_000;

export const VOLUME_WINDOWS = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  all: null,
} as const;
export type VolumeWindow = keyof typeof VOLUME_WINDOWS;

/** The viewer's closest match (tribe) or most-opposed wallet (opp). */
export type MatchPerson = {
  wallet: string;
  name: string | null;
  pfpUrl: string | null;
  score: number;
};

/**
 * The shared, viewer-independent slice of the feed for one window: the top-of-book
 * market_state rows plus the window-scoped volume, ETH/USD calibration and price
 * moves. Identical for every viewer, so listFeed caches it (SWR) — anon, connected,
 * SSR and poll traffic all read one warm snapshot per window instead of re-running
 * the market_state read and the per-window aggregate scans on every request. Throws
 * on a hard market_state error so a failure is never cached.
 */
async function sharedFeedData(win: VolumeWindow) {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("market_state")
    .select(
      `
    onchain_id, yes_price_usd, no_price_usd, money_yes_pct, people_yes_pct, people_no_pct,
    believers_yes, believers_no, believers_mixed, directional_believers, divergence,
    volume_total_usd, trending_score, chg_1h, chg_24h, chg_24h_yes, chg_24h_no,
    yes_capital_usd, no_capital_usd,
    new_believers_1h, new_believers_24h, unique_wallets_24h, circulation_24h,
    last_trade_at, velocity_5m,
    live_line, live_line_kind, live_line_window, live_line_occurred_at,
    opportunity_type, opportunity_score, opportunity_reason, opportunity_reason_code,
    opportunity_window, opportunity_confidence, opportunity_sample_size, opportunity_eligible,
    markets:onchain_id ( title, category, author_name, author_pfp, pov_slug )
  `,
    )
    .order("volume_total_usd", { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const ms = VOLUME_WINDOWS[win];
  const since = ms == null ? null : new Date(Date.now() - ms).toISOString();
  const ids = rows.map((r) => Number(r.onchain_id));
  const yesEth = new Map<number, number>();
  const noEth = new Map<number, number>();
  const yesTrades = new Map<number, number>();
  const noTrades = new Map<number, number>();
  let ethUsd = 0;
  const chgYes = new Map<number, number>();
  const chgNo = new Map<number, number>();
  let historyFrom: string | null = null;
  if (ids.length) {
    // Window price-moves and the ETH/USD calibration are PRECOMPUTED by cron
    // (market_window_change / calc_cache) — indexed lookups, not aggregate scans.
    const [vol, cal, chg] = await Promise.all([
      sb.rpc("market_volume_window", { p_ids: ids, p_since: since }),
      sb.from("calc_cache").select("value").eq("key", "eth_usd").maybeSingle(),
      sb
        .from("market_window_change")
        .select("onchain_id, chg_yes, chg_no, since_at")
        .eq("window_key", win)
        .in("onchain_id", ids),
    ]);
    for (const t of (vol.data ?? []) as {
      onchain_id: number;
      side: string;
      eth: number;
      trade_count: number;
    }[]) {
      const id = Number(t.onchain_id);
      const eth = Number(t.eth ?? 0);
      if (!Number.isFinite(eth)) continue;
      if (t.side === "NO") {
        noEth.set(id, (noEth.get(id) ?? 0) + eth);
        noTrades.set(id, (noTrades.get(id) ?? 0) + Number(t.trade_count ?? 0));
      } else {
        yesEth.set(id, (yesEth.get(id) ?? 0) + eth);
        yesTrades.set(id, (yesTrades.get(id) ?? 0) + Number(t.trade_count ?? 0));
      }
    }
    ethUsd = Number((cal.data as { value?: number } | null)?.value ?? 0) || 0;
    for (const c of (chg.data ?? []) as {
      onchain_id: number;
      chg_yes: number | null;
      chg_no: number | null;
      since_at: string | null;
    }[]) {
      const id = Number(c.onchain_id);
      if (c.chg_yes != null && Number.isFinite(Number(c.chg_yes)))
        chgYes.set(id, Number(c.chg_yes));
      if (c.chg_no != null && Number.isFinite(Number(c.chg_no))) chgNo.set(id, Number(c.chg_no));
      if (c.since_at && (historyFrom == null || c.since_at < historyFrom)) historyFrom = c.since_at;
    }
  }
  return { rows, yesEth, noEth, yesTrades, noTrades, ethUsd, chgYes, chgNo, historyFrom };
}

export const listFeed = createServerFn({ method: "GET" })
  .inputValidator((d?: { wallet?: string; window?: VolumeWindow }) =>
    z
      .object({
        wallet: z.string().min(3).optional(),
        window: z.enum(["1h", "24h", "7d", "30d", "all"]).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data: input }) => {
    const win: VolumeWindow = input?.window ?? "24h";
    const viewer = input?.wallet?.toLowerCase() ?? null;

    // The heavy, viewer-independent work is cached per window (SWR). EVERY viewer
    // — anon or connected — reads a warm snapshot instead of re-running the
    // market_state read + the per-window volume aggregate on each poll. Only the
    // small per-viewer DNA overlay below runs fresh.
    let shared: Awaited<ReturnType<typeof sharedFeedData>>;
    try {
      shared = await swrCache(`feed:shared:${win}`, { ttlMs: ANON_FEED_TTL_MS }, () =>
        sharedFeedData(win),
      );
    } catch (e) {
      return {
        data: [],
        error: e instanceof Error ? e.message : "feed unavailable",
        window: win,
        ethUsd: 0,
        historyFrom: null as string | null,
        tribe: null as MatchPerson | null,
        opp: null as MatchPerson | null,
      };
    }
    const { rows, yesEth, noEth, yesTrades, noTrades, ethUsd, chgYes, chgNo, historyFrom } = shared;
    const sb = serviceClient();

    // Viewer-relative: is the viewer's closest match (tribe) or most-opposed
    // wallet (opp) among the believers of each market, and on which side?
    const tribeBySide = new Map<number, "YES" | "NO">();
    const oppBySide = new Map<number, "YES" | "NO">();
    let tribePerson: MatchPerson | null = null;
    let oppPerson: MatchPerson | null = null;
    // The DNA labels behind the tribe/opp person, for the story's relationship beat.
    let tribeRel: NetworkLabel = "tribe";
    let oppRel: NetworkLabel = "opp";
    if (viewer && rows.length) {
      // Read the bounded viewer DNA cache (closest / tribe / opp). The feed NEVER
      // computes DNA inline — on a miss/stale it enqueues a bounded background
      // refresh and renders globally without personalization.
      const { readViewerDnaCache } = await import("@/lib/dna/viewer-dna-cache.server");
      const cache = await readViewerDnaCache(sb, viewer);
      if (!cache || !cache.fresh) {
        try {
          await sb.rpc("request_viewer_match_refresh", { p_wallet: viewer });
        } catch {
          /* best-effort; the connect path also enqueues */
        }
      }
      const tribeEntry = cache?.closest[0] ?? cache?.tribe[0] ?? null;
      const oppEntry = cache?.opp[0] ?? cache?.inverse[0] ?? null;
      tribeRel = tribeEntry?.relationship === "twin" ? "twin" : "tribe";
      oppRel = oppEntry?.relationship === "inverse" ? "inverse" : "opp";
      const tribe = tribeEntry
        ? { matched_wallet: tribeEntry.wallet, match_score: tribeEntry.agreement }
        : null;
      const opp = oppEntry
        ? { matched_wallet: oppEntry.wallet, match_score: oppEntry.agreement }
        : null;
      const focus = [tribe?.matched_wallet, opp?.matched_wallet].filter(Boolean) as string[];
      if (focus.length) {
        const ids = rows.map((r) => Number(r.onchain_id));
        const { data: beliefs } = await sb
          .from("wallet_beliefs")
          .select("wallet, onchain_id, stance_side")
          .in("wallet", focus)
          .in("onchain_id", ids)
          .in("stance_side", ["YES", "NO"]);
        for (const b of beliefs ?? []) {
          const w = String(b.wallet).toLowerCase();
          const side = b.stance_side as "YES" | "NO";
          if (tribe && w === tribe.matched_wallet.toLowerCase())
            tribeBySide.set(Number(b.onchain_id), side);
          if (opp && w === opp.matched_wallet.toLowerCase())
            oppBySide.set(Number(b.onchain_id), side);
        }

        // Put a face and a name on the tribesman / opp so the cards can show them.
        const { resolveProfiles } = await import("@/lib/profiles.server");
        const profiles = await resolveProfiles(
          focus.map((w) => w.toLowerCase()),
          4,
        );
        const person = (w: string, score: number): MatchPerson => {
          const prof = profiles.get(w.toLowerCase());
          return {
            wallet: w,
            name: prof?.displayName ?? aliasFor(w),
            pfpUrl: prof?.pfpUrl ?? null,
            score: Math.round(score),
          };
        };
        if (tribe) tribePerson = person(tribe.matched_wallet, Number(tribe.match_score));
        if (opp) oppPerson = person(opp.matched_wallet, Number(opp.match_score));
      }
    }

    const mapped = rows.map((r) => {
      const id = Number(r.onchain_id);
      const y = yesEth.get(id) ?? 0;
      const n = noEth.get(id) ?? 0;
      const yesUsd = ethUsd > 0 ? y * ethUsd : null;
      const noUsd = ethUsd > 0 ? n * ethUsd : null;

      // Narrative layer: your network active in THIS market → named faces (privacy
      // rule: only your own people are named; the crowd stays a count).
      const rr = r as Record<string, unknown>;
      const network: NetworkFace[] = [];
      const tSide = tribeBySide.get(id);
      if (tribePerson && tSide)
        network.push({
          wallet: tribePerson.wallet,
          name: tribePerson.name ?? aliasFor(tribePerson.wallet),
          avatarUrl: tribePerson.pfpUrl,
          relationship: tribeRel,
          side: tSide,
        });
      const oSide = oppBySide.get(id);
      if (oppPerson && oSide)
        network.push({
          wallet: oppPerson.wallet,
          name: oppPerson.name ?? aliasFor(oppPerson.wallet),
          avatarUrl: oppPerson.pfpUrl,
          relationship: oppRel,
          side: oSide,
        });
      const story = composeMarketStory({
        recent: {
          text: (rr.live_line as string | null) ?? null,
          kind: (rr.live_line_kind as string | null) ?? null,
          occurredAt: (rr.live_line_occurred_at as string | null) ?? null,
        },
        momentum: {
          newBackers1h: (rr.new_believers_1h as number | null) ?? null,
          newBackers24h: (rr.new_believers_24h as number | null) ?? null,
          uniqueWallets24h: (rr.unique_wallets_24h as number | null) ?? null,
          moneyYesPct: (rr.money_yes_pct as number | null) ?? null,
          peopleYesPct: (rr.people_yes_pct as number | null) ?? null,
          believersYes: (rr.believers_yes as number | null) ?? null,
          believersNo: (rr.believers_no as number | null) ?? null,
          volumeUsd: (rr.volume_total_usd as number | null) ?? null,
        },
        classification: (rr.opportunity_type as string | null) ?? null,
        network,
      });

      return {
        ...r,
        yes_volume_usd: yesUsd,
        no_volume_usd: noUsd,
        yes_trade_count: yesTrades.get(id) ?? 0,
        no_trade_count: noTrades.get(id) ?? 0,
        window_volume_usd: yesUsd == null && noUsd == null ? null : (yesUsd ?? 0) + (noUsd ?? 0),
        chg_window_yes: chgYes.get(id) ?? null,
        chg_window_no: chgNo.get(id) ?? null,
        tribe_side: tribeBySide.get(id) ?? null,
        opp_side: oppBySide.get(id) ?? null,
        story,
      };
    });

    // Phase 5: order by the SERVER-computed global opportunity score (eligible
    // markets first, highest score first). The client performs no scoring. Markets
    // without a computed/eligible score fall back to window volume so the feed is
    // never empty pre-warm; stable tie-break by onchain_id.
    mapped.sort((a, b) => {
      const ae = (a as Record<string, unknown>).opportunity_eligible ? 1 : 0;
      const be = (b as Record<string, unknown>).opportunity_eligible ? 1 : 0;
      if (ae !== be) return be - ae;
      const as = Number((a as Record<string, unknown>).opportunity_score ?? -1);
      const bs = Number((b as Record<string, unknown>).opportunity_score ?? -1);
      if (ae === 1 && bs !== as) return bs - as;
      const av = a.window_volume_usd ?? -1;
      const bv = b.window_volume_usd ?? -1;
      if (bv !== av) return bv - av;
      return Number(a.onchain_id) - Number(b.onchain_id);
    });

    return {
      data: mapped,
      error: null,
      window: win,
      ethUsd,
      historyFrom,
      tribe: tribePerson,
      opp: oppPerson,
    };
  });

// Base read-model shape for one market — everything the center deck needs to
// render (prices, believers, capital, momentum, identity). Windowed volume, the
// story beats and viewer DNA are feed-only enrichments the deck degrades without.
const MARKET_ROW_SELECT = `
  onchain_id, yes_price_usd, no_price_usd, money_yes_pct, people_yes_pct, people_no_pct,
  believers_yes, believers_no, believers_mixed, directional_believers, divergence,
  volume_total_usd, trending_score, chg_1h, chg_24h, chg_24h_yes, chg_24h_no,
  yes_capital_usd, no_capital_usd, new_believers_1h, new_believers_24h,
  new_believers_yes_24h, new_believers_no_24h,
  unique_wallets_24h, circulation_24h, last_trade_at, velocity_5m,
  live_line, live_line_kind, live_line_window, live_line_occurred_at,
  opportunity_type, opportunity_score, opportunity_reason, opportunity_reason_code,
  opportunity_window, opportunity_confidence, opportunity_sample_size, opportunity_eligible,
  markets:onchain_id ( title, category, author_name, author_pfp, pov_slug )
`;

/**
 * One search result. Deliberately small: the question (is this the market I
 * mean?), the two signals that say whether anyone cares — lifetime participants
 * and capital committed right now — and the raw facts the momentum sentence is
 * derived from. No price split, no category: neither helps a searcher decide.
 */
export interface MarketSearchHit {
  onchain_id: number;
  title: string;
  /** Unique wallets that ever traded here — lifetime reach. */
  participants: number;
  /** Directional believers holding right now. */
  believers: number;
  /** Capital currently committed across both sides, in USD. */
  capitalUsd: number;
  /** Epoch ms of first/last trade, when known. */
  firstActivityAt: number | null;
  lastActivityAt: number | null;
  /** Wallets that arrived in the last 24h. */
  joined24h: number;
}

interface IndexRow extends MarketSearchHit {
  category: string | null;
  /** 0–1 momentum weight — breaks relevance ties only. */
  interest: number;
}

const SEARCH_INDEX_TTL_MS = 60_000;

/**
 * The searchable catalog, held warm in-process. The catalog is small (a few
 * thousand questions), so matching happens in memory against normalised tokens
 * — that is what lets search understand plurals, synonyms, word order and typos
 * instead of demanding the exact title back.
 */
async function searchIndex(): Promise<IndexRow[]> {
  return swrCache("market-search-index", { ttlMs: SEARCH_INDEX_TTL_MS }, async () => {
    const sb = serviceClient();

    const rows: Array<{
      onchain_id: number;
      believers_yes: number | null;
      believers_no: number | null;
      yes_capital_usd: number | null;
      no_capital_usd: number | null;
      new_believers_24h: number | null;
      trade_count_24h: number | null;
      last_trade_at: string | null;
      market_created_at: string | null;
      markets: { title: string | null; category: string | null } | null;
    }> = [];
    // PostgREST caps a page at 1000 rows; walk the whole catalog.
    for (let from = 0; from < 20_000; from += 1000) {
      const { data } = await sb
        .from("market_state")
        .select(
          `onchain_id, believers_yes, believers_no, yes_capital_usd, no_capital_usd,
           new_believers_24h, trade_count_24h, last_trade_at, market_created_at,
           markets:onchain_id!inner ( title, category )`,
        )
        .range(from, from + 999);
      const page = (data ?? []) as unknown as typeof rows;
      rows.push(...page);
      if (page.length < 1000) break;
    }

    // Lifetime reach: unique wallets that ever traded each market.
    const { data: part } = await sb.rpc("market_participation");
    const reach = new Map<number, { participants: number; first: number | null; last: number | null }>();
    for (const p of (part ?? []) as unknown as Array<{
      onchain_id: number;
      participants: number;
      first_activity_at: string | null;
      last_activity_at: string | null;
    }>) {
      reach.set(Number(p.onchain_id), {
        participants: Number(p.participants) || 0,
        first: p.first_activity_at ? Date.parse(p.first_activity_at) : null,
        last: p.last_activity_at ? Date.parse(p.last_activity_at) : null,
      });
    }

    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const built = rows.map((r) => {
      const id = Number(r.onchain_id);
      const r2 = reach.get(id);
      const capitalUsd = Math.max(0, num(r.yes_capital_usd) + num(r.no_capital_usd));
      const believers = num(r.believers_yes) + num(r.believers_no);
      const lastTrade = r.last_trade_at ? Date.parse(r.last_trade_at) : null;
      return {
        onchain_id: id,
        title: r.markets?.title ?? "",
        category: r.markets?.category ?? null,
        // Reach is counted from the indexed event tape; markets whose trades
        // pre-date indexing fall back to their standing believers so a live
        // market never reads as if nobody ever showed up.
        participants: Math.max(r2?.participants ?? 0, believers),
        believers,
        capitalUsd,
        firstActivityAt: r2?.first ?? (r.market_created_at ? Date.parse(r.market_created_at) : null),
        lastActivityAt: r2?.last ?? lastTrade,
        joined24h: num(r.new_believers_24h),
        // A soft 0–1 liveness weight: recent trades and standing conviction.
        interest: Math.min(
          1,
          num(r.trade_count_24h) / 20 + participantsWeight(r2?.participants ?? 0) + Math.min(0.3, capitalUsd / 5_000),
        ),
      } satisfies IndexRow;
    });
    return built.filter((r) => r.title.length > 0);
  });
}

const participantsWeight = (p: number) => Math.min(0.4, p / 100);

/**
 * Full-catalog market search ranked by USEFULNESS: exact phrase, then keyword
 * and concept relevance, with momentum only breaking ties. A searcher should
 * never have to remember the exact wording of a question.
 */
export const searchMarkets = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string; limit?: number }) =>
    z.object({ query: z.string(), limit: z.number().int().min(1).max(20).optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<MarketSearchHit[]> => {
    const term = data.query.trim();
    if (term.length < 2) return [];
    const index = await searchIndex();
    const ranked = rankMarkets(
      term,
      index.map((r) => ({ id: r.onchain_id, title: r.title, category: r.category, interest: r.interest })),
      data.limit ?? 8,
    );
    const byId = new Map(index.map((r) => [r.onchain_id, r]));
    return ranked
      .map((s) => byId.get(s.id))
      .filter((r): r is IndexRow => Boolean(r))
      .map(({ category: _c, interest: _i, ...hit }) => hit);
  });


/**
 * One market's read-model row, shaped like a feed row so the center deck can
 * render ANY market — including ones outside the loaded top-of-feed slice (e.g.
 * opened from search). Returns null when the market isn't in the read model yet.
 */
export const getMarketRow = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => z.object({ id: z.number().int().nonnegative() }).parse(d))
  .handler(async ({ data }) => {
    const sb = serviceClient();
    const { data: row } = await sb
      .from("market_state")
      .select(MARKET_ROW_SELECT)
      .eq("onchain_id", data.id)
      .maybeSingle();
    return { row: row ?? null };
  });

export interface PositionSide {
  /** Remaining cost basis in USD (reducer weighted-average). Null when unknown. */
  invested: number | null;
  /** Current value in USD (POV valuation of held tokens). Null when unknown. */
  worth: number | null;
}

/**
 * The viewer's position on ONE market — the honest ownership numbers for the
 * center deck: remaining cost basis (invested) and current value (worth), per
 * side. Reads the single wallet_beliefs row; no POV round-trip (the stored value
 * is POV-maintained). Both null when the viewer holds nothing here.
 */
export const getPositionSummary = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string; marketId: number }) =>
    z.object({ wallet: z.string().min(3), marketId: z.number().int().nonnegative() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ yes: PositionSide; no: PositionSide }> => {
    const empty = { yes: { invested: null, worth: null }, no: { invested: null, worth: null } };
    const sb = serviceClient();
    const { data: row } = await sb
      .from("wallet_beliefs")
      .select("yes_cost, no_cost, yes_value_usd, no_value_usd")
      .eq("wallet", data.wallet.toLowerCase())
      .eq("onchain_id", data.marketId)
      .maybeSingle();
    if (!row) return empty;
    const fin = (v: unknown): number | null =>
      v == null || !Number.isFinite(Number(v)) ? null : Number(v);
    // Cost basis is stored in ETH; value it in USD so it compares with USD worth.
    const ethUsd = await ethUsdRate(sb);
    return {
      yes: { invested: costBasisUsd(row.yes_cost, ethUsd), worth: fin(row.yes_value_usd) },
      no: { invested: costBasisUsd(row.no_cost, ethUsd), worth: fin(row.no_value_usd) },
    };
  });

export interface MarketChange {
  /**
   * The compacted canonical trade tape this response was derived from. The deck
   * and Case File rebuild EVERY windowed number locally from it — believers,
   * capital and price over the selected timeframe — via the canonical marketBook
   * and conviction-series engines, so switching window is instant and costs no
   * request. Money and price are in ETH. This is the single source; per-window
   * change and flows are derived client-side, never precomputed here.
   */
  tape: TapeTrade[];
  /**
   * The market's acceleration — recent trade rate ÷ its own normal 24h rate,
   * from the SAME ranker baseline (accelerationFrom) so the center's "× normal"
   * read and the discovery feed never diverge. Computed server-side from
   * market_state (never re-derived on the client); null when no state row exists.
   */
  acceleration?: number | null;
}

/**
 * One market's current per-share prices + its % price change over EVERY window
 * (1h / 24h / 7d / 30d / all), so the deck can offer an instant window selector
 * without refetching. The change is precomputed by cron in market_window_change
 * as the first snapshot inside the window vs the latest — the honest definition
 * traders expect.
 */
export const getMarketChange = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => z.object({ id: z.number().int().nonnegative() }).parse(d))
  .handler(async ({ data }): Promise<MarketChange> => {
    // ONE read: the canonical trade tape. Every windowed number the deck shows is
    // rebuilt from it client-side (marketBook + conviction-series), so there is no
    // second, precomputed source of truth to drift from — and no wasted per-request
    // snapshot/flow queries. `amount_eth`/`price` are wei (strings on the wire, so
    // precision survives); scaled to whole ETH here.
    // Server-side read: the public events policy only exposes the last 3 days,
    // which would silently truncate the tape the book is rebuilt from.
    const trades = await readLatestTradeEvents(serviceClient(), {
      marketIds: [data.id],
      limit: 1000,
    });
    const tape: TapeTrade[] = [];
    for (const t of trades) {
      const side = t.side === "YES" || t.side === "NO" ? t.side : null;
      const action = t.action === "SELL" ? "SELL" : t.action === "BUY" ? "BUY" : null;
      if (!side || !action || !t.wallet) continue;
      const wei = Number(t.amount_eth ?? 0);
      const eth = Number.isFinite(wei) ? wei / 1e18 : 0;
      const at = new Date(t.occurred_at).getTime();
      const priceWei = t.price == null ? null : Number(t.price);
      // Chain order inside the block. Whole blocks share one occurred_at, so
      // without this a SELL can be replayed before the BUY it closes and the
      // wallet keeps phantom shares (and phantom believer/capital totals).
      const blk = Number(t.block_number ?? 0);
      const lg = Number(t.log_index ?? 0);
      const seq = Number.isFinite(blk) && Number.isFinite(lg) ? blk * 100_000 + Math.max(0, lg) : 0;
      tape.push({
        // Short, stable key — enough to count distinct believers, and nothing
        // more than the feed already publishes.
        w: t.wallet.slice(0, 10),
        side,
        action,
        eth,
        price: priceWei != null && Number.isFinite(priceWei) ? priceWei / 1e18 : null,
        t: at,
        seq,
      });
    }

    // The ranker's acceleration baseline, surfaced through this canonical path so
    // the center's state-transition emitter reads "× normal" from the same source
    // of truth. One tiny market_state read; the multiple is computed by the shared
    // accelerationFrom helper — never a second client-side baseline.
    let acceleration: number | null = null;
    const { data: ms } = await publicClient()
      .from("market_state")
      .select("trade_count_1h, trade_count_24h, velocity_5m")
      .eq("onchain_id", data.id)
      .maybeSingle();
    if (ms) {
      const r = ms as Record<string, unknown>;
      acceleration = accelerationFrom(
        Number(r.trade_count_1h ?? 0) || 0,
        Number(r.trade_count_24h ?? 0) || 0,
        Number(r.velocity_5m ?? 0) || 0,
      );
    }

    return { tape, acceleration };
  });

/** One window's authoritative believers/capital/price as of its opening boundary. */
export interface WindowBaseline {
  believersYes: number | null;
  believersNo: number | null;
  yesCapitalUsd: number | null;
  noCapitalUsd: number | null;
  yesPriceUsd: number | null;
  noPriceUsd: number | null;
}
export type MarketBaselines = Partial<Record<VolumeWindow, WindowBaseline>>;

const finLoose = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

/**
 * Per-window baselines for one market — the AUTHORITATIVE believers/capital/price
 * as they stood when each window opened, read from market_state_snapshots via the
 * market_window_baselines RPC. Unlike the client's tape (capped at 1000 trades),
 * this is exact on a busy market. Resilient by design: if the migration/RPC is
 * not deployed yet, or a window has no old-enough snapshot, the entry is simply
 * absent and the caller falls back to the tape-derived number.
 */
export const getMarketBaselines = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => z.object({ id: z.number().int().nonnegative() }).parse(d))
  .handler(async ({ data }): Promise<MarketBaselines> => {
    const sb = serviceClient() as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
    };
    try {
      const { data: rows, error } = await sb.rpc("market_window_baselines", { p_id: data.id });
      if (error || !Array.isArray(rows)) return {};
      const out: MarketBaselines = {};
      for (const raw of rows as Array<Record<string, unknown>>) {
        const key = String(raw.window_key) as VolumeWindow;
        out[key] = {
          believersYes: finLoose(raw.believers_yes),
          believersNo: finLoose(raw.believers_no),
          yesCapitalUsd: finLoose(raw.yes_capital_usd),
          noCapitalUsd: finLoose(raw.no_capital_usd),
          yesPriceUsd: finLoose(raw.yes_price_usd),
          noPriceUsd: finLoose(raw.no_price_usd),
        };
      }
      return out;
    } catch {
      return {}; // pre-migration or transient error → tape fallback
    }
  });

/**
 * Per-market pulse strips: the most recent real trade events for each of the
 * given markets, so every card in the grid can run its own little live feed.
 */
export const listMarketPulses = createServerFn({ method: "GET" })
  .inputValidator((d: { ids: number[] }) =>
    z.object({ ids: z.array(z.number().int()).max(120) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ids = data.ids;
    if (ids.length === 0) return { pulses: {} as Record<string, Pulse[]> };
    const sb = serviceClient();
    // Canonical trade activity from the events log, adapted to the legacy row
    // shape the pulse strips are built from. Exactly 8 per market (the strip's
    // cap) — no global over-fetch, and a quiet market never gets starved out.
    const facts = await readLatestTradesPerMarket(sb, ids, 8);
    const rows = facts.map(toLegacyFeedEventRow);

    const out: Record<string, Pulse[]> = {};
    const wanted = new Set<string>();
    for (const r of rows ?? []) {
      const key = String(r.onchain_id);
      const list = (out[key] ??= []);
      if (list.length >= 8) continue;
      const p = (r.payload ?? {}) as { eth?: string; tokens?: string };
      const ethRaw = Number(p.eth ?? 0);
      const w = String(r.wallet ?? "");
      if (w) wanted.add(w.toLowerCase());
      list.push({
        key: String(r.event_key),
        type: String(r.type),
        side: (r.side === "NO" ? "NO" : "YES") as "YES" | "NO",
        wallet: w,
        name: null,
        pfpUrl: null,
        eth: Number.isFinite(ethRaw) ? ethRaw / 1e18 : 0,
        at: String(r.occurred_at),
      });
    }

    // Put a face and a name on every trader we are about to show.
    const { resolveProfiles } = await import("@/lib/profiles.server");
    const profiles = await resolveProfiles([...wanted], 30);
    for (const list of Object.values(out)) {
      for (const p of list) {
        const prof = p.wallet ? profiles.get(p.wallet.toLowerCase()) : null;
        p.name = prof?.displayName ?? (p.wallet ? aliasFor(p.wallet) : null);
        p.pfpUrl = prof?.pfpUrl ?? null;
      }
    }

    return { pulses: out };
  });

export type Pulse = {
  key: string;
  type: string;
  side: "YES" | "NO";
  wallet: string;
  /** Real POV display name when known, otherwise a stable generated alias. */
  name: string | null;
  pfpUrl: string | null;
  eth: number;
  at: string;
};

/** Current ETH→USD rate from the cron-refreshed snapshot (0 when unknown). */
async function ethUsdRate(sb: ReturnType<typeof serviceClient>): Promise<number> {
  const { data } = await sb.from("calc_cache").select("value").eq("key", "eth_usd").maybeSingle();
  return Number((data as { value?: number } | null)?.value ?? 0) || 0;
}

/**
 * The live ETH/USD rate + when it was last refreshed — the ONE shared rate the
 * whole client formats money with (the DisplayUnit context polls this). `rate` is
 * null when unknown so callers show a stale/unavailable state instead of a
 * fabricated number; `updatedAt` drives the toggle's subtle staleness marker.
 */
export const getEthUsd = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ rate: number | null; updatedAt: string | null }> => {
    const sb = publicClient();
    const { data } = await sb
      .from("calc_cache")
      .select("value, updated_at")
      .eq("key", "eth_usd")
      .maybeSingle();
    const row = data as { value?: number | null; updated_at?: string | null } | null;
    const rate = Number(row?.value ?? 0) || 0;
    return { rate: rate > 0 ? rate : null, updatedAt: row?.updated_at ?? null };
  },
);

/** The latest verified state a market's share preview (Open Graph) is built from. */
export interface MarketOgData {
  id: number;
  question: string | null;
  /** Current YES share, 0–100 (money-weighted), or null when unpriced. */
  yesPct: number | null;
  believers: number | null;
  capitalUsd: number | null;
  /** New believers in the last 24h — recent movement, never a total. */
  newBelievers: number | null;
  /** A media thumbnail URL for a media market (drives the OG image); else null. */
  imageUrl: string | null;
  /** When the state was last refreshed — the preview quotes the same source. */
  updatedAt: string | null;
}

/**
 * The share-preview data for one market, from the SAME market_state the deck,
 * chart and current-state copy read — so a link preview never contradicts the
 * page it opens. Null when the market doesn't exist.
 */
export const getMarketOg = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => z.object({ id: z.number().int().nonnegative() }).parse(d))
  .handler(async ({ data }): Promise<MarketOgData | null> => {
    const sb = serviceClient();
    const fin = (v: unknown): number | null =>
      v == null || !Number.isFinite(Number(v)) ? null : Number(v);
    const { data: st } = await sb
      .from("market_state")
      .select(
        `onchain_id, money_yes_pct, believers_yes, believers_no,
         yes_capital_usd, no_capital_usd, new_believers_24h, updated_at,
         markets:onchain_id ( title )`,
      )
      .eq("onchain_id", data.id)
      .maybeSingle();

    if (!st) {
      const { data: mk } = await sb
        .from("markets")
        .select("title")
        .eq("onchain_id", data.id)
        .maybeSingle();
      if (!mk) return null;
      return {
        id: data.id,
        question: (mk as { title?: string | null }).title ?? null,
        yesPct: null,
        believers: null,
        capitalUsd: null,
        newBelievers: null,
        imageUrl: null,
        updatedAt: null,
      };
    }

    const r = st as unknown as Record<string, unknown> & {
      // PostgREST types a to-one embed as an array; accept either shape.
      markets?: { title?: string | null } | { title?: string | null }[] | null;
    };
    const mk = Array.isArray(r.markets) ? r.markets[0] : r.markets;
    const bel = (fin(r.believers_yes) ?? 0) + (fin(r.believers_no) ?? 0);
    const cap = (fin(r.yes_capital_usd) ?? 0) + (fin(r.no_capital_usd) ?? 0);
    // The media thumbnail lives in conviction_markets.media (a private-bucket path
    // that needs signing), not on market_state — so the OG *image* is resolved by
    // the dedicated image endpoint (Phase 3), which can mint a stable URL. Here we
    // only carry the honest text state; imageUrl stays null for the preview meta.
    return {
      id: data.id,
      question: mk?.title ?? null,
      yesPct: fin(r.money_yes_pct),
      believers: bel > 0 ? bel : null,
      capitalUsd: cap > 0 ? cap : null,
      newBelievers: fin(r.new_believers_24h),
      imageUrl: null,
      updatedAt: (r.updated_at as string | null) ?? null,
    };
  });

/**
 * The reducer stores acquisition cost in ETH (it folds each trade's eth_amount).
 * Worth, however, is POV's USD valuation — so gain must compare like with like.
 * Value the ETH cost basis at the current rate, matching how the rest of the app
 * prices ETH quantities. Null when the cost is unknown or we have no rate, so the
 * caller honestly shows "worth only" instead of an inflated gain.
 */

export const getWallet = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string; window?: VolumeWindow }) =>
    z
      .object({
        wallet: z.string().min(3),
        window: z.enum(["1h", "24h", "7d", "30d", "all"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const sb = serviceClient();
    const wallet = data.wallet.toLowerCase();
    // NOTE: there is no FK from wallet_beliefs.onchain_id -> markets, so the
    // market title/category must be fetched separately and stitched in.
    const { data: rows } = await sb
      .from("wallet_beliefs")
      .select(
        `
        onchain_id, expressed_side, stance_side, stance, conviction, days_held,
        yes_shares, no_shares, yes_cost, no_cost, first_backed_at,
        yes_value_usd, no_value_usd, value_source, value_updated_at
      `,
      )
      .eq("wallet", wallet)
      .order("conviction", { ascending: false })
      .limit(200);

    const ids = Array.from(new Set((rows ?? []).map((r) => Number(r.onchain_id))));
    const metaById = new Map<
      number,
      { title: string | null; category: string | null; pov_slug: string | null }
    >();
    if (ids.length) {
      const { data: mk } = await sb
        .from("markets")
        .select("onchain_id, title, category, pov_slug")
        .in("onchain_id", ids);
      for (const m of mk ?? [])
        metaById.set(Number(m.onchain_id), {
          title: (m.title as string | null) ?? null,
          category: (m.category as string | null) ?? null,
          pov_slug: (m.pov_slug as string | null) ?? null,
        });
    }

    // Live prices for every held market, so the portfolio panel does not depend
    // on the market being present in the (50-row) feed page.
    const stateById = new Map<
      number,
      {
        yes_price_usd: number | null;
        no_price_usd: number | null;
        chg_24h_yes: number | null;
        chg_24h_no: number | null;
        // Quiet tribe health for the position card: side believer counts + the
        // per-side new-believers-today intake (all read-model, no extra query).
        believers_yes: number | null;
        believers_no: number | null;
        new_believers_yes_24h: number | null;
        new_believers_no_24h: number | null;
        // The GLOBAL factual live line from the read model — attached to each
        // owned position via THIS set-based join (never a per-position query).
        live_line: string | null;
        live_line_kind: string | null;
        live_line_occurred_at: string | null;
      }
    >();
    if (ids.length) {
      const { data: st } = await sb
        .from("market_state")
        .select(
          "onchain_id, yes_price_usd, no_price_usd, chg_24h_yes, chg_24h_no, believers_yes, believers_no, new_believers_yes_24h, new_believers_no_24h, live_line, live_line_kind, live_line_occurred_at",
        )
        .in("onchain_id", ids);
      for (const s of st ?? [])
        stateById.set(Number(s.onchain_id), {
          yes_price_usd: s.yes_price_usd == null ? null : Number(s.yes_price_usd),
          no_price_usd: s.no_price_usd == null ? null : Number(s.no_price_usd),
          chg_24h_yes: s.chg_24h_yes == null ? null : Number(s.chg_24h_yes),
          chg_24h_no: s.chg_24h_no == null ? null : Number(s.chg_24h_no),
          believers_yes: s.believers_yes == null ? null : Number(s.believers_yes),
          believers_no: s.believers_no == null ? null : Number(s.believers_no),
          new_believers_yes_24h:
            s.new_believers_yes_24h == null ? null : Number(s.new_believers_yes_24h),
          new_believers_no_24h:
            s.new_believers_no_24h == null ? null : Number(s.new_believers_no_24h),
          live_line: (s.live_line as string | null) ?? null,
          live_line_kind: (s.live_line_kind as string | null) ?? null,
          live_line_occurred_at: (s.live_line_occurred_at as string | null) ?? null,
        });
    }

    // Window-scoped price moves, from the SAME precomputed table the market
    // cards read, so the panel and the cards always agree on the percentage.
    const win: VolumeWindow = data.window ?? "24h";
    const chgYes = new Map<number, number>();
    const chgNo = new Map<number, number>();
    if (ids.length) {
      const { data: chg } = await sb
        .from("market_window_change")
        .select("onchain_id, chg_yes, chg_no")
        .eq("window_key", win)
        .in("onchain_id", ids);
      for (const c of (chg ?? []) as {
        onchain_id: number;
        chg_yes: number | null;
        chg_no: number | null;
      }[]) {
        const id = Number(c.onchain_id);
        if (c.chg_yes != null && Number.isFinite(Number(c.chg_yes)))
          chgYes.set(id, Number(c.chg_yes));
        if (c.chg_no != null && Number.isFinite(Number(c.chg_no))) chgNo.set(id, Number(c.chg_no));
      }
    }

    // Window-scoped BELIEVER intake per held side. The read model only stores a
    // fixed 24h intake, so the selected timeframe is replayed off the canonical
    // trade log: a wallet is "new in the window" when its FIRST trade on that
    // market+side falls inside it. If the fetched tape doesn't reach back past
    // the window opening we can't tell new from pre-existing, so we return null
    // (the card then shows the count without a move) rather than guess.
    const newYesWin = new Map<number, number>();
    const newNoWin = new Map<number, number>();
    const winMs = VOLUME_WINDOWS[win];
    if (ids.length && winMs != null) {
      const since = Date.now() - winMs;
      try {
        const tape = await readLatestTradesPerMarket(serviceClient(), ids.slice(0, 60), 400);
        const firstSeen = new Map<string, number>(); // `${id}|${side}|${wallet}` -> ms
        const oldest = new Map<number, number>();
        for (const t of tape) {
          const side = t.side === "YES" || t.side === "NO" ? t.side : null;
          if (!side || !t.wallet) continue;
          const id = Number(t.market_id);
          const at = new Date(t.occurred_at).getTime();
          if (!Number.isFinite(at)) continue;
          const o = oldest.get(id);
          if (o == null || at < o) oldest.set(id, at);
          const k = `${id}|${side}|${t.wallet.toLowerCase()}`;
          const prev = firstSeen.get(k);
          if (prev == null || at < prev) firstSeen.set(k, at);
        }
        const counts = new Map<string, number>();
        for (const [k, at] of firstSeen) {
          if (at < since) continue;
          const [idStr, side] = k.split("|");
          counts.set(`${idStr}|${side}`, (counts.get(`${idStr}|${side}`) ?? 0) + 1);
        }
        for (const id of ids) {
          // Only trust the replay when the tape actually covers the window.
          const o = oldest.get(id);
          if (o == null || o > since) continue;
          newYesWin.set(id, counts.get(`${id}|YES`) ?? 0);
          newNoWin.set(id, counts.get(`${id}|NO`) ?? 0);
        }
      } catch {
        /* best-effort: the card falls back to the plain believer count */
      }
    }

    // POV is the authority on what a position is worth right now (it prices the
    // wallet's own tokens). Refresh live, best-effort: if POV is slow or down we
    // fall back to the stored value, and only then to shares x market price.
    const povValue = new Map<
      number,
      { yes: number; no: number; yesShares: number; noShares: number }
    >();
    try {
      const pov = await fetchPovPositions(wallet, 4000);
      if (pov.length) {
        const uuids = [...new Set(pov.map((p) => p.marketId))];
        const idByUuid = new Map<string, number>();
        for (let i = 0; i < uuids.length; i += 500) {
          const { data: mk } = await sb
            .from("markets")
            .select("onchain_id, pov_uuid")
            .in("pov_uuid", uuids.slice(i, i + 500));
          for (const m of mk ?? [])
            if (m.pov_uuid) idByUuid.set(String(m.pov_uuid), Number(m.onchain_id));
        }
        for (const p of pov) {
          const id = idByUuid.get(p.marketId);
          if (id == null) continue;
          const a = povValue.get(id) ?? { yes: 0, no: 0, yesShares: 0, noShares: 0 };
          if (p.side === "YES") {
            a.yes += p.currentValueUsd;
            a.yesShares += p.tokenBalance;
          } else {
            a.no += p.currentValueUsd;
            a.noShares += p.tokenBalance;
          }
          povValue.set(id, a);
        }
      }
    } catch {
      /* best-effort: stored values still render */
    }

    // Cost basis is stored in ETH; value it in USD so gain compares like with like.
    const ethUsd = await ethUsdRate(sb);

    // Staleness: the POV poller re-prices every ~2 min, so a stored marked value
    // older than this — with no live POV value this cycle — is not a trustworthy
    // mark. A never-priced row (null timestamp) is stale by definition. Callers
    // prefer a fresh shares×price mark and suppress gain rather than subtract a
    // stale value from a fresh cost basis.
    const STALE_MS = 60 * 60 * 1000; // 1 hour
    const nowMs = Date.now();
    const staleAt = (ts: unknown): boolean => {
      if (ts == null) return true;
      const t = new Date(String(ts)).getTime();
      return !Number.isFinite(t) || nowMs - t > STALE_MS;
    };

    const positions = (rows ?? []).map((r) => {
      const pov = povValue.get(Number(r.onchain_id));
      const stale = staleAt(r.value_updated_at);
      return {
        ...r,
        // The honest "invested": the ETH acquisition cost, valued at the current rate.
        yes_cost: costBasisUsd(r.yes_cost, ethUsd),
        no_cost: costBasisUsd(r.no_cost, ethUsd),
        yes_shares: pov?.yesShares ?? r.yes_shares,
        no_shares: pov?.noShares ?? r.no_shares,
        yes_value_usd: pov?.yes ?? (r.yes_value_usd == null ? null : Number(r.yes_value_usd)),
        no_value_usd: pov?.no ?? (r.no_value_usd == null ? null : Number(r.no_value_usd)),
        // A live POV value this cycle is fresh; otherwise trust the stored mark
        // only if its timestamp is recent.
        yes_value_stale: pov?.yes == null && stale,
        no_value_stale: pov?.no == null && stale,
        markets: metaById.get(Number(r.onchain_id)) ?? null,
        state: stateById.get(Number(r.onchain_id)) ?? null,
        chg_window_yes: chgYes.get(Number(r.onchain_id)) ?? null,
        chg_window_no: chgNo.get(Number(r.onchain_id)) ?? null,
        // Believer intake over the SELECTED window (null when the tape can't
        // cover it, or on "All" where "new" has no meaning).
        new_believers_yes_win: newYesWin.get(Number(r.onchain_id)) ?? null,
        new_believers_no_win: newNoWin.get(Number(r.onchain_id)) ?? null,
      };
    });
    return { wallet, positions, window: win };
  });
