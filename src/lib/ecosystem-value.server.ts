/**
 * Ecosystem value aggregation — the data behind conviction.company/value.
 *
 * A public "report card" proving the measurable value Conviction Company creates
 * for the POV ecosystem. Everything here is REAL and already indexed: market_state
 * (the refresher's per-market aggregates), markets (attribution + category), and
 * the canonical events log (activity + growth). Fee/earnings money is derived on
 * the client from the contract's own fee rate + per-market creator fees, so no
 * number is invented. SWR-cached — every visitor reads one warm snapshot.
 *
 * SCOPE — this page measures the value that flows through wallets CONNECTED to
 * conviction.company, not the whole POV ecosystem. A connected wallet is either
 * side of a wallet_links row (the conviction sign-in wallet, or the pov.co trading
 * wallet the user linked). Buy value, fees, trades, traders, growth and activity
 * all come from those wallets' trading across ANY market — a connected user backing
 * a pov-only market is still value Conviction brought. The heavy join lives in the
 * conviction_connected_value RPC (rides events_wallet_idx); we only join market
 * metadata (titles/categories/authors) and derive money on the client here.
 *
 * "Markets Created" is the one supply-side figure: markets born on conviction.company
 * (markets.source = 'conviction'), which is unambiguously Conviction's own.
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

// The shape conviction_connected_value returns (money fields are wei strings —
// numeric sums exceed JS safe-integer range, so we parse then scale by 1e18).
interface ConnectedValue {
  connectedWallets: number;
  trades: number;
  buys: number;
  traders: number;
  buyWei: string;
  perMarket: Array<{ marketId: string; trades: number; buyWei: string }>;
  byDay: Array<{ day: string; trades: number; buyWei: string }>;
  recent: Array<{ marketId: string; wallet: string; side: string | null; action: string | null; amountEth: string; at: string }>;
}

const weiToEth = (wei: string | null | undefined): number => num(wei) / 1e18;

async function build(): Promise<EcosystemValue> {
  const sb = serviceClient();

  const [{ data: ethRow }, rpc, { count: convictionMarkets }] = await Promise.all([
    sb.from("calc_cache").select("value").eq("key", "eth_usd").maybeSingle(),
    sb.rpc("conviction_connected_value", { p_growth_days: GROWTH_DAYS }),
    // "Markets Created" — the one supply-side figure: markets born on conviction.company.
    sb.from("markets").select("onchain_id", { count: "exact", head: true }).eq("source", "conviction"),
  ]);
  const ethUsd = num((ethRow as { value?: number } | null)?.value);

  // If the RPC isn't present yet (migration not applied), degrade to honest zeros
  // rather than crash or leak whole-ecosystem numbers.
  const cv = (rpc.data ?? null) as ConnectedValue | null;
  if (!cv) {
    return {
      ethUsd,
      totals: { volumeUsd: 0, marketsCreated: convictionMarkets ?? 0, tradesExecuted: 0, activeTraders: 0 },
      categories: [],
      markets: [],
      growth: [],
      recentActivity: [],
    };
  }

  const volumeUsd = weiToEth(cv.buyWei) * ethUsd;

  // Market metadata (title/category/author) for every market these wallets traded —
  // works for pov- and conviction-born markets alike, since `markets` holds both.
  const marketIds = cv.perMarket.map((p) => Number(p.marketId)).filter((n) => Number.isFinite(n));
  const metaById = new Map<number, { title: string | null; category: string | null; author_wallet: string | null; author_name: string | null }>();
  if (marketIds.length) {
    const { data: meta } = await sb
      .from("markets")
      .select("onchain_id, title, category, author_wallet, author_name")
      .in("onchain_id", marketIds)
      .limit(5000);
    for (const m of (meta ?? []) as Array<{ onchain_id: number | string; title: string | null; category: string | null; author_wallet: string | null; author_name: string | null }>)
      metaById.set(Number(m.onchain_id), m);
  }

  const markets: MarketStat[] = cv.perMarket
    .map((p) => {
      const id = Number(p.marketId);
      const meta = metaById.get(id);
      return {
        onchainId: id,
        title: meta?.title ?? `Market #${id}`,
        category: meta?.category ?? null,
        authorWallet: meta?.author_wallet ?? null,
        authorName: meta?.author_name ?? null,
        volumeUsd: weiToEth(p.buyWei) * ethUsd,
        trades: num(p.trades),
      };
    })
    .sort((a, b) => b.volumeUsd - a.volumeUsd);

  // Categories — aggregated from the connected wallets' own trading.
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

  // Growth — cumulative buy volume + trades per UTC day over the window.
  const byDay = new Map<string, { vol: number; trades: number }>();
  for (const d of cv.byDay) byDay.set(d.day, { vol: weiToEth(d.buyWei) * ethUsd, trades: num(d.trades) });
  const growth: GrowthPoint[] = [];
  {
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

  // Recent activity — the connected wallets' newest trades, with titles.
  const recentActivity: ActivityItem[] = cv.recent.map((r) => {
    const mid = Number(r.marketId);
    return {
      key: `${r.wallet}:${mid}:${r.at}`,
      kind: "trade",
      side: r.side === "YES" || r.side === "NO" ? r.side : null,
      action: r.action === "BUY" || r.action === "SELL" ? r.action : null,
      marketId: mid,
      title: metaById.get(mid)?.title ?? `Market #${mid}`,
      ethUsd,
      amountEth: weiToEth(r.amountEth),
      at: r.at,
    };
  });

  return {
    ethUsd,
    totals: {
      volumeUsd,
      marketsCreated: convictionMarkets ?? 0,
      tradesExecuted: cv.trades,
      activeTraders: cv.traders,
    },
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
