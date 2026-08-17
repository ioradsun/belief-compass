/**
 * The wallet-shaped export. Admin-only: it is the whole trade ledger, keyed by
 * person rather than market.
 *
 * SOURCE. `events` is the one canonical trade table (`kind='trade'`,
 * `is_canonical`), and it includes trades on markets that were never titled —
 * excluding those would make concentration look better than it is.
 *
 * PRICING CAVEAT, STATED IN THE UI. Trades store `amount_eth`; there is no
 * per-trade USD stamp, so USD here is ETH repriced at TODAY's calibration.
 * July volume is therefore distorted by any rate move since July, and the page
 * says so rather than pretending otherwise.
 */
import { createServerFn } from "@tanstack/react-start";

export interface WalletAnalyticsPayload {
  rows: import("@/domain/wallet-analytics").WalletAnalyticsRow[];
  summary: import("@/domain/wallet-analytics").WalletAnalyticsSummary;
  ethUsd: number | null;
  ethUsdUpdatedAt: string | null;
  tradeCount: number;
  /** per-market side balances, for reconciling the displayed split. */
  splits: {
    marketId: number;
    holders: number;
    yesUsd: number;
    noUsd: number;
    splitPct: number | null;
    displayedYesPct: number | null;
  }[];
}

export const walletAnalytics = createServerFn({ method: "GET" }).handler(
  async (): Promise<WalletAnalyticsPayload> => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("@/lib/supabase-clients");
    const { readEthUsdReading } = await import("@/lib/eth-usd.server");
    const { foldWalletAnalytics, summarizeWalletAnalytics } = await import(
      "@/domain/wallet-analytics"
    );
    const db = serviceClient();

    const reading = await readEthUsdReading(db);
    const rate = reading.rate ?? 0;

    // Every canonical trade, paged — the fold needs the whole ledger.
    type Row = {
      wallet: string | null;
      market_id: string | null;
      action: string | null;
      amount_eth: string | number | null;
      occurred_at: string;
    };
    const all: Row[] = [];
    const PAGE = 1000;
    for (let from = 0; from < 100_000; from += PAGE) {
      const { data, error } = await db
        .from("events")
        .select("wallet, market_id, action, amount_eth, occurred_at")
        .eq("kind", "trade")
        .eq("is_canonical", true)
        .order("occurred_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as Row[];
      all.push(...page);
      if (page.length < PAGE) break;
    }

    const trades = all
      .filter((r) => r.wallet && r.market_id)
      .map((r) => ({
        wallet: String(r.wallet).toLowerCase(),
        marketId: String(r.market_id),
        isBuy: String(r.action ?? "").toUpperCase() !== "SELL",
        usd: Number(r.amount_eth ?? 0) * rate,
        at: Date.parse(r.occurred_at),
      }))
      .filter((t) => t.usd > 0 && Number.isFinite(t.at));

    const rows = foldWalletAnalytics(trades);

    // Per-side balances, so the displayed split can be reconciled against what
    // wallets actually hold.
    const [beliefs, states] = await Promise.all([
      db
        .from("wallet_beliefs")
        .select("onchain_id, yes_value_usd, no_value_usd, yes_shares, no_shares")
        .limit(20000),
      db.from("market_state").select("onchain_id, money_yes_pct").limit(20000),
    ]);
    const displayed = new Map<number, number | null>(
      (states.data ?? []).map((s) => [Number(s.onchain_id), s.money_yes_pct as number | null]),
    );
    const agg = new Map<number, { holders: number; yes: number; no: number }>();
    for (const b of beliefs.data ?? []) {
      const id = Number(b.onchain_id);
      const yes = Number(b.yes_value_usd ?? 0);
      const no = Number(b.no_value_usd ?? 0);
      if (!(Number(b.yes_shares ?? 0) > 0 || Number(b.no_shares ?? 0) > 0)) continue;
      const cur = agg.get(id) ?? { holders: 0, yes: 0, no: 0 };
      cur.holders += 1;
      cur.yes += Number.isFinite(yes) ? yes : 0;
      cur.no += Number.isFinite(no) ? no : 0;
      agg.set(id, cur);
    }
    const splits = [...agg.entries()]
      .map(([marketId, v]) => ({
        marketId,
        holders: v.holders,
        yesUsd: v.yes,
        noUsd: v.no,
        splitPct: v.yes + v.no > 0 ? (v.yes / (v.yes + v.no)) * 100 : null,
        displayedYesPct: displayed.get(marketId) ?? null,
      }))
      .sort((a, b) => b.yesUsd + b.noUsd - (a.yesUsd + a.noUsd))
      .slice(0, 100);

    return {
      rows,
      summary: summarizeWalletAnalytics(rows),
      ethUsd: reading.rate,
      ethUsdUpdatedAt: reading.updatedAt,
      tradeCount: trades.length,
      splits,
    };
  },
);
