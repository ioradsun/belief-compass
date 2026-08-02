/**
 * Ecosystem value aggregation — the data behind conviction.company/value.
 *
 * A public "report card" proving the measurable value Conviction Company creates
 * for the POV ecosystem. Everything here is REAL and already indexed: market_state
 * (the refresher's per-market aggregates), markets (attribution + category), and
 * the canonical events log (activity + growth). Fee/earnings money is derived on
 * the client from the contract's own fee rate + per-market creator fees, so no
 * number is invented. SWR-cached — every visitor reads one warm snapshot.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { swrCache } from "@/lib/server-cache";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface CategoryStat {
  category: string;
  markets: number;
  volumeUsd: number;
  trades: number;
  creators: number;
}
export interface MarketStat {
  onchainId: number;
  title: string;
  category: string | null;
  authorWallet: string | null;
  authorName: string | null;
  volumeUsd: number;
  trades: number;
}
export interface GrowthPoint {
  day: string; // YYYY-MM-DD (UTC)
  volumeUsd: number; // cumulative
  trades: number; // cumulative
}
export interface ActivityItem {
  key: string;
  kind: "trade" | "market_created";
  side: "YES" | "NO" | null;
  action: "BUY" | "SELL" | null;
  marketId: number;
  title: string;
  ethUsd: number;
  amountEth: number;
  at: string;
}

export interface EcosystemValue {
  ethUsd: number;
  totals: {
    volumeUsd: number;
    marketsCreated: number;
    tradesExecuted: number;
    activeTraders: number;
  };
  categories: CategoryStat[];
  /** Every market with volume + trades — the client attributes on-chain earnings. */
  markets: MarketStat[];
  growth: GrowthPoint[];
  recentActivity: ActivityItem[];
}

const GROWTH_DAYS = 30;

