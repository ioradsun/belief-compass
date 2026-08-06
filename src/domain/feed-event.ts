/**
 * FEED-EVENT IMPORTANCE — decides whether a live event has changed the MEANING of
 * a market enough to earn a place in the intelligent feed, and how loudly.
 *
 * The live tape must not narrate every transaction. Its job is to surface
 * meaningful changes in momentum. A candidate is judged across four dimensions —
 * people, capital, price, social — and scored:
 *
 *     importance = market-relative magnitude × speed × novelty × personal relevance
 *
 * The central rule: volume earns attention only when it changes the meaning of the
 * market. So magnitude is MARKET-RELATIVE — $6 is dust in a whale market but the
 * start of a movement in a tiny one — never raw volume. Structural transitions
 * (a market opens, a side flips, a milestone falls) are meaningful by nature and
 * always rank; a lone small trade is Tier-4 "raw activity" and belongs in the
 * ledger, not the intelligent feed.
 *
 * ZERO IO, pure, fully testable. The default trigger thresholds live here so
 * tuning the feed means editing one config, not the engine.
 */
import { sat, clamp01 } from "./feed/config";
import { BARS } from "./market-change";

export type FeedDimension = "people" | "capital" | "price" | "social";
/** 1 Breaking · 2 Notable · 3 Context · 4 Raw (ledger only, out of the feed). */
export type FeedTier = 1 | 2 | 3 | 4;
export type NetTag = "twin" | "tribe" | "opp" | "inverse";

/**
 * Section-10 default trigger thresholds — the point at which each dimension has
 * moved enough to be an event on its own. Tune against live distributions; do not
 * hard-code forever. The scorer uses these; side-panel/state-transition callers
 * can also use the exported predicates below directly.
 */
export const FEED_TRIGGERS = {
  /**
   * DERIVED, NOT DECLARED. These three rows used to be literals here, and they
   * were a THIRD independent answer to questions `market-change` and the
   * momentum lens were already answering — with different numbers. Price
   * disagreed outright: 8% here against the 5% the product had settled on and
   * the data supported. A user control on top of three copies would have let a
   * reader move a setting and watch the feed half-respond.
   *
   * They now read the one bar table (@/domain/market-change#BARS). The activity
   * feed uses the NOTABLE row, which is what "worth emitting as an event" has
   * always meant here — see `barFor` for the reader-tunable version.
   */
  believers: {
    minAbs: BARS.notable.minBelieverDelta,
    minGrowthPct: 20,
    minGrowthBase: 10,
  },
  capital: {
    minUsd: BARS.notable.minUsd,
    minRelPct: BARS.notable.minRelPct,
    spikeMultiple: 3,
  },
  price: { minPct: BARS.notable.minPct },
  /**
   * STRUCTURAL, and deliberately not part of the bar. "How many wallets make a
   * cluster" is a question about what constitutes a group, not about how much
   * movement is worth reporting — a reader tuning sensitivity is not asking for
   * two people to stop being two people.
   */
  switch: { minWallets: 2 },
  social: { minClusterWallets: 2 },
} as const;

/**
 * Importance core weights (magnitude × speed × novelty). Personal relevance is a
 * separate MULTIPLIER so a Twin's action is lifted, not summed — and a market
 * event with no personal tie keeps its intrinsic importance instead of being
 * zeroed.
 */
const CORE_WEIGHTS = { magnitude: 0.5, speed: 0.2, novelty: 0.3 } as const;

/** A move this large is "big" in absolute terms regardless of the market. */
const ABS_USD_CAP = 2000;
/**
 * A market's rough "normal" stake per believer — the market-relative reference.
 *
 * Measured across 269 funded markets, capital per believer runs p25 $0.01 ·
 * p50 $0.50 · p75 $1.20 · p90 $2.87 · p95 $4.94 — and it RISES WITH SIZE: the
 * largest market (37 believers, $197) sits at $5.30 each. So a single rate
 * cannot be right everywhere, and $8 was above the 95th percentile of the
 * distribution while being roughly right for the biggest market.
 *
 * Four dollars is inside the observed range rather than above it. It is
 * deliberately NOT the median: this rate multiplies the believer count, so it
 * only decides the reference on markets that HAVE believers to multiply — the
 * larger ones, where per-believer capital is high. The small-market case is the
 * floor below, and that is where the real defect was.
 */
