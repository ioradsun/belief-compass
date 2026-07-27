/**
 * Public server functions used by the client. No auth required —
 * these read public tables via the publishable key.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/conviction-feed";

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
      .parse(d ?? {}))
  .handler(async ({ data: input }) => {
  const sb = publicClient();

  const { data, error } = await sb
    .from("market_state")
    .select(
      `
      onchain_id, yes_price_usd, no_price_usd, money_yes_pct, people_yes_pct,
      believers_yes, believers_no, believers_mixed, divergence,
      volume_total_usd, trending_score, chg_1h, chg_24h, chg_24h_yes, chg_24h_no,
      yes_capital_usd, no_capital_usd,
      new_believers_1h, velocity_5m,
      markets:onchain_id ( title, category, author_name, author_pfp )
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
  let tribeBySide = new Map<number, "YES" | "NO">();
  let oppBySide = new Map<number, "YES" | "NO">();
  let tribePerson: MatchPerson | null = null;
  let oppPerson: MatchPerson | null = null;
  if (viewer && rows.length) {
    const { data: matches } = await sb
      .from("wallet_matches")
      .select("matched_wallet, match_score")
      .eq("wallet", viewer)
      .order("match_score", { ascending: false })
      .limit(50);
    const list = matches ?? [];
    const tribe = list[0] ?? null;
    const oppCand = list[list.length - 1] ?? null;
    const opp = oppCand && Number(oppCand.match_score) < 50 ? oppCand : null;
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
      const profiles = await resolveProfiles(focus.map((w) => w.toLowerCase()), 4);
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
    const [vol, cal, chg] = await Promise.all([
      sb.rpc("market_volume_window", { p_ids: ids, p_since: since }),
      sb.rpc("eth_usd_calibration"),
      sb.rpc("market_change_window", { p_ids: ids, p_since: since }),
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
    ethUsd = Number(cal.data ?? 0) || 0;
    for (const c of (chg.data ?? []) as {
      onchain_id: number;
      chg_yes: number | null;
      chg_no: number | null;
      since_at: string | null;
    }[]) {
      const id = Number(c.onchain_id);
      if (c.chg_yes != null && Number.isFinite(Number(c.chg_yes))) chgYes.set(id, Number(c.chg_yes));
      if (c.chg_no != null && Number.isFinite(Number(c.chg_no))) chgNo.set(id, Number(c.chg_no));
      if (c.since_at && (historyFrom == null || c.since_at < historyFrom)) historyFrom = c.since_at;
    }
  }

  const mapped = rows.map((r) => {
    const id = Number(r.onchain_id);
    const y = yesEth.get(id) ?? 0;
    const n = noEth.get(id) ?? 0;
    const yesUsd = ethUsd > 0 ? y * ethUsd : null;
    const noUsd = ethUsd > 0 ? n * ethUsd : null;
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
    };
  });

  // Rank by the volume actually being displayed so the table is self-consistent.
  mapped.sort((a, b) => (b.window_volume_usd ?? -1) - (a.window_volume_usd ?? -1));

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


/**
 * Per-market pulse strips: the most recent real trade events for each of the
 * given markets, so every card in the grid can run its own little live feed.
 */
