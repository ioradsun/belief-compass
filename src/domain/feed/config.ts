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

/**
 * Momentum normalisation caps — beyond these, more is not more.
 *
 * RECALIBRATED AGAINST THE REAL DISTRIBUTION. The previous caps were 12 new
 * believers per HOUR and 20 trades per HOUR. Measured: zero markets on this
 * platform have ever had a new believer in an hour, and zero have a trade in
 * the current hour. Those caps described a platform that does not exist, and a
 * saturating normaliser against an unreachable cap returns nothing — so the
 * terms they governed contributed nothing, always.
 *
 * The hourly terms are gone from `momentum` and the daily ones are set where
 * the data actually lives: 12 markets gained a believer in 24h and 29 traded,
 * so a cap of 3 believers and 12 trades puts a genuinely busy market near the
 * top of the scale instead of at 4% of it. `VELOCITY_5M` is dropped entirely —
 * a five-minute tick extrapolated to an hourly rate is noise on a platform with
 * 175 trades a week, and `accelerationFrom` already refuses to trust it without
 * a trade in the last hour.
 */
export const MOMENTUM_CAPS = {
  NEW_BELIEVERS_24H: 3,
  TRADES_24H: 12,
  VOLUME_USD_24H: 250,
  ACCELERATION: 4,
} as const;

/**
 * Follows — the deliberate half of the social signal.
 *
 * Kept small on purpose. A follow moves a market up the order; it never
 * promises the market will appear, and it never excludes anything. If following
 * one prolific creator visibly took over someone's feed, this number is why,
 * and it is the number to lower.
 */
export const FOLLOWS = {
  /**
   * Where a follower count stops adding much. Four people you follow in one
   * market already says "this is your corner of the platform"; the tenth says
   * the same thing louder.
   */
  SATURATE_AT: 4,
} as const;

/**
 * ORIGIN CONTINUITY — how far a search result reaches into what comes next.
 *
 * When someone opens a market from outside the queue, the people in it become
 * a weak signal for the markets that follow. Weak on purpose: a shared
 * participant is a fact about a stranger, not about the reader, so this nudges
 * an order and never reorganises one.
 */
export const ORIGIN = {
  /** Overlapping people beyond this add nothing — three is already a thread. */
  SATURATE_AT: 3,
  /**
   * How many of the origin market's believers are examined. A query bound: a
   * busy market has hundreds and the strongest few carry the signal.
   */
  MAX_PEOPLE: 40,
} as const;

/** What counts as a material event worth re-showing an already-acted market. */
export const REENTRY = {
  MIN_ACCELERATION: 2,
  MIN_PRICE_MOVE_PCT: 15,
  MIN_NEW_BELIEVERS_1H: 5,
  /** Divergence (people vs money) above this reads as "conviction is shifting". */
  MIN_DIVERGENCE: 0.25,
} as const;

export const clamp01 = (x: number): number =>
  Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));

/** Saturating 0..1 normaliser: diminishing returns, never dominated by one whale. */
export const sat = (value: number, cap: number): number => {
  if (!(value > 0) || !(cap > 0)) return 0;
  return Math.log1p(Math.min(value, cap)) / Math.log1p(cap);
};
