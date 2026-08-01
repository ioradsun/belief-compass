/**
 * Conviction Dashboard aggregation — a storytelling layer over EXISTING data.
 *
 * No new accounting store. This reads what the app already indexes — positions
 * (wallet_beliefs), the global market read model (market_state), created-market
 * attribution (markets.author_wallet), and the canonical trade log (events) — and
 * shapes it into the story the dashboard tells. Creator fees are contract truth,
 * read on-chain by the client; everything here is indexed read-only.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { readWalletTradesAscending } from "@/lib/conviction-dashboard.trades.server";
import { realizedTradingEth, type DashTrade } from "@/domain/conviction-dashboard";

export interface DashboardBestMarket {
  onchainId: number;
  title: string;
  category: string | null;
  volumeUsd: number;
  trades: number;
}

export interface ConvictionDashboardData {
  wallet: string;
  ethUsd: number;
  holdings: {
    /** POV valuation of currently-held tokens (USD). */
    worthUsd: number;
    /** Remaining weighted-average cost basis (USD). */
    costUsd: number;
    /** worthUsd − costUsd (unrealized). */
    gainUsd: number;
    count: number;
  };
  trading: {
    /** Realized gain over all history (USD). */
    realizedUsd: number;
    /** Realized gain from trades that happened since local-agnostic UTC midnight. */
    realizedTodayUsd: number;
  };
  today: {
    /** Approx. 24h move of the held portfolio (USD). */
    portfolioUsd: number;
  };
  /** Markets this wallet created — attribution + volume/trades. Fees are on-chain. */
  createdMarkets: DashboardBestMarket[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function ethUsdRate(sb: ReturnType<typeof serviceClient>): Promise<number> {
  const { data } = await sb.from("calc_cache").select("value").eq("key", "eth_usd").maybeSingle();
  return num((data as { value?: number } | null)?.value) || 0;
}

/** ETH cost basis → USD (0 when unknown), matching the rest of the app. */
const costUsd = (ethCost: unknown, ethUsd: number): number => {
  const eth = num(ethCost);
  return eth > 0 && ethUsd > 0 ? eth * ethUsd : 0;
};

export async function buildConvictionDashboard(
  walletRaw: string,
): Promise<ConvictionDashboardData> {
  const wallet = walletRaw.toLowerCase();
  const sb = serviceClient();
  const ethUsd = await ethUsdRate(sb);

  // --- Holdings (unrealized) + today's portfolio move -----------------------
  const { data: beliefsData } = await sb
    .from("wallet_beliefs")
    .select("onchain_id, yes_cost, no_cost, yes_value_usd, no_value_usd")
    .eq("wallet", wallet)
    .limit(500);
  const beliefs = (beliefsData ?? []) as Array<{
    onchain_id: number | string;
    yes_cost: unknown;
    no_cost: unknown;
    yes_value_usd: unknown;
    no_value_usd: unknown;
  }>;

  const heldIds = Array.from(new Set(beliefs.map((b) => Number(b.onchain_id))));
  const chgById = new Map<number, { yes: number; no: number }>();
  if (heldIds.length) {
    const { data: st } = await sb
      .from("market_state")
      .select("onchain_id, chg_24h_yes, chg_24h_no")
      .in("onchain_id", heldIds);
    for (const s of st ?? [])
      chgById.set(Number(s.onchain_id), { yes: num(s.chg_24h_yes), no: num(s.chg_24h_no) });
  }

  let worthUsd = 0;
  let holdCostUsd = 0;
  let portfolioTodayUsd = 0;
  let heldCount = 0;
  for (const b of beliefs) {
    const yesWorth = num(b.yes_value_usd);
    const noWorth = num(b.no_value_usd);
    const w = yesWorth + noWorth;
    if (w > 0) heldCount++;
    worthUsd += w;
    holdCostUsd += costUsd(b.yes_cost, ethUsd) + costUsd(b.no_cost, ethUsd);
    const chg = chgById.get(Number(b.onchain_id));
    if (chg) {
      // A side worth W that moved p% over 24h contributed ~ W * p/(100+p) today.
      portfolioTodayUsd += yesWorth * (chg.yes / (100 + chg.yes));
      portfolioTodayUsd += noWorth * (chg.no / (100 + chg.no));
    }
  }

  // --- Realized trading (the one derived number; folded from trade history) --
  const trades = await readWalletTradesAscending(sb, wallet);
  const asDash = (rows: typeof trades): DashTrade[] =>
    rows
      .filter((t) => (t.side === "YES" || t.side === "NO") && (t.action === "BUY" || t.action === "SELL"))
      .map((t) => ({
        market: t.market_id ?? "",
        side: t.side as "YES" | "NO",
        action: t.action as "BUY" | "SELL",
        eth: num(t.amount_eth) / 1e18,
        tokens: num(t.shares),
      }));

  const realizedEth = realizedTradingEth(asDash(trades));
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const beforeToday = trades.filter((t) => t.occurred_at < startOfDay.toISOString());
  const realizedBeforeEth = realizedTradingEth(asDash(beforeToday));
  const realizedUsd = realizedEth * ethUsd;
  const realizedTodayUsd = (realizedEth - realizedBeforeEth) * ethUsd;

  // --- Created markets (attribution + volume + trades) ----------------------
  const { data: createdData } = await sb
    .from("markets")
    .select("onchain_id, title, category")
    .eq("author_wallet", wallet)
    .limit(200);
  const created = (createdData ?? []) as Array<{
    onchain_id: number | string;
    title: string | null;
    category: string | null;
  }>;
  const createdIds = created.map((m) => Number(m.onchain_id));

  const volById = new Map<number, number>();
  const tradesById = new Map<number, number>();
  if (createdIds.length) {
    const { data: st } = await sb
      .from("market_state")
      .select("onchain_id, volume_total_usd")
      .in("onchain_id", createdIds);
    for (const s of st ?? []) volById.set(Number(s.onchain_id), num(s.volume_total_usd));

    // All-time trade counts per created market, from the same precomputed RPC the
    // feed uses (p_since = null → lifetime).
    const vol = await sb.rpc("market_volume_window", { p_ids: createdIds, p_since: null });
    for (const t of (vol.data ?? []) as { onchain_id: number; trade_count: number }[]) {
      const id = Number(t.onchain_id);
      tradesById.set(id, (tradesById.get(id) ?? 0) + num(t.trade_count));
    }
  }

  const createdMarkets: DashboardBestMarket[] = created.map((m) => ({
    onchainId: Number(m.onchain_id),
    title: (m.title as string | null) ?? "Untitled market",
    category: (m.category as string | null) ?? null,
    volumeUsd: volById.get(Number(m.onchain_id)) ?? 0,
    trades: tradesById.get(Number(m.onchain_id)) ?? 0,
  }));

  return {
    wallet,
    ethUsd,
    holdings: {
      worthUsd,
      costUsd: holdCostUsd,
      gainUsd: worthUsd - holdCostUsd,
      count: heldCount,
    },
    trading: { realizedUsd, realizedTodayUsd },
    today: { portfolioUsd: portfolioTodayUsd },
    createdMarkets,
  };
}
