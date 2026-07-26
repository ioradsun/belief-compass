/**
 * Public server functions used by the client. No auth required —
 * these read public tables via the publishable key.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export const VOLUME_WINDOWS = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  all: null,
} as const;
export type VolumeWindow = keyof typeof VOLUME_WINDOWS;

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
    .select(`
      onchain_id, yes_price_usd, no_price_usd, money_yes_pct, people_yes_pct,
      believers_yes, believers_no, believers_mixed, divergence,
      volume_total_usd, trending_score, chg_1h, chg_24h, chg_24h_yes, chg_24h_no,
      yes_capital_usd, no_capital_usd,
      new_believers_1h, velocity_5m,
      markets:onchain_id ( title, category, author_name, author_pfp )
    `)
    .order("volume_total_usd", { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) return { data: [], error: error.message };
  const rows = data ?? [];

  // Viewer-relative: is the viewer's closest match (tribe) or most-opposed
  // wallet (opp) among the believers of each market, and on which side?
  const viewer = input?.wallet?.toLowerCase() ?? null;
  let tribeBySide = new Map<number, "YES" | "NO">();
  let oppBySide = new Map<number, "YES" | "NO">();
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
    }
  }

  // Per-side volume: YES and NO are separate perpetual books, so split the
  // market's total volume by the ETH notional traded on each side.
  const ids = rows.map((r) => Number(r.onchain_id));
  const yesEth = new Map<number, number>();
  const noEth = new Map<number, number>();
  if (ids.length) {
    const { data: trades } = await sb
      .from("trades")
      .select("onchain_id, side, eth_amount")
      .in("onchain_id", ids);
    for (const t of trades ?? []) {
      const id = Number(t.onchain_id);
      const amt = Number(t.eth_amount ?? 0);
      if (!Number.isFinite(amt)) continue;
      const m = t.side === "NO" ? noEth : yesEth;
      m.set(id, (m.get(id) ?? 0) + amt);
    }
  }

  return {
    data: rows.map((r) => {
      const id = Number(r.onchain_id);
      const y = yesEth.get(id) ?? 0;
      const n = noEth.get(id) ?? 0;
      const tot = y + n;
      const vol = Number(r.volume_total_usd ?? 0);
      return {
        ...r,
        yes_volume_usd: tot > 0 ? (vol * y) / tot : null,
        no_volume_usd: tot > 0 ? (vol * n) / tot : null,
        tribe_side: tribeBySide.get(id) ?? null,
        opp_side: oppBySide.get(id) ?? null,
      };
    }),
    error: null,
  };
});



export const getMarket = createServerFn({ method: "GET" })
  .inputValidator((d: { onchain_id: number }) =>
    z.object({ onchain_id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const [state, market, believers, events] = await Promise.all([
      sb.from("market_state").select("*").eq("onchain_id", data.onchain_id).maybeSingle(),
      sb.from("markets").select("*").eq("onchain_id", data.onchain_id).maybeSingle(),
      sb.from("wallet_beliefs").select("wallet, stance_side, stance, conviction, days_held, first_backed_at")
        .eq("onchain_id", data.onchain_id)
        .in("stance_side", ["YES", "NO"])
        .order("conviction", { ascending: false })
        .limit(50),
      sb.from("feed_events").select("*")
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
  .inputValidator((d: { wallet: string }) =>
    z.object({ wallet: z.string().min(3) }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const wallet = data.wallet.toLowerCase();
    const { data: positions } = await sb
      .from("wallet_beliefs")
      .select(`
        onchain_id, expressed_side, stance_side, stance, conviction, days_held,
        yes_shares, no_shares, first_backed_at,
        markets:onchain_id ( title, category )
      `)
      .eq("wallet", wallet)
      .order("conviction", { ascending: false })
      .limit(200);
    return { wallet, positions: positions ?? [] };
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
    sb.from("market_state")
      .select("*", { count: "exact", head: true })
      .gt("believers_yes", 0),
    sb.from("ingest_state").select("last_block, lease_owner, lease_expires_at").eq("id", 1).maybeSingle(),
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
  } catch { /* ignore */ }

  const lastBlock = Number(ingest.data?.last_block ?? CHAIN_DEPLOY_BLOCK);
  const blocksBehind = head ? Math.max(0, head - lastBlock) : null;
  const chainPct = head
    ? Math.min(100, Math.max(0, ((lastBlock - CHAIN_DEPLOY_BLOCK) / (head - CHAIN_DEPLOY_BLOCK)) * 100))
    : null;
  const leaseExpiresAt = ingest.data?.lease_expires_at ? new Date(ingest.data.lease_expires_at).getTime() : null;
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
