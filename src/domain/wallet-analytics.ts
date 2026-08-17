/**
 * WALLETS, NOT MARKETS.
 *
 * Every metric we ship is market-shaped, and a market cannot answer "is anyone
 * coming back?". This fold takes canonical trades and returns ONE ROW PER
 * WALLET: how many markets they touched, how long they stayed, what they put in
 * and took out, and the median seconds they held a market before closing it out.
 *
 * The median hold is the wash tell: a sell/buy ratio near 1.0 paired with holds
 * measured in minutes is round-tripping, not demand.
 *
 * Pure: no network, no clock. USD is applied by the caller so the reader can be
 * told whether the rate is "at trade time" or "today".
 */

export interface AnalyticsTrade {
  wallet: string;
  marketId: string;
  isBuy: boolean;
  usd: number;
  /** epoch milliseconds */
  at: number;
}

export interface WalletAnalyticsRow {
  wallet: string;
  marketsTraded: number;
  totalTrades: number;
  buyUsd: number;
  sellUsd: number;
  /** sell/buy — null when the wallet never bought. */
  sellBuyRatio: number | null;
  firstSeen: number;
  lastSeen: number;
  lifespanDays: number;
  /** distinct calendar days (UTC) on which the wallet opened a market. */
  activeDays: number;
  /** median seconds between first and last trade WITHIN a market. */
  medianHoldSecs: number;
}

export interface WalletAnalyticsSummary {
  wallets: number;
  medianMarketsTraded: number;
  repeatWallets: number;
  /** wallets with activeDays > 3 — the actual product-market-fit sample. */
  returningWallets: number;
  totalBuyUsd: number;
  /** share of buy volume held by the top ten wallets, 0..1. */
  top10BuyShare: number;
  /** ratio ≈ 1 and holds under an hour: the wash-shaped cohort. */
  washSuspectWallets: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const DAY_MS = 86_400_000;

export function foldWalletAnalytics(trades: AnalyticsTrade[]): WalletAnalyticsRow[] {
  // per wallet → per market
  type Cell = { first: number; last: number; buy: number; sell: number; n: number };
  const byWallet = new Map<string, Map<string, Cell>>();

  for (const t of trades) {
    if (!(t.usd > 0)) continue;
    const w = t.wallet.toLowerCase();
    let markets = byWallet.get(w);
    if (!markets) byWallet.set(w, (markets = new Map()));
    const cur = markets.get(t.marketId);
    if (!cur) {
      markets.set(t.marketId, {
        first: t.at,
        last: t.at,
        buy: t.isBuy ? t.usd : 0,
        sell: t.isBuy ? 0 : t.usd,
        n: 1,
      });
      continue;
    }
    cur.first = Math.min(cur.first, t.at);
    cur.last = Math.max(cur.last, t.at);
    if (t.isBuy) cur.buy += t.usd;
    else cur.sell += t.usd;
    cur.n += 1;
  }

  const rows: WalletAnalyticsRow[] = [];
  for (const [wallet, markets] of byWallet) {
    let buyUsd = 0;
    let sellUsd = 0;
    let totalTrades = 0;
    let firstSeen = Infinity;
    let lastSeen = -Infinity;
    const holds: number[] = [];
    const openDays = new Set<string>();
    for (const c of markets.values()) {
      buyUsd += c.buy;
      sellUsd += c.sell;
      totalTrades += c.n;
      firstSeen = Math.min(firstSeen, c.first);
      lastSeen = Math.max(lastSeen, c.last);
      holds.push((c.last - c.first) / 1000);
      openDays.add(new Date(c.first).toISOString().slice(0, 10));
    }
    rows.push({
      wallet,
      marketsTraded: markets.size,
      totalTrades,
      buyUsd,
      sellUsd,
      sellBuyRatio: buyUsd > 0 ? sellUsd / buyUsd : null,
      firstSeen,
      lastSeen,
      lifespanDays: (lastSeen - firstSeen) / DAY_MS,
      activeDays: openDays.size,
      medianHoldSecs: median(holds),
    });
  }
  rows.sort((a, b) => b.buyUsd - a.buyUsd);
  return rows;
}

export function summarizeWalletAnalytics(rows: WalletAnalyticsRow[]): WalletAnalyticsSummary {
  const totalBuyUsd = rows.reduce((s, r) => s + r.buyUsd, 0);
  const top10 = rows.slice(0, 10).reduce((s, r) => s + r.buyUsd, 0);
  return {
    wallets: rows.length,
    medianMarketsTraded: median(rows.map((r) => r.marketsTraded)),
    repeatWallets: rows.filter((r) => r.marketsTraded > 1).length,
    returningWallets: rows.filter((r) => r.activeDays > 3).length,
    totalBuyUsd,
    top10BuyShare: totalBuyUsd > 0 ? top10 / totalBuyUsd : 0,
    washSuspectWallets: rows.filter(
      (r) => r.sellBuyRatio != null && r.sellBuyRatio >= 0.8 && r.medianHoldSecs < 3600,
    ).length,
  };
}
