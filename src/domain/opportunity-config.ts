/**
 * Opportunity engine configuration — every threshold in ONE place (never scattered
 * as magic numbers through classifiers or components). Initial values chosen for
 * the current (small) production scale; tune only these, and document changes.
 */
export const OPP = {
  ENGINE_VERSION: 1,

  // ── New-market window ──
  NEW_MARKET_MAX_HOURS: 72,

  // ── Minimum sample rules ──
  MIN_ACTIVITY_WALLETS: 3, // a "broad" window needs at least this many wallets
  MIN_DIRECTIONAL_BELIEVERS: 4,
  MIN_CONTESTED_SIDE_BELIEVERS: 2, // each side
  MIN_CONVICTION_COHORT: 4,
  MIN_TRADES_FOR_SELL_RATE: 5,
  MIN_MARKETS_FOR_PERCENTILES: 20, // below this, percentiles are disabled

  // ── Eligibility ──
  STALE_SECONDS: 1800, // market_state older than this ⇒ stale
  CAPITAL_FLOOR_USD: 100, // circulation denominators below this are invalid

  // ── Hot (acceleration) ──
  HOT_MIN_UNIQUE_WALLETS_1H: 3, // absolute activity floor (1h)
  HOT_MIN_UNIQUE_WALLETS_24H: 6, // absolute floor for the 24h fallback
  HOT_MIN_ACCEL: 1.6, // recent-rate ÷ baseline-rate uplift
  HOT_BASELINE_FLOOR: 0.5, // per-hour baseline floor (no infinite accel)
  HOT_STRONG_STRENGTH: 0.55, // "unusually strong" → Hot wins precedence

  // ── Early (growth with room) ──
  EARLY_MAX_DIRECTIONAL: 40, // maturity cap
  EARLY_MIN_NEW_BELIEVERS: 3,
  EARLY_MIN_WALLETS: 3,

  // ── Hidden (size-relative) ──
  HIDDEN_MAX_CAPITAL_USD: 5000, // low visible scale
  HIDDEN_MIN_CIRCULATION: 1.0, // meaningful turnover
  HIDDEN_MIN_WALLETS: 3, // breadth (> one wallet, with margin)
  HIDDEN_MAX_CONCENTRATION: 0.6, // reject one-wallet churn

  // ── Contested (balanced + active) ──
  CONTESTED_BALANCE_MIN: 0.6, // 1 - |pYes-0.5|*2 ; ~within 20pts of 50/50
  CONTESTED_MIN_RECENT_TRADES: 4,

  // ── Conviction (persistence UNDER challenge) ──
  CONVICTION_MIN_MEDIAN_DAYS: 7,
  CONVICTION_MIN_STRENGTH: 0.4,
  CONVICTION_MIN_COHORT: 4,
  CONVICTION_MIN_CIRCULATION_7D: 0.5, // challenge floor
  CONVICTION_MIN_SELL_RATE: 0.2, // alt. challenge signal

  // ── Concentration proxy (uses canonical fields only) ──
  CONCENTRATION_TRADES_PER_WALLET_FLOOR: 2, // <= this ⇒ no penalty
  CONCENTRATION_TRADES_PER_WALLET_SPAN: 8, // scales the penalty to 1.0

  // ── Scoring weights (bounded components; result clamped 0..100) ──
  W_GLOBAL_QUALITY: 40,
  W_TYPE_STRENGTH: 45,
  CONFIDENCE_BONUS: { low: 0, medium: 5, high: 15 } as const,
  STALENESS_PENALTY_MAX: 15,
  CONCENTRATION_PENALTY_MAX: 20,

  // ── Hysteresis ──
  HYSTERESIS_MARGIN: 0.12, // new type must beat current by this strength margin
} as const;

// Log scale to 0..1 with a cap, so no single whale/large value dominates.
export function logScale01(value: number, cap: number): number {
  if (!(value > 0)) return 0;
  const v = Math.min(value, cap);
  return Math.log1p(v) / Math.log1p(cap);
}
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp100 = (x: number): number => (x < 0 ? 0 : x > 100 ? 100 : x);