export const listMarketPulses = createServerFn({ method: "GET" })
  .inputValidator((d: { ids: number[] }) =>
    z.object({ ids: z.array(z.number().int()).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const ids = data.ids;
    if (ids.length === 0) return { pulses: {} as Record<string, Pulse[]> };
    const sb = publicClient();
    const { data: rows, error } = await sb
      .from("feed_events")
      .select("onchain_id, wallet, type, side, payload, occurred_at, event_key")
      .in("onchain_id", ids)
      .order("occurred_at", { ascending: false })
      .limit(1200);
    if (error) return { pulses: {} as Record<string, Pulse[]> };

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





export const getMarket = createServerFn({ method: "GET" })
  .inputValidator((d: { onchain_id: number }) =>
    z.object({ onchain_id: z.number().int() }).parse(d),
  )
  .handler(async ({ data }) => {
    const sb = publicClient();
    const [state, market, believers, events] = await Promise.all([
      sb.from("market_state").select("*").eq("onchain_id", data.onchain_id).maybeSingle(),
      sb.from("markets").select("*").eq("onchain_id", data.onchain_id).maybeSingle(),
      sb
        .from("wallet_beliefs")
        .select("wallet, stance_side, stance, conviction, days_held, first_backed_at")
        .eq("onchain_id", data.onchain_id)
        .in("stance_side", ["YES", "NO"])
        .order("conviction", { ascending: false })
        .limit(50),
      sb
        .from("feed_events")
        .select("*")
        .eq("onchain_id", data.onchain_id)
        .order("occurred_at", { ascending: false })
        .limit(30),
    ]);
    return {
      state: state.data ?? null,
      market: market.data ?? null,
      believers: believers.data ?? [],
      events: events.data ?? [],
    };
  });

export const getWallet = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string }) => z.object({ wallet: z.string().min(3) }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const wallet = data.wallet.toLowerCase();
    // NOTE: there is no FK from wallet_beliefs.onchain_id -> markets, so the
    // market title/category must be fetched separately and stitched in.
    const { data: rows } = await sb
      .from("wallet_beliefs")
      .select(
        `
        onchain_id, expressed_side, stance_side, stance, conviction, days_held,
        yes_shares, no_shares, first_backed_at
      `,
      )
      .eq("wallet", wallet)
      .order("conviction", { ascending: false })
      .limit(200);

    const ids = Array.from(new Set((rows ?? []).map((r) => Number(r.onchain_id))));
    const metaById = new Map<number, { title: string | null; category: string | null }>();
    if (ids.length) {
      const { data: mk } = await sb
        .from("markets")
        .select("onchain_id, title, category")
        .in("onchain_id", ids);
      for (const m of mk ?? [])
        metaById.set(Number(m.onchain_id), {
          title: (m.title as string | null) ?? null,
          category: (m.category as string | null) ?? null,
        });
    }

    const positions = (rows ?? []).map((r) => ({
      ...r,
      markets: metaById.get(Number(r.onchain_id)) ?? null,
    }));
    return { wallet, positions };
  });


const CHAIN_DEPLOY_BLOCK = 45_500_000;

export const getIngestStatus = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const [markets, trades, beliefs, feedEvents, matches, mstate, ingest] = await Promise.all([
    sb.from("markets").select("*", { count: "exact", head: true }),
    sb.from("trades").select("*", { count: "exact", head: true }),
    sb.from("wallet_beliefs").select("*", { count: "exact", head: true }),
    sb.from("feed_events").select("*", { count: "exact", head: true }),
    sb.from("wallet_matches").select("*", { count: "exact", head: true }),
    sb.from("market_state").select("*", { count: "exact", head: true }).gt("believers_yes", 0),
    sb
      .from("ingest_state")
      .select("last_block, lease_owner, lease_expires_at")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  const latestTrade = await sb
    .from("trades")
    .select("block_number, ts")
    .order("block_number", { ascending: false })
    .order("log_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  let head: number | null = null;
  try {
    const rpc = await fetch("https://developer-access-mainnet.base.org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
    const j = await rpc.json();
    head = parseInt(j.result, 16);
  } catch {
    /* ignore */
  }

  const lastBlock = Number(ingest.data?.last_block ?? CHAIN_DEPLOY_BLOCK);
  const blocksBehind = head ? Math.max(0, head - lastBlock) : null;
  const chainPct = head
    ? Math.min(
        100,
        Math.max(0, ((lastBlock - CHAIN_DEPLOY_BLOCK) / (head - CHAIN_DEPLOY_BLOCK)) * 100),
      )
    : null;
  const leaseExpiresAt = ingest.data?.lease_expires_at
    ? new Date(ingest.data.lease_expires_at).getTime()
    : null;
  const leaseActive = Boolean(leaseExpiresAt && leaseExpiresAt > Date.now());

  return {
    markets: markets.count ?? 0,
    trades: trades.count ?? 0,
    beliefs: beliefs.count ?? 0,
    feedEvents: feedEvents.count ?? 0,
    matches: matches.count ?? 0,
    marketsWithBelievers: mstate.count ?? 0,
    chain: {
      deployBlock: CHAIN_DEPLOY_BLOCK,
      lastBlock,
      head,
      blocksBehind,
      progressPct: chainPct,
      phase: blocksBehind == null ? "checking" : blocksBehind <= 250 ? "live" : "backfilling",
      leaseActive,
      latestTradeBlock: latestTrade.data?.block_number ?? null,
      latestTradeAt: latestTrade.data?.ts ?? null,
    },
  };
});
