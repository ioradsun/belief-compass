/**
 * Opportunity input builder — the ONE place a market_state row becomes a
 * normalized OpportunityInput. Every classifier consumes the same normalized
 * shape (no per-classifier field massaging). Pure.
 */
import type { OpportunityInput } from "@/domain/opportunity";

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/** market_state row (+ market_created_at) → OpportunityInput. */
export function buildOpportunityInput(
  ms: Record<string, unknown>,
  nowMs: number,
): OpportunityInput {
  const created = (ms.market_created_at as string) ?? (ms.created_at as string) ?? null;
  const marketAgeHours = created
    ? Math.max(0, (nowMs - new Date(created).getTime()) / 3_600_000)
    : null;
  const totalCapital =
    ms.yes_capital_usd == null && ms.no_capital_usd == null
      ? null
      : num(ms.yes_capital_usd) + num(ms.no_capital_usd);
  return {
    marketId: String(ms.onchain_id),
    marketAgeHours,
    directionalBelievers: num(ms.directional_believers),
    believersYes: num(ms.believers_yes),
    believersNo: num(ms.believers_no),
    uniqueWallets1h: num(ms.unique_wallets_1h),
    uniqueWallets24h: num(ms.unique_wallets_24h),
    uniqueWallets7d: num(ms.unique_wallets_7d),
    newBelievers1h: num(ms.new_believers_1h),
    newBelievers24h: num(ms.new_believers_24h),
    newBelievers7d: num(ms.new_believers_7d),
    volumeEth1h: num(ms.volume_eth_1h),
    volumeEth24h: num(ms.volume_eth_24h),
    volumeEth7d: num(ms.volume_eth_7d),
    tradeCount1h: num(ms.trade_count_1h),
    tradeCount24h: num(ms.trade_count_24h),
    tradeCount7d: num(ms.trade_count_7d),
    circulation1h: numOrNull(ms.circulation_1h),
    circulation24h: numOrNull(ms.circulation_24h),
    circulation7d: numOrNull(ms.circulation_7d),
    sellRate24h: numOrNull(ms.sell_rate_24h),
    peopleYesPct: numOrNull(ms.people_yes_pct),
    moneyYesPct: numOrNull(ms.money_yes_pct),
    totalCapitalUsd: totalCapital,
    avgDirectionalDays: numOrNull(ms.avg_directional_days),
    medianDirectionalDays: numOrNull(ms.median_directional_days),
    avgConvictionStrength: numOrNull(ms.avg_conviction_strength),
    priceChange1h: numOrNull(ms.yes_price_change_1h),
    priceChange24h: numOrNull(ms.yes_price_change_24h),
    hasValidPrices: ms.yes_price_usd != null || ms.no_price_usd != null,
    lastTradeAt: (ms.last_trade_at as string) ?? null,
    calculatedAt: (ms.calculated_at as string) ?? null,
  };
}
