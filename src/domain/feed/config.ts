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
  /**
   * Forward queue length handed to the client.
   *
   * RAISED FROM 24, because 24 was the bottom of the playlist and the playlist
   * is scrollable. A reader who flicked the column down hit the last row and
   * then nothing — no continuation, no placeholder, no signal — which reads as
   * the end of the feed and is a statement about the platform made by a batch
   * size. The refill still triggers on READING POSITION (the route's low-water
   * mark), never on scroll depth: scrolling the list is looking ahead, and
   * looking ahead is not consumption.
   *
   * NEARLY FREE, and this is why the number could move at all. The expensive
   * part of the response is `rows` — the read-model row per market — and that
   * ships the WHOLE candidate pool regardless of this limit, because the client
   * renders markets the queue has not reached yet and markets that have left it.
   * Raising the limit adds sequenced `items` (a score, a sentence, diagnostics),
   * not rows, so the marginal cost is a few hundred bytes each against a payload
   * already carrying 240 markets. No extra query, no extra cache: the pool,
   * the scoring and the sequencing all ran over the same 240 either way — this
   * only decides how many of the results are worth shipping.
   *
   * NOT `MAX_LIMIT`, deliberately. The rhythm and the diversity rules degrade as
   * the pool thins beneath them — the tail of a long queue is where
   * `soft_relaxed` starts appearing — and a queue is also a snapshot that ages
   * until the next commit. 48 is twice the depth at the same quality; the last
   * dozen before the ceiling would be neither.
   */
  DEFAULT_LIMIT: 48,
  MAX_LIMIT: 60,
  /** No more than this many consecutive cards from one category. */
  MAX_SAME_CATEGORY_RUN: 2,
  /** No more than this many consecutive cards from one creator. */
  MAX_SAME_CREATOR_RUN: 1,
  /**
   * No more than this many consecutive cards explained by the same FAMILY.
   *
   * ADDED BECAUSE THE HARNESS MEASURED IT, not because it seemed prudent. Across
   * nine archetypes the reason family was 70–90% MOMENTUM, and a brand-new
   * viewer got a run of NINE consecutive momentum cards — a feed that says the
   * same KIND of thing nine times running reads as one long sentence, whatever
   * the individual facts are. Category and creator runs were already capped and
   * measured at 2 and 1; family was uncapped and ran to 9.
   *
   * Three, not two: on a platform this quiet a viewer with no network HAS no
   * people facts, so a tighter cap would either starve the queue or force a
   * worse card into a slot to satisfy a rule about variety.
   */
  MAX_SAME_FAMILY_RUN: 3,
  /**
   * No more than this many consecutive cards moving the same WAY.
   *
   * Also measured: "down" was 50–70% of the feed in six of nine archetypes,
   * running to four in a row. A column of falling markets is a mood, not a
   * report, and it is the one clustering a reader would notice as bias.
   */
  MAX_SAME_DIRECTION_RUN: 2,
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

/**
 * DECLINE — repeated passes as a MILD negative interest signal.
 *
 * A pass is not a NO. It never touches the YES/NO relationship math, and it never
 * excludes a market by itself — the passed market leaves discovery on its own
 * (see COOLDOWNS.PASS_MS). What it does HERE is quieter: markets SEMANTICALLY
 * similar to the ones a viewer keeps declining rank a little lower.
 *
 * The signal is the centroid of the markets they passed. It concentrates only
 * when the passes agree — declining the same KIND of thing repeatedly — and
 * washes out when they scatter, so a single pass barely registers. The count
 * scale below is a second brake on the same idea: the penalty grows with how many
 * times they have declined, and saturates.
 *
 * Bounded small on purpose: the most a fully-similar market loses is MAX_PENALTY
 * of its 0..1 score. It is a nudge down the order, never a filter.
 */
export const DECLINE = {
  MAX_PENALTY: 0.1,
  /** Passes beyond this don't deepen the signal — it is already established. */
  SATURATE_AT: 6,
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