const PER_BELIEVER_USD = 4;
/**
 * Floor for the reference so a brand-new (0-believer) market isn't divide-by-tiny.
 *
 * IT WAS TWENTY, AND IT BOUND ON 78% OF FUNDED MARKETS (210 of 269 have two
 * believers or fewer). The consequence is the whole reason this constant is now
 * documented: on the median market, a trade equal to THE ENTIRE MARKET'S CAPITAL
 * scored a relative magnitude of 0.048 — five percent of the "reaching its
 * normal scale is a full-magnitude move" the line below promises.
 *
 * So inside a real market nothing could be distinguished: a $0.08 trade and a
 * $0.96 trade both scored ≈0 on the term meant to separate them, and the
 * ranking fell through to the people count, which is identical for every lone
 * trade. That is what made a young platform feel uniformly busy rather than
 * meaningfully active — not a missing relative rule, but a reference scale set
 * twenty times above the median market's entire capital ($0.96).
 *
 * Two dollars sits just above the median market total and below the p90 of
 * $5.38, so the floor now protects an empty market without flattening a small
 * live one.
 */
const MIN_MARKET_REF_USD = 2;

/** How much a viewer-network action lifts an event's importance. */
const REL_BOOST: Record<NetTag, number> = { twin: 1.9, opp: 1.7, tribe: 1.5, inverse: 1.5 };

/** How novel each kind of row is by nature — a transition beats a trade. */
const NOVELTY: Record<string, number> = {
  market_transition: 0.95,
  market_created: 0.9,
  tribe_doubled: 0.9,
  believer_milestone: 0.85,
  side_shift: 0.8,
  // One person moving across many markets at once is a real signal about them.
  wallet_sweep: 0.85,
  large_trade: 0.5,
  trade_burst: 0.25,
  round_trip: 0,
};

/** The structural transitions that change a side's composition or direction. A
 *  market_transition is already dedup-gated upstream, so it is always feed-worthy. */
const STRUCTURAL = new Set([
  "market_transition",
  "market_created",
  "side_shift",
  "believer_milestone",
  "tribe_doubled",
]);

/** One candidate event, distilled to what importance needs. */
export interface FeedCandidate {
  kind: string;
  side: "YES" | "NO" | null;
  /** Money moved in this row (USD), or null for a structural row with no amount. */
  amountUsd: number | null;
  walletCount: number | null;
  tradeCount: number | null;
  /** Span of a burst in ms — density is speed. */
  windowMs?: number | null;
  /** The actor's tie to the viewer, when any — the personal-relevance multiplier. */
  relationship?: NetTag | null;
  /** Directional believers on the whole market (yes+no) — the market-size proxy
   *  that makes magnitude relative. Null → treated as a small/new market. */
  marketBelievers?: number | null;
  /**
   * What this move did to the person's BELIEF, not to their tokens
   * (src/domain/conviction-event). Optional; absent scores exactly as before.
   */
  conviction?: "enter" | "add" | "reduce" | "exit" | "flip" | "round_trip" | null;
  /** How long they had held the belief this move changed. */
  daysHeld?: number | null;
}

export interface FeedImportance {
  /** 0..100 — for diagnostics and (where safe to reorder) ranking. */
  score: number;
  tier: FeedTier;
  /** The dimension that carries the event — drives which story angle to tell. */
  dimension: FeedDimension;
}

/**
 * MEANING A DOLLAR AMOUNT CANNOT EXPRESS. Ending a belief you held for three
 * months is a bigger event than opening one you may abandon tomorrow, whatever
 * the two cost. Judged on size alone the feed reports capital and misses the
 * only thing it is actually about — so a long-held exit, a doubling-down and a
 * change of mind carry weight of their own.
 *
 * Optional in every case: a candidate with no conviction context scores exactly
 * as it did before this existed.
 */
