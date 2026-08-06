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
import { availableModes, type FeedMode } from "@/domain/feed/mode";
import { loadWindowChanges, pricePct } from "@/lib/window-change.server";

/** SSR/anon feed snapshots live this long before a background refresh. */
const ANON_FEED_TTL_MS = 5_000;

/**
 * How many of the viewer's people, per side, the feed overlay looks for.
 *
 * Not a display cap — a QUERY bound. The `wallet_beliefs` lookup is
 * (these wallets × the feed's markets), so this is what keeps a viewer with a
 * large network from turning one feed build into a wide scan. Twelve is well
 * past the point where a bigger number changes any sentence: the copy says "3
 * people in your Tribe", and beyond about four the count stops carrying
 * information.
 */
const NETWORK_OVERLAY_CAP = 12;

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
    volume_total_usd, trending_score,
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
  /**
   * Lifetime reach and the activity span — the SAME `market_participation` RPC
   * the search index reads (see `searchIndex`). The feed did not carry these, so
   * a market's participant count in search and in the running order would have
   * come from two different definitions of "participant": everyone who ever
   * traded, versus whoever is holding right now. Two numbers for one fact is the
   * gap that makes a reader distrust both.
   */
  const reach = new Map<
    number,
    { participants: number; first: number | null; last: number | null }
  >();
  if (ids.length) {
    // Volume and the ETH/USD calibration are precomputed; the WINDOW MOVE is not
    // read from any stored percentage. It comes from the one bulk baseline
    // loader (src/lib/window-change.server), which pairs this very row with the
    // same snapshot history the market panels use, so a card and the panel it
    // opens can never disagree about the same window.
    const [vol, cal, part, chg] = await Promise.all([
      sb.rpc("market_volume_window", { p_ids: ids, p_since: since }),
      sb.from("calc_cache").select("value").eq("key", "eth_usd").maybeSingle(),
      sb.rpc("market_participation"),
      loadWindowChanges(sb, rows as unknown as Array<Record<string, unknown>>, win),
    ]);
    for (const p of (part.data ?? []) as unknown as Array<{
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
    for (const id of ids) {
      const c = chg.byId.get(id);
      const y = pricePct(c, "YES");
      const n = pricePct(c, "NO");
      if (y != null) chgYes.set(id, y);
      if (n != null) chgNo.set(id, n);
    }
    historyFrom = chg.historyFrom;
  }

  return { rows, yesEth, noEth, yesTrades, noTrades, ethUsd, chgYes, chgNo, historyFrom, reach };
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
    const { rows, yesEth, noEth, yesTrades, noTrades, ethUsd, chgYes, chgNo, historyFrom, reach } =
      shared;
    const sb = serviceClient();

    /**
     * VIEWER-RELATIVE OVERLAY — the viewer's people, in each of these markets.
     *
     * This used to read `cache.closest[0]` and `cache.opp[0]`: ONE tribesman and
     * ONE rival, out of buckets that hold the whole network. Everything
     * downstream inherited that ceiling — the feed could only ever say "your
     * Tribe is backing YES", never how many of them, because it had never asked
     * about more than one person. The cache always had the answer.
     *
     * So the whole aligned bucket (twin ∪ tribe) and the whole opposed bucket
     * (inverse ∪ opp) are read, capped, and resolved together. The cost is the
     * same two queries it always was, over more wallets.
     */
    const tribeBySide = new Map<number, "YES" | "NO">();
    const oppBySide = new Map<number, "YES" | "NO">();
    /**
     * Everyone from each group holding a side here — the counts the copy needs.
     *
     * The SIDE travels with the PERSON, never with the group. A tribe is not a
     * bloc: two people the viewer agrees with can land on opposite sides of one
     * market, and stamping the group's headline side onto each of them would
     * state something false about a named individual.
     */
    const tribeHere = new Map<number, (MatchPerson & { side: "YES" | "NO" })[]>();
    const oppHere = new Map<number, (MatchPerson & { side: "YES" | "NO" })[]>();
    /**
     * How much shared history the viewer has with the people present, summed —
     * same-side for allies, opposite-side for rivals. This is what the Tribe and
     * Rivals orderings rank on, and specifically what keeps Rivals from ranking
     * by how HARD someone disagrees (see @/domain/feed/mode).
     */
    const tribeOverlap = new Map<number, number>();
    const oppOverlap = new Map<number, number>();
    /**
     * TOUCHED — every market one of the viewer's people CREATED or traded in,
     * whether or not they still hold a side. The face piles stay a statement
     * about live conviction; "show me my Tribe" is a question about where those
     * people have been, and a market someone wrote or since exited is still
     * theirs. Filter-only: nothing renders off these.
     */
    const tribeTouched = new Set<number>();
    const oppTouched = new Set<number>();
    /** Group membership, hoisted so creator authorship can be judged below. */
    const tribeWallets = new Set<string>();
    const oppWallets = new Set<string>();
    /** When one of the viewer's people last traded here — THEIR recency. */
    const netRecency = new Map<number, number>();
    let tribePerson: MatchPerson | null = null;
    let oppPerson: MatchPerson | null = null;
    // The DNA labels behind the LEAD person on each side, for the story beat.
    let tribeRel: NetworkLabel = "tribe";
    let oppRel: NetworkLabel = "opp";
    // Which social perspectives this viewer's network can actually seat. Read
    // here because this is where the DNA cache is already open; the gate itself
    // lives in @/domain/feed/mode.
    let modes: FeedMode[] = ["for_you"];
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
      // Strongest first, so a truncated group still keeps the people who matter
      // and the LEAD of each side is the one the story would have picked anyway.
      const byStrength = (a: { agreement: number }, b: { agreement: number }) =>
        Math.abs(b.agreement - 50) - Math.abs(a.agreement - 50);
      const aligned = [...(cache?.closest ?? []), ...(cache?.tribe ?? [])]
        .sort(byStrength)
        .slice(0, NETWORK_OVERLAY_CAP);
      const opposed = [...(cache?.inverse ?? []), ...(cache?.opp ?? [])]
        .sort(byStrength)
        .slice(0, NETWORK_OVERLAY_CAP);
      tribeRel = aligned[0]?.relationship === "twin" ? "twin" : "tribe";
      oppRel = opposed[0]?.relationship === "inverse" ? "inverse" : "opp";
      // Judged on the WHOLE bucket, not the capped overlay slice: whether a
      // mode is worth offering is a question about the viewer's network, not
      // about how many of them this feed page happened to look at.
      modes = availableModes({
        aligned: [...(cache?.closest ?? []), ...(cache?.tribe ?? [])],
        opposed: [...(cache?.inverse ?? []), ...(cache?.opp ?? [])],
      });

      const alignedBy = new Map(aligned.map((e) => [e.wallet.toLowerCase(), e]));
      const opposedBy = new Map(opposed.map((e) => [e.wallet.toLowerCase(), e]));
      const focus = [...new Set([...alignedBy.keys(), ...opposedBy.keys()])];
      if (focus.length) {
        const ids = rows.map((r) => Number(r.onchain_id));
        for (const w of alignedBy.keys()) tribeWallets.add(w);
        for (const w of opposedBy.keys()) oppWallets.add(w);
        const [{ data: beliefs }, profiles] = await Promise.all([
          sb
            .from("wallet_beliefs")
            // `last_trade_at` is THEIR recency, which is what a Tribe or Rivals
            // ordering means by "recent" — not the market's own last trade,
            // which could be anyone.
            // No stance filter: a belief row at all means they traded here, and
            // "where has my Tribe been" has to include the ones who have since
            // gone flat. The face piles below still take directional stances
            // only, so wash activity cannot put anyone in a sentence.
            .select("wallet, onchain_id, stance_side, last_trade_at")
            .in("wallet", focus)
            .in("onchain_id", ids),
          import("@/lib/profiles.server").then((m) => m.resolveProfiles(focus, focus.length)),
        ]);

        const person = (w: string, score: number): MatchPerson => {
          const prof = profiles.get(w.toLowerCase());
          return {
            wallet: w,
            name: prof?.displayName ?? aliasFor(w),
            pfpUrl: prof?.pfpUrl ?? null,
            score: Math.round(score),
          };
        };

        for (const b of beliefs ?? []) {
          const w = String(b.wallet).toLowerCase();
          const id = Number(b.onchain_id);
          const raw = b.stance_side;
          const side = raw === "YES" || raw === "NO" ? (raw as "YES" | "NO") : null;
          const at = b.last_trade_at ? Date.parse(String(b.last_trade_at)) : NaN;
          if (Number.isFinite(at)) netRecency.set(id, Math.max(netRecency.get(id) ?? 0, at));
          const a = alignedBy.get(w);
          if (a) {
            tribeTouched.add(id);
            if (side) {
              const list = tribeHere.get(id) ?? [];
              list.push({ ...person(w, a.agreement), side });
              tribeHere.set(id, list);
              // The lead's side stays the group's headline side, so the existing
              // "your Tribe is backing X" copy keeps meaning what it meant.
              if (!tribeBySide.has(id) || w === aligned[0]?.wallet.toLowerCase())
                tribeBySide.set(id, side);
              // Depth of the relationship, summed over the people actually here.
              // Same-side history for allies, opposite-side for rivals: the honest
              // measure of each, and what Tribe/Rivals rank on.
              tribeOverlap.set(id, (tribeOverlap.get(id) ?? 0) + (a.sameSideBeliefs ?? 0));
            }
          }
          const o = opposedBy.get(w);
          if (o) {
            oppTouched.add(id);
            if (side) {
              const list = oppHere.get(id) ?? [];
              list.push({ ...person(w, o.agreement), side });
              oppHere.set(id, list);
              if (!oppBySide.has(id) || w === opposed[0]?.wallet.toLowerCase())
                oppBySide.set(id, side);
              oppOverlap.set(id, (oppOverlap.get(id) ?? 0) + (o.oppositeSideBeliefs ?? 0));
            }
          }
        }

        // Strongest first within each market, so a face pile or a named sentence
        // leads with the person the viewer has the clearest relationship to.
        for (const list of tribeHere.values()) list.sort((x, y) => y.score - x.score);
        for (const list of oppHere.values()) list.sort((x, y) => y.score - x.score);

        if (aligned[0]) tribePerson = person(aligned[0].wallet, aligned[0].agreement);
        if (opposed[0]) oppPerson = person(opposed[0].wallet, opposed[0].agreement);
      }
    }

    const mapped = rows.map((r) => {
      const id = Number(r.onchain_id);
      const y = yesEth.get(id) ?? 0;
      const n = noEth.get(id) ?? 0;
      const yesUsd = ethUsd > 0 ? y * ethUsd : null;
      const noUsd = ethUsd > 0 ? n * ethUsd : null;

      // Narrative layer: your network active in THIS market → named faces. Only
      // the viewer's OWN people are ever named; the crowd stays a count.
      const rr = r as Record<string, unknown>;
      /** Who wrote the question — a connection in its own right. */
      const author = String(
        ((rr["markets"] ?? null) as { author_wallet?: string | null } | null)?.author_wallet ?? "",
      ).toLowerCase();
      const network: NetworkFace[] = [];
      // Everyone present, not just the lead — `composeMarketStory` caps the pile
      // itself, and handing it one face when four are here was the reason a card
      // could never say how many of your people were in a market. Each face
      // carries its OWN side.
      for (const p of tribeHere.get(id) ?? [])
        network.push({
          wallet: p.wallet,
          name: p.name ?? aliasFor(p.wallet),
          avatarUrl: p.pfpUrl,
          relationship: tribeRel,
          side: p.side,
        });
      for (const p of oppHere.get(id) ?? [])
        network.push({
          wallet: p.wallet,
          name: p.name ?? aliasFor(p.wallet),
          avatarUrl: p.pfpUrl,
          relationship: oppRel,
          side: p.side,
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
        // How many of the viewer's own people are here. The overlay has always
        // known; until it stopped reading only the first entry of each bucket,
        // it had no way to say.
        tribe_count: tribeHere.get(id)?.length ?? 0,
        opp_count: oppHere.get(id)?.length ?? 0,
        // Filter-only: has one of these people been here AT ALL — traded, or
        // written the question. Authorship counts even with no position, which
        // is the whole point of "markets they created or interacted with".
        tribe_touched: tribeTouched.has(id) || (!!author && tribeWallets.has(author)),
        opp_touched: oppTouched.has(id) || (!!author && oppWallets.has(author)),
        tribe_overlap: tribeOverlap.get(id) ?? 0,
        opp_overlap: oppOverlap.get(id) ?? 0,
        network_last_at: netRecency.get(id) ?? null,
        // Lifetime reach and activity span, from the same RPC the search index
        // reads — so the Feed List and a search result describe one market with
        // one set of numbers.
        participants: reach.get(id)?.participants ?? 0,
        first_activity_at: reach.get(id)?.first ?? null,
        last_activity_at: reach.get(id)?.last ?? null,
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
      modes,
    };
  });

// Base read-model shape for one market — everything the center deck needs to
// render (prices, believers, capital, momentum, identity). Windowed volume, the
// story beats and viewer DNA are feed-only enrichments the deck degrades without.
const MARKET_ROW_SELECT = `
  onchain_id, yes_price_usd, no_price_usd, money_yes_pct, people_yes_pct, people_no_pct,
  believers_yes, believers_no, believers_mixed, directional_believers, divergence,
  volume_total_usd, trending_score,
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
    const reach = new Map<
      number,
      { participants: number; first: number | null; last: number | null }
    >();
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
        firstActivityAt:
          r2?.first ?? (r.market_created_at ? Date.parse(r.market_created_at) : null),
        lastActivityAt: r2?.last ?? lastTrade,
        joined24h: num(r.new_believers_24h),
        // A soft 0–1 liveness weight: recent trades and standing conviction.
        interest: Math.min(
          1,
          num(r.trade_count_24h) / 20 +
            participantsWeight(r2?.participants ?? 0) +
            Math.min(0.3, capitalUsd / 5_000),
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
      index.map((r) => ({
        id: r.onchain_id,
        title: r.title,
        category: r.category,
        interest: r.interest,
      })),
      data.limit ?? 8,
    );
    const byId = new Map(index.map((r) => [r.onchain_id, r]));
    return ranked
      .map((s) => byId.get(s.id))
      .filter((r): r is IndexRow => Boolean(r))
      .map(({ category: _c, interest: _i, ...hit }) => hit);
  });

/**
 * A face in a search result: a real person who put money behind this question.
 * `known` means the viewer's own Conviction DNA already relates them — the
 * single strongest reason to click a result.
 */
export interface MarketFace {
  wallet: string;
  name: string;
  avatarUrl: string | null;
  known: boolean;
}

export interface MarketFaces {
  faces: MarketFace[];
  /** Faces drawn from the viewer's network (subset of `faces`). */
  knownCount: number;
}

/**
 * Social proof for a page of search results.
 *
 * A colored status label decorates; a face persuades. For the handful of
 * markets currently on screen we return up to three participants, ranked so
 * people the viewer already relates to come first and, after them, the largest
 * standing positions. Only people with a real POV identity are returned —
 * generic placeholder avatars would be decoration, which is exactly what this
 * replaces.
 */
export const getMarketFaces = createServerFn({ method: "GET" })
  .inputValidator((d: { ids: number[]; wallet?: string }) =>
    z
      .object({
        ids: z.array(z.number().int().nonnegative()).max(12),
        wallet: z.string().min(3).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<Record<number, MarketFaces>> => {
    const ids = [...new Set(data.ids)];
    if (ids.length === 0) return {};
    const sb = serviceClient();

    const { data: rows } = await sb
      .from("wallet_beliefs")
      .select("wallet, onchain_id, yes_value_usd, no_value_usd")
      .in("onchain_id", ids)
      .in("stance_side", ["YES", "NO"])
      .limit(1000);

    // The viewer's own network — the only thing that makes a face meaningful
    // rather than merely present.
    const known = new Set<string>();
    if (data.wallet) {
      try {
        const { readViewerDnaCache } = await import("@/lib/dna/viewer-dna-cache.server");
        const cache = await readViewerDnaCache(sb, data.wallet.toLowerCase());
        for (const bucket of [cache?.twin, cache?.tribe, cache?.closest, cache?.opp] as const)
          for (const r of bucket ?? []) known.add(r.wallet.toLowerCase());
      } catch {
        /* no network yet — fall back to biggest positions */
      }
    }

    const byMarket = new Map<number, Array<{ wallet: string; value: number; known: boolean }>>();
    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      const id = Number(r.onchain_id);
      const wallet = String(r.wallet).toLowerCase();
      const value =
        Math.max(0, Number(r.yes_value_usd) || 0) + Math.max(0, Number(r.no_value_usd) || 0);
      const list = byMarket.get(id) ?? [];
      list.push({ wallet, value, known: known.has(wallet) });
      byMarket.set(id, list);
    }

    // Shortlist first, resolve identities once: a search keystroke must not turn
    // into hundreds of profile lookups.
    const shortlist = new Map<number, Array<{ wallet: string; known: boolean }>>();
    const wanted = new Set<string>();
    for (const [id, list] of byMarket) {
      list.sort((a, b) => (a.known === b.known ? b.value - a.value : a.known ? -1 : 1));
      const top = list.slice(0, 5);
      shortlist.set(
        id,
        top.map((t) => ({ wallet: t.wallet, known: t.known })),
      );
      for (const t of top) wanted.add(t.wallet);
    }
    if (wanted.size === 0) return {};

    const { resolveProfiles } = await import("@/lib/profiles.server");
    const profiles = await resolveProfiles([...wanted], 8);

    const out: Record<number, MarketFaces> = {};
    for (const [id, list] of shortlist) {
      const faces: MarketFace[] = [];
      for (const t of list) {
        const p = profiles.get(t.wallet);
        // No POV identity → no face. Anonymous circles are noise.
        if (!p || (!p.displayName && !p.pfpUrl)) continue;
        faces.push({
          wallet: t.wallet,
          name: p.displayName ?? aliasFor(t.wallet),
          avatarUrl: p.pfpUrl ?? null,
          known: t.known,
        });
        if (faces.length === 3) break;
      }
      if (faces.length > 0) out[id] = { faces, knownCount: faces.filter((f) => f.known).length };
    }
    return out;
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
 * without refetching. The change is derived by the one producer (window-change.server)
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
          "onchain_id, yes_price_usd, no_price_usd, believers_yes, believers_no, new_believers_yes_24h, new_believers_no_24h, live_line, live_line_kind, live_line_occurred_at",
        )
        .in("onchain_id", ids);
      for (const s of st ?? [])
        stateById.set(Number(s.onchain_id), {
          yes_price_usd: s.yes_price_usd == null ? null : Number(s.yes_price_usd),
          no_price_usd: s.no_price_usd == null ? null : Number(s.no_price_usd),
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

    // Window-scoped price moves, from the SAME single producer the market cards
    // and the market panels use (src/lib/window-change.server), so no two
    // surfaces can quote a different percentage for one market and window.
    const win: VolumeWindow = data.window ?? "24h";
    const chgYes = new Map<number, number>();
    const chgNo = new Map<number, number>();
    if (ids.length) {
      const stateRows = ids.map((id) => {
        const s = stateById.get(id);
        return {
          onchain_id: id,
          believers_yes: s?.believers_yes ?? null,
          believers_no: s?.believers_no ?? null,
          yes_price_usd: s?.yes_price_usd ?? null,
          no_price_usd: s?.no_price_usd ?? null,
        };
      });
      const chg = await loadWindowChanges(sb, stateRows, win);
      for (const id of ids) {
        const c = chg.byId.get(id);
        const y = pricePct(c, "YES");
        const n = pricePct(c, "NO");
        if (y != null) chgYes.set(id, y);
        if (n != null) chgNo.set(id, n);
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
