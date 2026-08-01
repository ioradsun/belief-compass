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