async function build(): Promise<EcosystemValue> {
  const sb = serviceClient();

  const [{ data: ethRow }, { data: msData }] = await Promise.all([
    sb.from("calc_cache").select("value").eq("key", "eth_usd").maybeSingle(),
    sb
      .from("market_state")
      .select("onchain_id, volume_total_usd, markets:onchain_id ( title, category, author_wallet, author_name )")
      .order("volume_total_usd", { ascending: false, nullsFirst: false })
      .limit(2000),
  ]);
  const ethUsd = num((ethRow as { value?: number } | null)?.value);

  const rows = (msData ?? []) as Array<{
    onchain_id: number | string;
    volume_total_usd: unknown;
    markets: { title: string | null; category: string | null; author_wallet: string | null; author_name: string | null } | null;
  }>;
  const ids = rows.map((r) => Number(r.onchain_id));

  // Lifetime trade counts per market — the same precomputed RPC the feed uses.
  const tradesById = new Map<number, number>();
  if (ids.length) {
    const vol = await sb.rpc("market_volume_window", { p_ids: ids, p_since: null });
    for (const t of (vol.data ?? []) as { onchain_id: number; trade_count: number }[])
      tradesById.set(Number(t.onchain_id), (tradesById.get(Number(t.onchain_id)) ?? 0) + num(t.trade_count));
  }

  const markets: MarketStat[] = rows.map((r) => ({
    onchainId: Number(r.onchain_id),
    title: r.markets?.title ?? "Untitled market",
    category: r.markets?.category ?? null,
    authorWallet: r.markets?.author_wallet ?? null,
    authorName: r.markets?.author_name ?? null,
    volumeUsd: num(r.volume_total_usd),
    trades: tradesById.get(Number(r.onchain_id)) ?? 0,
  }));

  const volumeUsd = markets.reduce((s, m) => s + m.volumeUsd, 0);
  const tradesExecuted = markets.reduce((s, m) => s + m.trades, 0);

  // Categories.
  const catMap = new Map<string, { markets: number; volumeUsd: number; trades: number; creators: Set<string> }>();
  for (const m of markets) {
    const c = m.category ?? "Other";
    const e = catMap.get(c) ?? { markets: 0, volumeUsd: 0, trades: 0, creators: new Set<string>() };
    e.markets++;
    e.volumeUsd += m.volumeUsd;
    e.trades += m.trades;
    if (m.authorWallet) e.creators.add(m.authorWallet.toLowerCase());
    catMap.set(c, e);
  }
  const categories: CategoryStat[] = [...catMap.entries()]
    .map(([category, e]) => ({ category, markets: e.markets, volumeUsd: e.volumeUsd, trades: e.trades, creators: e.creators.size }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd);

  // Active traders — distinct wallets that have ever taken a position (bounded).
  let activeTraders = 0;
  {
    const { data: wb } = await sb.from("wallet_beliefs").select("wallet").limit(100_000);
    const set = new Set<string>();
    for (const r of (wb ?? []) as Array<{ wallet: string | null }>) if (r.wallet) set.add(r.wallet.toLowerCase());
    activeTraders = set.size;
  }

  // Growth — cumulative volume + trades per UTC day over the recent window.
  const growth: GrowthPoint[] = [];
  {
    const since = new Date(Date.now() - GROWTH_DAYS * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const { data: evs } = await sb
      .from("events")
      .select("occurred_at, amount_eth")
      .eq("is_canonical", true)
      .eq("kind", "trade")
      .gte("occurred_at", since.toISOString())
      .order("occurred_at", { ascending: true })
      .limit(50_000);
    const byDay = new Map<string, { vol: number; trades: number }>();
    for (const e of (evs ?? []) as Array<{ occurred_at: string; amount_eth: unknown }>) {
      const day = e.occurred_at.slice(0, 10);
      const d = byDay.get(day) ?? { vol: 0, trades: 0 };
      d.vol += (num(e.amount_eth) / 1e18) * ethUsd;
      d.trades += 1;
      byDay.set(day, d);
    }
    let cumV = 0;
    let cumT = 0;
    for (let i = GROWTH_DAYS; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 86_400_000);
      dt.setUTCHours(0, 0, 0, 0);
      const day = dt.toISOString().slice(0, 10);
      const d = byDay.get(day);
      if (d) {
        cumV += d.vol;
        cumT += d.trades;
      }
      growth.push({ day, volumeUsd: cumV, trades: cumT });
    }
  }

  // Recent activity seed — newest trades + created markets, with titles.
  const titleById = new Map<number, string>(markets.map((m) => [m.onchainId, m.title]));
  const recentActivity: ActivityItem[] = [];
  {
    const { data: evs } = await sb
      .from("events")
      .select("event_key:source_key, kind, side, action, market_id, amount_eth, occurred_at")
      .eq("is_canonical", true)
      .in("kind", ["trade", "market_created"])
      .order("occurred_at", { ascending: false })
      .limit(24);
    for (const e of (evs ?? []) as Array<{
      event_key: string;
      kind: string;
      side: string | null;
      action: string | null;
      market_id: string | null;
      amount_eth: unknown;
      occurred_at: string;
    }>) {
      const mid = Number(e.market_id);
      recentActivity.push({
        key: e.event_key,
        kind: e.kind === "market_created" ? "market_created" : "trade",
        side: e.side === "YES" || e.side === "NO" ? e.side : null,
        action: e.action === "BUY" || e.action === "SELL" ? e.action : null,
        marketId: mid,
        title: titleById.get(mid) ?? `Market #${mid}`,
        ethUsd,
        amountEth: num(e.amount_eth) / 1e18,
        at: e.occurred_at,
      });
    }
  }

  return {
    ethUsd,
    totals: { volumeUsd, marketsCreated: markets.length, tradesExecuted, activeTraders },
    categories,
    markets,
    growth,
    recentActivity,
  };
}

/** SWR-cached snapshot — every visitor reads one warm copy. */
export function buildEcosystemValue(): Promise<EcosystemValue> {
  return swrCache("ecosystem:value", { ttlMs: 15_000 }, build);
}
