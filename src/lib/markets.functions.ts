/**
 * Public server functions used by the client. No auth required —
 * these read public tables via the publishable key.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchPovPositions } from "@/lib/pov.server";
import { publicClient, serviceClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { readLatestTradeEvents } from "@/lib/events.functions";
import { toLegacyFeedEventRow } from "@/lib/events";
import { composeMarketStory, type NetworkFace, type NetworkLabel } from "@/domain/story";

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
    if (error)
      return {
        data: [],
        error: error.message,
        window: (input?.window ?? "24h") as VolumeWindow,
        ethUsd: 0,
        historyFrom: null as string | null,
        tribe: null as MatchPerson | null,
        opp: null as MatchPerson | null,
      };

    const rows = data ?? [];

    // Viewer-relative: is the viewer's closest match (tribe) or most-opposed
    // wallet (opp) among the believers of each market, and on which side?
    const viewer = input?.wallet?.toLowerCase() ?? null;
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

    // Per-side volume, first principles: YES and NO are separate books, so we sum
    // the actual on-chain ETH notional traded on each side inside the selected
    // window and convert to USD with a calibration derived from POV's own totals
    // (Σ reported USD volume / Σ observed ETH volume).
    const win: VolumeWindow = input?.window ?? "24h";
    const ms = VOLUME_WINDOWS[win];
    const since = ms == null ? null : new Date(Date.now() - ms).toISOString();
    const ids = rows.map((r) => Number(r.onchain_id));
    const yesEth = new Map<number, number>();
    const noEth = new Map<number, number>();
    const yesTrades = new Map<number, number>();
    const noTrades = new Map<number, number>();
    let ethUsd = 0;
    // Window-scoped price moves: first snapshot inside the window vs the latest.
    const chgYes = new Map<number, number>();
    const chgNo = new Map<number, number>();
    let historyFrom: string | null = null;
    if (ids.length) {
      // Perf: window price-moves and the ETH/USD calibration are PRECOMPUTED by
      // cron (market_window_change / calc_cache). Reading them is two indexed
      // lookups instead of two multi-second aggregate scans per request.
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
        if (c.since_at && (historyFrom == null || c.since_at < historyFrom))
          historyFrom = c.since_at;
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
  unique_wallets_24h, circulation_24h, last_trade_at, velocity_5m,
  live_line, live_line_kind, live_line_window, live_line_occurred_at,
  opportunity_type, opportunity_score, opportunity_reason, opportunity_reason_code,
  opportunity_window, opportunity_confidence, opportunity_sample_size, opportunity_eligible,
  markets:onchain_id ( title, category, author_name, author_pfp, pov_slug )
`;

export interface MarketSearchHit {
  onchain_id: number;
  title: string;
  category: string | null;
  believers: number;
  yesPrice: number | null;
}

/** Escape ilike wildcards so user input matches literally. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/**
 * Full-catalog market search, ranked by INTENT: title prefix-matches first (you
 * usually type the start of what you mean), then the most-alive market (directional
 * believers) so the hottest match surfaces. Covers every market, not just the
 * loaded feed slice — so anything you can name, you can open.
 */
