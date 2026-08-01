/**
 * Conviction Dashboard — the pure money math behind the story.
 *
 * The dashboard answers one question: "Is my conviction making me money?" It
 * combines the three ways value is created — holding, trading, creating — into
 * one number. This module owns the only non-trivial derivation: realized trading
 * gain, folded from a wallet's canonical trade history.
 *
 * HONESTY RULE (same as domain/position.ts): a gain is only ever proceeds minus a
 * REAL weighted-average acquisition cost. When a sell has no matching basis
 * (e.g. history truncated), that portion realizes nothing rather than inventing a
 * number. No new accounting store — this is a read-time fold over existing trades.
 */

/** One canonical trade, already normalized to whole ETH + token units. */
export interface DashTrade {
  /** onchain market id (string key). */
  market: string;
  side: "YES" | "NO";
  action: "BUY" | "SELL";
  /** Trade value in ETH — cost paid (BUY) or proceeds received (SELL). ≥ 0. */
  eth: number;
  /** Token amount moved. > 0. */
  tokens: number;
}

/**
 * Realized trading gain in ETH, folded in chronological order with a
 * weighted-average cost basis per (market, side):
 *  - BUY  → add tokens + cost to the pool.
 *  - SELL → realize (proceeds for the sold tokens) − (their average cost).
 *
 * Only the portion of a sell that has real basis is realized; any excess (more
 * sold than the pool holds) contributes nothing, never a fabricated gain.
 */
export function realizedTradingEth(trades: DashTrade[]): number {
  const pool = new Map<string, { shares: number; cost: number }>();
  let realized = 0;

  for (const t of trades) {
    if (!(t.tokens > 0)) continue;
    const key = `${t.market}:${t.side}`;
    const p = pool.get(key) ?? { shares: 0, cost: 0 };

    if (t.action === "BUY") {
      p.shares += t.tokens;
      p.cost += Math.max(0, t.eth);
    } else if (p.shares > 1e-12) {
      // SELL — realize only against the basis we actually hold.
      const sold = Math.min(t.tokens, p.shares);
      const avgCost = p.cost / p.shares;
      const costOut = avgCost * sold;
      const proceeds = Math.max(0, t.eth) * (sold / t.tokens);
      realized += proceeds - costOut;
      p.shares -= sold;
      p.cost -= costOut;
      if (p.shares < 1e-12) {
        p.shares = 0;
        p.cost = 0;
      }
    }
    pool.set(key, p);
  }
  return realized;
}

/**
 * The lifetime money-flow story from a wallet's trades: everything ever committed
 * to buys ("you put in") and everything ever received from sells ("you've cashed
 * out"). Gross flows, in ETH — real numbers straight off the trade log.
 */
export function moneyFlows(trades: DashTrade[]): { putInEth: number; cashedOutEth: number } {
  let putInEth = 0;
  let cashedOutEth = 0;
  for (const t of trades) {
    if (t.action === "BUY") putInEth += Math.max(0, t.eth);
    else if (t.action === "SELL") cashedOutEth += Math.max(0, t.eth);
  }
  return { putInEth, cashedOutEth };
}

/** Everything the milestone ladder needs to decide what's unlocked. */
export interface MilestoneFacts {
  createdCount: number;
  tradeCount: number;
  sinceStartUsd: number;
  /** A realized win or a position currently in the green. */
  hasProfit: boolean;
  creatorLifetimeUsd: number;
  /** Lifetime creator earnings exceed the unclaimed balance → they've claimed. */
  hasClaimed: boolean;
  maxMarketVolumeUsd: number;
  longestHeldDays: number;
  totalValueUsd: number;
}

export interface Milestone {
  key: string;
  label: string;
  done: boolean;
}

/**
 * The milestone ladder — progress, not trophies. Ordered so early wins are easy
 * and value tiers escalate, guaranteeing there is almost always a "next" just
 * ahead. Returns the list, the count/percent unlocked, and the next locked one.
 */
export function buildMilestones(f: MilestoneFacts): {
  list: Milestone[];
  unlocked: number;
  total: number;
  pct: number;
  next: Milestone | null;
} {
  const list: Milestone[] = [
    { key: "first-market", label: "First Market", done: f.createdCount >= 1 },
    { key: "first-profit", label: "First Profitable Trade", done: f.hasProfit },
    { key: "first-100", label: "Earned Your First $100", done: f.sinceStartUsd >= 100 },
    { key: "trades-100", label: "100 Trades", done: f.tradeCount >= 100 },
    { key: "first-creator", label: "First Creator Earnings", done: f.creatorLifetimeUsd > 0 },
    { key: "first-claim", label: "First Claim", done: f.hasClaimed },
    { key: "vol-10k", label: "Market Reached $10k Volume", done: f.maxMarketVolumeUsd >= 10_000 },
    { key: "held-30", label: "Held a Conviction 30 Days", done: f.longestHeldDays >= 30 },
    { key: "value-10k", label: "Reach $10k Conviction", done: f.totalValueUsd >= 10_000 },
    { key: "trades-500", label: "500 Trades", done: f.tradeCount >= 500 },
    { key: "value-50k", label: "Reach $50k Conviction", done: f.totalValueUsd >= 50_000 },
    { key: "value-100k", label: "Reach $100k Conviction", done: f.totalValueUsd >= 100_000 },
  ];
  const unlocked = list.filter((m) => m.done).length;
  const total = list.length;
  return {
    list,
    unlocked,
    total,
    pct: Math.round((unlocked / total) * 100),
    next: list.find((m) => !m.done) ?? null,
  };
}

/** One decoded creator-fee accrual: when it happened and how much (ETH). */
export interface FeeEntry {
  at: number;
  eth: number;
}

/**
 * Bucket a creator's fee accruals into the windows the dashboard tells the story
 * with: today (since UTC midnight), the last 7 days, and the 7 days before that
 * (for the week-over-week line). Same facts, three lenses — no double counting
 * between "this week" and "last week".
 */
export function bucketCreatorFees(
  entries: FeeEntry[],
  now: number,
): { todayEth: number; weekEth: number; prevWeekEth: number } {
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const todayFrom = startOfToday.getTime();
  const weekFrom = now - 7 * 86_400_000;
  const prevWeekFrom = now - 14 * 86_400_000;

  let todayEth = 0;
  let weekEth = 0;
  let prevWeekEth = 0;
  for (const e of entries) {
    if (!Number.isFinite(e.eth) || e.eth <= 0) continue;
    if (e.at >= todayFrom) todayEth += e.eth;
    if (e.at >= weekFrom) weekEth += e.eth;
    else if (e.at >= prevWeekFrom) prevWeekEth += e.eth;
  }
  return { todayEth, weekEth, prevWeekEth };
}

/** A value source in the "where your gains came from" breakdown. */
export interface GainSource {
  key: "holding" | "trading" | "creating";
  label: string;
  /** Gain in USD. May be negative (a loss) for holding/trading. */
  usd: number;
}

/**
 * Turn the three raw source amounts into display rows with their share of the
 * total POSITIVE gain (losses show no percentage — you can't be "18% of" a loss).
 * Percentages are computed against positive contributors only so they read as
 * "where my gains came from", summing to 100 across the winners.
 */
export function gainBreakdown(sources: GainSource[]): Array<GainSource & { pct: number | null }> {
  const positiveTotal = sources.reduce((s, x) => s + Math.max(0, x.usd), 0);
  return sources.map((x) => ({
    ...x,
    pct: x.usd > 0 && positiveTotal > 0 ? Math.round((x.usd / positiveTotal) * 100) : null,
  }));
}
