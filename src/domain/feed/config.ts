/**
 * Discovery feed — every tunable in ONE place.
 *
 * The feed is deterministic code. AI understands a market ONCE at ingestion and
 * stores structured meaning (`market_ai_analysis`); nothing here calls a model.
 * These constants define eligibility, cooldowns, ranking weights and the
 * sequencing rhythm, so tuning the feed means editing this file, not the engine.
 */

export const FEED_ENGINE_VERSION = 2;

const HOUR = 3_600_000;

/**
 * How long a market stays out of discovery after a given interaction.
 * `null` means "indefinitely" (an explicit hide, or an open position).
 */
export const COOLDOWNS = {
  /** Holding YES or NO: out while the position is active. */
  ACTIVE_POSITION_MS: null as number | null,
  /** First PASS. */
  PASS_MS: 24 * HOUR,
  /** Second (or later) PASS — the person told us twice. */
  PASS_REPEAT_MS: 7 * 24 * HOUR,
  /** Scrolled past without acting. */
  VIEWED_MS: 8 * HOUR,
  /** Opened the market detail / case file. */
  OPENED_MS: 24 * HOUR,
  /** Held a position and sold out of it entirely. */
  SOLD_MS: 7 * 24 * HOUR,
  /** Explicit "don't show me this". */
  HIDDEN_MS: null as number | null,
} as const;

/** Composite ranking weights. They sum to 1. */
export const WEIGHTS = {
  momentum: 0.25,
  personal: 0.2,
  freshness: 0.15,
  social: 0.15,
  quality: 0.1,
  early: 0.1,
  exploration: 0.05,
} as const;

export type ScoreComponent = keyof typeof WEIGHTS;

export const SEQUENCE = {
  /** Forward queue length handed to the client. */
  DEFAULT_LIMIT: 24,
  MAX_LIMIT: 60,
  /** No more than this many consecutive cards from one category. */
  MAX_SAME_CATEGORY_RUN: 2,
  /** No more than this many consecutive cards from one creator. */
  MAX_SAME_CREATOR_RUN: 1,
  /** Never place two markets from the same duplicate cluster this close. */
  MIN_CLUSTER_GAP: 5,
  /** Re-entry ("your position is moving") cards: at most 1 in this many. */
  REENTRY_EVERY: 10,
  /** The House idea never takes one of the first slots. */
  IDEA_MIN_POSITION: 3,
} as const;

/** Freshness horizons, in hours. */
export const FRESHNESS = {
  BRAND_NEW_HOURS: 6,
  NEW_HOURS: 72,
} as const;

/** Momentum normalisation caps — beyond these, more is not more. */
export const MOMENTUM_CAPS = {
  NEW_BELIEVERS_1H: 12,
  TRADES_1H: 20,
  VELOCITY_5M: 8,
  VOLUME_USD_24H: 5000,
  ACCELERATION: 4,
} as const;

/** What counts as a material event worth re-showing an already-acted market. */
export const REENTRY = {
  MIN_ACCELERATION: 2,
  MIN_PRICE_MOVE_PCT: 15,
  MIN_NEW_BELIEVERS_1H: 5,
  /** Divergence (people vs money) above this reads as "conviction is shifting". */
  MIN_DIVERGENCE: 0.25,
} as const;

export const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));

/** Saturating 0..1 normaliser: diminishing returns, never dominated by one whale. */
export const sat = (value: number, cap: number): number => {
  if (!(value > 0) || !(cap > 0)) return 0;
  return Math.log1p(Math.min(value, cap)) / Math.log1p(cap);
};
