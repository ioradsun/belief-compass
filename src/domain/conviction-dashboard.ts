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
  /** Current value toward the goal (for the active-goal progress bar). */
  current?: number;
  /** Target value that unlocks it. Present on measurable rungs. */
  target?: number;
}

/**
 * The milestone ladder — progress, not trophies. Ordered so early wins are easy
 * and value/earnings tiers escalate, guaranteeing there is almost always a "next"
 * just ahead. Measurable rungs carry current/target so the active goal can show a
 * real progress bar ("$842 / $1,000 · 84%"). Returns the list, count/percent
 * unlocked, and the next locked rung as the single active goal.
 */
export function buildMilestones(f: MilestoneFacts): {
  list: Milestone[];
  unlocked: number;
  total: number;
  pct: number;
  next: Milestone | null;
} {
  const M = (key: string, label: string, done: boolean, current?: number, target?: number): Milestone => ({
    key,
    label,
    done,
    current,
    target,
  });
  const list: Milestone[] = [
    M("first-market", "First Market", f.createdCount >= 1),
    M("first-profit", "First Profitable Trade", f.hasProfit),
    M("first-100", "Earn Your First $100", f.sinceStartUsd >= 100, f.sinceStartUsd, 100),
    M("first-creator", "First Creator Earnings", f.creatorLifetimeUsd > 0),
    M("trades-100", "100 Trades", f.tradeCount >= 100, f.tradeCount, 100),
    M("held-30", "Hold a Conviction 30 Days", f.longestHeldDays >= 30, f.longestHeldDays, 30),
    M("first-claim", "First Claim", f.hasClaimed),
    M("earn-1k", "Earn $1,000 Creating Markets", f.creatorLifetimeUsd >= 1000, f.creatorLifetimeUsd, 1000),
    M("vol-10k", "A Market Reaches $10k Volume", f.maxMarketVolumeUsd >= 10_000, f.maxMarketVolumeUsd, 10_000),
    M("value-10k", "Reach $10k Conviction", f.totalValueUsd >= 10_000, f.totalValueUsd, 10_000),
    M("trades-500", "500 Trades", f.tradeCount >= 500, f.tradeCount, 500),
    M("value-50k", "Reach $50k Conviction", f.totalValueUsd >= 50_000, f.totalValueUsd, 50_000),
    M("earn-10k", "Earn $10,000 Creating Markets", f.creatorLifetimeUsd >= 10_000, f.creatorLifetimeUsd, 10_000),
    M("value-100k", "Reach $100k Conviction", f.totalValueUsd >= 100_000, f.totalValueUsd, 100_000),
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

/** Progress toward a measurable milestone, clamped to 0–100. */
export function milestonePct(m: Milestone): number | null {
  if (m.target == null || m.current == null || m.target <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((m.current / m.target) * 100)));
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

/**
 * The Journey — a wallet's whole economic story as one reconciling identity.
 *
 *   Total Return = Current Value + Total Withdrawn + Creator Earnings
 *   Net Profit   = Total Return − Total Invested
 *
 * Nothing is inferred and nothing is double counted: invested is cumulative
 * lifetime capital in (never netted against withdrawals), withdrawn is cumulative
 * sale proceeds, current value is the POV valuation of open positions, and creator
 * earnings are contract truth. ROI is only defined against real invested capital.
 */
export interface JourneyMath {
  investedUsd: number;
  currentValueUsd: number;
  withdrawnUsd: number;
  creatorUsd: number;
  totalReturnUsd: number;
  netProfitUsd: number;
  /** netProfit / invested × 100, or null when nothing has ever been invested. */
  roiPct: number | null;
  /** True when the wallet has no economic history at all. */
  empty: boolean;
}

export function journeyMath(input: {
  investedUsd: number;
  currentValueUsd: number;
  withdrawnUsd: number;
  creatorUsd: number;
}): JourneyMath {
  const n = (v: number) => (Number.isFinite(v) ? v : 0);
  const investedUsd = n(input.investedUsd);
  const currentValueUsd = n(input.currentValueUsd);
  const withdrawnUsd = n(input.withdrawnUsd);
  const creatorUsd = n(input.creatorUsd);
  const totalReturnUsd = currentValueUsd + withdrawnUsd + creatorUsd;
  const netProfitUsd = totalReturnUsd - investedUsd;
  return {
    investedUsd,
    currentValueUsd,
    withdrawnUsd,
    creatorUsd,
    totalReturnUsd,
    netProfitUsd,
    roiPct: investedUsd > 0 ? (netProfitUsd / investedUsd) * 100 : null,
    empty: investedUsd <= 0 && totalReturnUsd <= 0,
  };
}