export const searchMarkets = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string; limit?: number }) =>
    z.object({ query: z.string(), limit: z.number().int().min(1).max(20).optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<MarketSearchHit[]> => {
    const term = data.query.trim();
    if (term.length < 2) return [];
    const sb = serviceClient();
    const like = `%${escapeLike(term)}%`;
    const { data: rows } = await sb
      .from("market_state")
      .select(
        "onchain_id, believers_yes, believers_no, yes_price_usd, markets:onchain_id!inner ( title, category )",
      )
      .ilike("markets.title", like)
      .order("directional_believers", { ascending: false, nullsFirst: false })
      .limit(40);

    const lower = term.toLowerCase();
    const hits = (
      (rows ?? []) as unknown as Array<{
        onchain_id: number;
        believers_yes: number | null;
        believers_no: number | null;
        yes_price_usd: number | null;
        markets: { title: string | null; category: string | null } | null;
      }>
    )
      .map((r) => {
        const title = r.markets?.title ?? "";
        return {
          onchain_id: Number(r.onchain_id),
          title,
          category: r.markets?.category ?? null,
          believers: (Number(r.believers_yes) || 0) + (Number(r.believers_no) || 0),
          yesPrice: r.yes_price_usd == null ? null : Number(r.yes_price_usd),
          _prefix: title.toLowerCase().startsWith(lower) ? 1 : 0,
        };
      })
      // Prefix matches win; within a tier, the most-backed market first.
      .sort((a, b) => b._prefix - a._prefix || b.believers - a.believers)
      .slice(0, data.limit ?? 8);
    return hits.map(({ _prefix, ...h }) => h);
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

export interface MarketChange {
  yesPrice: number | null;
  noPrice: number | null;
  /** Per-window price % change (first snapshot in window → latest). */
  windows: Partial<Record<VolumeWindow, { yes: number | null; no: number | null }>>;
}

const numOrNull = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

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
    const sb = serviceClient();
    const [state, changes] = await Promise.all([
      sb
        .from("market_state")
        .select("yes_price_usd, no_price_usd")
        .eq("onchain_id", data.id)
        .maybeSingle(),
      sb
        .from("market_window_change")
        .select("window_key, chg_yes, chg_no")
        .eq("onchain_id", data.id),
    ]);
    const windows: MarketChange["windows"] = {};
    for (const c of (changes.data ?? []) as {
      window_key: string;
      chg_yes: number | null;
      chg_no: number | null;
    }[]) {
      windows[c.window_key as VolumeWindow] = {
        yes: numOrNull(c.chg_yes),
        no: numOrNull(c.chg_no),
      };
    }
    const s = state.data as { yes_price_usd: number | null; no_price_usd: number | null } | null;
    return { yesPrice: numOrNull(s?.yes_price_usd), noPrice: numOrNull(s?.no_price_usd), windows };
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
    const sb = publicClient();
    // Canonical trade activity from the events log, adapted to the legacy row
    // shape the pulse strips are built from.
    const facts = await readLatestTradeEvents(sb, { marketIds: ids, limit: 1200 });
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
        yes_shares, no_shares, first_backed_at,
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
          "onchain_id, yes_price_usd, no_price_usd, chg_24h_yes, chg_24h_no, live_line, live_line_kind, live_line_occurred_at",
        )
        .in("onchain_id", ids);
      for (const s of st ?? [])
        stateById.set(Number(s.onchain_id), {
          yes_price_usd: s.yes_price_usd == null ? null : Number(s.yes_price_usd),
          no_price_usd: s.no_price_usd == null ? null : Number(s.no_price_usd),
          chg_24h_yes: s.chg_24h_yes == null ? null : Number(s.chg_24h_yes),
          chg_24h_no: s.chg_24h_no == null ? null : Number(s.chg_24h_no),
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

    const positions = (rows ?? []).map((r) => ({
      ...r,
      yes_shares: povValue.get(Number(r.onchain_id))?.yesShares ?? r.yes_shares,
      no_shares: povValue.get(Number(r.onchain_id))?.noShares ?? r.no_shares,
      yes_value_usd:
        povValue.get(Number(r.onchain_id))?.yes ??
        (r.yes_value_usd == null ? null : Number(r.yes_value_usd)),
      no_value_usd:
        povValue.get(Number(r.onchain_id))?.no ??
        (r.no_value_usd == null ? null : Number(r.no_value_usd)),
      markets: metaById.get(Number(r.onchain_id)) ?? null,
      state: stateById.get(Number(r.onchain_id)) ?? null,
      chg_window_yes: chgYes.get(Number(r.onchain_id)) ?? null,
      chg_window_no: chgNo.get(Number(r.onchain_id)) ?? null,
    }));
    return { wallet, positions, window: win };
  });