function meaningOf(c: FeedCandidate): number {
  const days = c.daysHeld ?? 0;
  switch (c.conviction) {
    // Changing your mind in public is the strongest thing one person can do.
    case "flip":
      return 0.7;
    case "exit":
      // A ramp, not a step: a belief ending is worth more the longer it lasted.
      return days >= 7 ? clamp01(0.25 + 0.45 * sat(days, 90)) : 0.15;
    case "reduce":
      return days >= 7 ? clamp01(0.15 + 0.3 * sat(days, 90)) : 0.1;
    // Backing something you already believe, again.
    case "add":
      return 0.35;
    default:
      return 0;
  }
}

/** Market-relative magnitude: amount vs the market's own normal scale, plus a
 *  people term (more wallets = more meaningful) and a small absolute floor. */
function magnitudeOf(c: FeedCandidate): number {
  const people = sat(c.walletCount ?? 1, 6);
  if (c.amountUsd == null) {
    // A structural row (milestone, side flip) has no dollar amount but is a real
    // change — its magnitude comes from how many people moved.
    return clamp01(0.6 + 0.4 * people);
  }
  const ref = Math.max(MIN_MARKET_REF_USD, (c.marketBelievers ?? 0) * PER_BELIEVER_USD);
  // A LINEAR fraction of the market's own capital: reaching its normal scale is a
  // full-magnitude move, so $6 is huge in a $16 market and nothing in a $32k one.
  const relative = clamp01(c.amountUsd / ref);
  // A light absolute floor so a genuinely large move still registers somewhat.
  const absolute = sat(c.amountUsd, ABS_USD_CAP);
  const money = clamp01(0.6 * relative + 0.15 * absolute + 0.25 * people);
  // Meaning closes some of the distance to a full-magnitude move — it can lift a
  // small sum a long way and can never overshoot, so a $12 exit after 90 days
  // outranks a $200 entry by someone who arrived this morning.
  return clamp01(money + (1 - money) * meaningOf(c));
}

/** Speed: how concentrated the activity is — a burst of many trades fast is loud.
 *  A lone trade has no speed; speed is a property of a cluster. */
function speedOf(c: FeedCandidate): number {
  const trades = c.tradeCount ?? 1;
  if (trades <= 1) return 0.1;
  const mins = (c.windowMs ?? 0) / 60_000;
  const perMin = mins > 0 ? trades / mins : trades; // instantaneous burst → trades
  return clamp01(0.4 * sat(perMin, 3) + 0.6 * sat(trades, 8));
}

function noveltyOf(c: FeedCandidate): number {
  return NOVELTY[c.kind] ?? 0.2;
}

function relevanceOf(c: FeedCandidate): number {
  return c.relationship ? REL_BOOST[c.relationship] : 1;
}

function dimensionOf(c: FeedCandidate): FeedDimension {
  if (c.relationship) return "social";
  if (c.kind === "side_shift" || c.kind === "believer_milestone" || c.kind === "tribe_doubled")
    return "people";
  if (c.kind === "market_created") return "people";
  return "capital";
}

function tierOf(c: FeedCandidate, score: number): FeedTier {
  if (c.kind === "round_trip") return 4; // a wash says nothing
  const twinOpp = c.relationship === "twin" || c.relationship === "opp";
  // A side flip only breaks when enough wallets actually switch (section-10 switch
  // trigger); a lone flip is context, not breaking.
  const structuralBreaking =
    STRUCTURAL.has(c.kind) &&
    (c.kind !== "side_shift" || (c.walletCount ?? 1) >= FEED_TRIGGERS.switch.minWallets);
  if (structuralBreaking || twinOpp || score >= 75) return 1;
  const cluster =
    !!c.relationship && (c.walletCount ?? 1) >= FEED_TRIGGERS.social.minClusterWallets;
  if (score >= 45 || cluster || STRUCTURAL.has(c.kind)) return 2;
  if (c.relationship || score >= 25) return 3;
  return 4;
}

