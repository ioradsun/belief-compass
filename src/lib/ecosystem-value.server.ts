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
 * SCOPE — every trading figure here is a trade conviction.company actually sent.
 * The contract takes no referrer, so that fact exists nowhere on-chain; we record
 * the tx hash at submit time (conviction_trades) and the conviction_attributed_value
 * RPC joins the canonical events log to those hashes. Nothing is inferred from
 * wallets: a trade counts only if we can prove we routed it, on any market, pov- or
 * conviction-born. Attribution therefore begins the day it shipped — earlier trades
 * are unrecoverable and are NOT estimated.
 *
 * "Markets Created" is the one supply-side figure: markets born on conviction.company
 * (markets.source = 'conviction'), which is unambiguously Conviction's own.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { readEthUsd } from "@/lib/eth-usd.server";
import { swrCache } from "@/lib/server-cache";
import { weiToEth } from "@/domain/money";
import {
  buildShare,
  type EcosystemShare,
  type ShareRpc,
  type SharePoint,
} from "@/domain/ecosystem-share";
import { marketTitle } from "@/domain/market-title";

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
  /** The rate this row was priced at. Null when unpriced — never 0. */
  ethUsd: number | null;
  amountEth: number;
  at: string;
}

export type { SharePoint, EcosystemShare };

export interface EcosystemValue {
  /**
   * The rate every USD figure here was computed with — NULL when we could not
   * price. A whole-payload signal, because these figures are all this one number
   * times an ETH figure; they are one unknown, not many.
   */
  ethUsd: number | null;
  /** When trade attribution started; null before the first recorded trade. */
  since: string | null;
  /** The headline story: how much of the whole market Conviction accounts for. */
  share: EcosystemShare | null;
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

// The shape conviction_attributed_value returns (money fields are wei strings —
// numeric sums exceed JS safe-integer range, so we parse then scale by 1e18).
interface AttributedValue {
  trades: number;
  buys: number;
  traders: number;
  buyWei: string;
  /** When attribution started — null until the first trade is recorded. */
  since: string | null;
  perMarket: Array<{ marketId: string; trades: number; buyWei: string }>;
  byDay: Array<{ day: string; trades: number; buyWei: string }>;
  recent: Array<{
    marketId: string;
    wallet: string;
    side: string | null;
    action: string | null;
    amountEth: string;
    at: string;
  }>;
}

const SHARE_DAYS = 90;

async function build(): Promise<EcosystemValue> {
  const sb = serviceClient();

  const [ethUsdRate, rpc, shareRpc, { count: convictionMarkets }] = await Promise.all([
    readEthUsd(sb),
    sb.rpc("conviction_attributed_value", { p_growth_days: GROWTH_DAYS }),
    sb.rpc("conviction_ecosystem_share", { p_days: SHARE_DAYS }),
    // "Markets Created" — the one supply-side figure: markets born on conviction.company.
    sb
      .from("markets")
      .select("onchain_id", { count: "exact", head: true })
      .eq("source", "conviction"),
  ]);
  // Null when unpriced. Every USD figure on the report card is this rate times
  // an ETH figure, so a zero here would publish "the ecosystem is worth $0".
  /**
   * Null when unpriced. Every USD figure on this report card is this one rate
   * times an ETH figure, so a zero would publish "the ecosystem is worth $0" —
   * a page-level state, not a field-level unknown. `ethUsd: null` in the payload
   * is the signal; the zero below is the one documented place it enters and is
   * never rendered on its own.
   */
  const ethUsd = ethUsdRate;
  const rate = ethUsdRate ?? 0;
  const share = buildShare(
    (shareRpc.data ?? null) as ShareRpc | null,
    rate,
    Date.now(),
    SHARE_DAYS,
  );

  // If the RPC isn't present yet (migration not applied), degrade to honest zeros
  // rather than crash or fall back to numbers we can't attribute.
  const cv = (rpc.data ?? null) as AttributedValue | null;
  if (!cv) {
    return {
      ethUsd,
      since: null,
      share,
      totals: {
        volumeUsd: 0,
        marketsCreated: convictionMarkets ?? 0,
        tradesExecuted: 0,
        activeTraders: 0,
      },
      categories: [],
      markets: [],
      growth: [],
      recentActivity: [],
    };
  }

  const volumeUsd = weiToEth(cv.buyWei) * rate;

  // Market metadata (title/category/author) for every market we routed a trade on —
  // works for pov- and conviction-born markets alike, since `markets` holds both.
  const marketIds = cv.perMarket.map((p) => Number(p.marketId)).filter((n) => Number.isFinite(n));
  const metaById = new Map<
    number,
    {
      title: string | null;
      category: string | null;
      author_wallet: string | null;
      author_name: string | null;
    }
  >();
  if (marketIds.length) {
    const { data: meta } = await sb
      .from("markets")
      .select("onchain_id, title, category, author_wallet, author_name")
      .in("onchain_id", marketIds)
      .limit(5000);
    for (const m of (meta ?? []) as Array<{
      onchain_id: number | string;
      title: string | null;
      category: string | null;
      author_wallet: string | null;
      author_name: string | null;
    }>)
      metaById.set(Number(m.onchain_id), m);
  }

  const markets: MarketStat[] = cv.perMarket
    .map((p) => {
      const id = Number(p.marketId);
      const meta = metaById.get(id);
      return {
        onchainId: id,
        title: marketTitle(meta?.title, id),
        category: meta?.category ?? null,
        authorWallet: meta?.author_wallet ?? null,
        authorName: meta?.author_name ?? null,
        volumeUsd: weiToEth(p.buyWei) * rate,
        trades: num(p.trades),
      };
    })
    .sort((a, b) => b.volumeUsd - a.volumeUsd);

  // Categories — aggregated from the trades we routed.
  const catMap = new Map<
    string,
    { markets: number; volumeUsd: number; trades: number; creators: Set<string> }
  >();
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
    .map(([category, e]) => ({
      category,
      markets: e.markets,
      volumeUsd: e.volumeUsd,
      trades: e.trades,
      creators: e.creators.size,
    }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd);

  // Growth — cumulative buy volume + trades per UTC day over the window.
  const byDay = new Map<string, { vol: number; trades: number }>();
  for (const d of cv.byDay)
    byDay.set(d.day, { vol: weiToEth(d.buyWei) * rate, trades: num(d.trades) });
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

  // Recent activity — the newest trades we routed, with titles.
  const recentActivity: ActivityItem[] = cv.recent.map((r) => {
    const mid = Number(r.marketId);
    return {
      key: `${r.wallet}:${mid}:${r.at}`,
      kind: "trade",
      side: r.side === "YES" || r.side === "NO" ? r.side : null,
      action: r.action === "BUY" || r.action === "SELL" ? r.action : null,
      marketId: mid,
      title: marketTitle(metaById.get(mid)?.title, mid),
      ethUsd,
      amountEth: weiToEth(r.amountEth),
      at: r.at,
    };
  });

  return {
    ethUsd,
    since: cv.since ?? null,
    share,
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