export function scoreFeedEvent(c: FeedCandidate): FeedImportance {
  const core =
    CORE_WEIGHTS.magnitude * magnitudeOf(c) +
    CORE_WEIGHTS.speed * speedOf(c) +
    CORE_WEIGHTS.novelty * noveltyOf(c);
  const score = Math.min(100, Math.round(clamp01(core) * relevanceOf(c) * 100));
  return { score, tier: tierOf(c, score), dimension: dimensionOf(c) };
}

/**
 * The gate for the intelligent feed: Tiers 1–3 belong in it; Tier 4 (raw activity —
 * lone dust, washes) is preserved in the ledger but kept OUT of the feed. This
 * replaces a flat dollar floor with a market-relative judgement, so the same $6
 * trade is dropped in a whale market and surfaced in a tiny one.
 */
export function includeInFeed(c: FeedCandidate): boolean {
  return scoreFeedEvent(c).tier <= 3;
}

// ── Section-10 trigger predicates ────────────────────────────────────────────
// Pure boundary checks a caller with the richer per-side windowed inputs (the
// analytical side-panel feed, or a future state-transition emitter) can use to
// decide whether a dimension has moved enough to become its own event.

/** People: a meaningful count joined/left, or growth cleared the relative bar. */
export function believerTrigger(delta: number, priorBase: number): boolean {
  const t = FEED_TRIGGERS.believers;
  if (Math.abs(delta) >= t.minAbs) return true;
  return priorBase >= t.minGrowthBase && Math.abs(delta) / priorBase >= t.minGrowthPct / 100;
}

/** Capital: real money AND a relative move, or an inflow well above baseline. */
export function capitalTrigger(input: {
  deltaUsd: number;
  priorUsd: number;
  recentUsd?: number;
  baselineUsd?: number;
}): boolean {
  const t = FEED_TRIGGERS.capital;
  const { deltaUsd, priorUsd, recentUsd, baselineUsd } = input;
  const spike =
    recentUsd != null &&
    baselineUsd != null &&
    baselineUsd > 0 &&
    recentUsd >= baselineUsd * t.spikeMultiple &&
    recentUsd >= t.minUsd;
  if (spike) return true;
  if (Math.abs(deltaUsd) < t.minUsd) return false;
  return priorUsd > 0 && Math.abs(deltaUsd) / priorUsd >= t.minRelPct / 100;
}

/** Price: an absolute % move past the threshold (caller pre-filters dust/noise). */
export function priceTrigger(pricePct: number | null): boolean {
  return pricePct != null && Math.abs(pricePct) >= FEED_TRIGGERS.price.minPct;
}

/** Switch: at least N wallets changed directional side in the window. */
export function switchTrigger(walletsSwitched: number): boolean {
  return walletsSwitched >= FEED_TRIGGERS.switch.minWallets;
}

/** Social: a Tribe/Rival cluster acted together, or one Twin/Opp acted. */
export function socialTrigger(input: { clusterWallets: number; twinOrOpp: boolean }): boolean {
  return input.twinOrOpp || input.clusterWallets >= FEED_TRIGGERS.social.minClusterWallets;
}

/**
 * Composite: two dimensions diverging materially is often the best event —
 * "more believers, less capital", "price up while believers flat". Returns the
 * contradiction found, or null.
 */
export function compositeSignal(input: {
  believerDelta: number;
  capitalDeltaUsd: number;
  pricePct: number | null;
}): "people-up-capital-down" | "capital-up-people-flat" | "price-up-people-flat" | null {
  const { believerDelta, capitalDeltaUsd, pricePct } = input;
  if (
    believerDelta >= FEED_TRIGGERS.believers.minAbs &&
    capitalDeltaUsd <= -FEED_TRIGGERS.capital.minUsd
  )
    return "people-up-capital-down";
  if (capitalDeltaUsd >= FEED_TRIGGERS.capital.minUsd && believerDelta <= 0)
    return "capital-up-people-flat";
  if (pricePct != null && pricePct >= FEED_TRIGGERS.price.minPct && believerDelta <= 0)
    return "price-up-people-flat";
  return null;
}
