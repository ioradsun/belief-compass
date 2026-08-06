/**
 * MARKET CHANGE — what moved, computed once, read everywhere.
 *
 * THE PROBLEM THIS EXISTS TO END. "How much did this market change over the
 * window?" had four independent answers, on three different tiers:
 *
 *   1. RETIRED: the SQL jobs `recompute_price_changes` and
 *      `refresh_market_window_change`, which each stored their own percentage.
 *                   Price only, price over price.
 *   2. Server TS    refresh-market.server subtracts a ~24h snapshot to store
 *                   yes_capital_delta_24h / no_capital_delta_24h.
 *   3. Client TS    marketBook() replays the trade tape and reports its own
 *                   per-window delta. The tape is CAPPED AT 1000 TRADES, so on a
 *                   busy market this answer is not merely different, it is wrong.
 *   4. Client TS    the Case File subtracts market_window_baselines itself.
 *
 * Two of those render side by side on one screen. The centre panel ("Total
 * market · Participants") took its window delta from the tape replay and grafted
 * it onto the authoritative total, while the YES and NO panels beside it took
 * theirs from the snapshot baselines. On any market past the tape cap the centre
 * and the sides disagreed about the same window, and neither was labelled as an
 * estimate.
 *
 * So there is now ONE SHAPE and ONE RULE:
 *
 *   THE FACTS live where they always did — `market_state` is the current state
 *   and its snapshots are the history. This module never invents a number; it
 *   pairs a current with a base.
 *
 *   THE DERIVATION lives here. Every metric goes through `gain`
 *   (src/domain/metric-display), so a percentage appears only where the base is
 *   worth dividing by and the first money into a side is an arrival rather than
 *   a rate. That rule is not restated in any surface.
 *
 *   TWO LOADERS, ONE SHAPE. `changeFrom24hRow` reads the fields market_state
 *   already carries for every market (cheap, bulk, 24h). `changeFromBaseline`
 *   reads a per-window snapshot baseline (exact, per market, any window). They
 *   produce the identical structure, so a surface cannot tell which fed it and
 *   cannot drift from another surface that used the other.
 *
 * WHY THE PERCENTAGE IS NOT STORED. It is a derivative of (current, base) and
 * of a threshold table that we tune. Persisting it would put a second copy of
 * one fact on disk, and every threshold change would need a backfill before the
 * screens agreed again. The facts are stored once; the ratio is computed once,
 * here, by `gain`.
 *
 * ZERO IO, pure, fully testable.
 */
import { gain, METRIC_DISPLAY, type Gain, type GainRank } from "./metric-display";

export type Side = "YES" | "NO";
export type ChangeMetric = "believers" | "capital" | "price";

/** One metric's move: the two facts, and what `gain` will let us say about them. */
export interface MetricChange {
  /** The state now, in the metric's own unit (capital and price in USD). */
  current: number | null;
  /** The state when the window opened. Null when there is no baseline at all. */
  base: number | null;
  /** current − base. Null only when `rank` is "unknown". */
  delta: number | null;
  /** Present only when the base is worth dividing by. See GainRank. */
  pct: number | null;
  rank: GainRank;
}

export interface SideChange {
  believers: MetricChange;
  /** USD. Judged in USD so the viewer's display unit never changes materiality. */
  capital: MetricChange;
  /** USD per share. */
  price: MetricChange;
}

export interface MarketChange {
  /** Which window these numbers describe — the caller's, carried for honesty. */
  window: string;
  yes: SideChange;
  no: SideChange;
  /**
   * The whole market. Believers and capital are the two sides added, so the
   * centre panel and the side panels are the same arithmetic by construction.
   * There is no market-wide PRICE: a per-share price of "the market" is not a
   * quantity, and pretending otherwise is how a re-rate got called capital.
   */
  market: { believers: MetricChange; capital: MetricChange };
}

const RULE = {
  believers: METRIC_DISPLAY.believers,
  capital: METRIC_DISPLAY.capitalUsd,
  price: METRIC_DISPLAY.price,
} as const;

const NO_CHANGE: MetricChange = {
  current: null,
  base: null,
  delta: null,
  pct: null,
  rank: "unknown",
};

const fin = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

/** Pair a current with a base and let `gain` decide what may be said about it. */
export function metricChange(
  current: number | null | undefined,
  base: number | null | undefined,
  metric: ChangeMetric,
): MetricChange {
  const c = fin(current);
  const b = fin(base);
  const g: Gain = gain(c, b, RULE[metric]);
  return {
    current: c,
    base: g.rank === "unknown" ? null : b,
    delta: g.delta,
    pct: g.pct,
    rank: g.rank,
  };
}

/** Add two sides into the market-wide figure, keeping "unknown" infectious. */
function sum(a: MetricChange, b: MetricChange, metric: ChangeMetric): MetricChange {
  // A market total built from one known side and one unknown one would be a
  // smaller number presented as the whole — worse than saying nothing.
  if (a.current == null || b.current == null) return NO_CHANGE;
  if (a.base == null || b.base == null) {
    return metricChange(a.current + b.current, null, metric);
  }
  return metricChange(a.current + b.current, a.base + b.base, metric);
}

/** One side's three metrics, from a current state and a window-open baseline. */
export function sideChange(
  now: { believers?: number | null; capitalUsd?: number | null; priceUsd?: number | null },
  base: { believers?: number | null; capitalUsd?: number | null; priceUsd?: number | null } | null,
): SideChange {
  return {
    believers: metricChange(now.believers, base?.believers, "believers"),
    capital: metricChange(now.capitalUsd, base?.capitalUsd, "capital"),
    price: metricChange(now.priceUsd, base?.priceUsd, "price"),
  };
}

/** The current per-side state, as every caller already has it. */
export interface ChangeNow {
  yes: { believers?: number | null; capitalUsd?: number | null; priceUsd?: number | null };
  no: { believers?: number | null; capitalUsd?: number | null; priceUsd?: number | null };
}
export type ChangeBase = { yes: ChangeNow["yes"]; no: ChangeNow["no"] } | null;

/**
 * The authoritative current state, per side, off a `market_state`-shaped row.
 *
 * Lives here (not beside a hook) because the client panels AND the server list
 * loaders both read it, and two copies of "which columns are the current state"
 * is exactly the drift this module exists to end. The trade tape is never
 * consulted: replaying buys and sells accumulates float residue, and it is
 * capped at 1000 rows, so on a busy market it is not a second opinion — it is a
 * wrong one.
 */
export function nowFromRow(row: unknown): ChangeNow {
  const r = (row ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number | null =>
    v == null || !Number.isFinite(Number(v)) ? null : Number(v);
  return {
    yes: {
      believers: n(r["believers_yes"]),
      capitalUsd: n(r["yes_capital_usd"]),
      priceUsd: n(r["yes_price_usd"]),
    },
    no: {
      believers: n(r["believers_no"]),
      capitalUsd: n(r["no_capital_usd"]),
      priceUsd: n(r["no_price_usd"]),
    },
  };
}

/** Assemble the one shape. Both loaders below end here. */
export function marketChange(now: ChangeNow, base: ChangeBase, window: string): MarketChange {
  const yes = sideChange(now.yes, base?.yes ?? null);
  const no = sideChange(now.no, base?.no ?? null);
  return {
    window,
    yes,
    no,
    market: {
      believers: sum(yes.believers, no.believers, "believers"),
      capital: sum(yes.capital, no.capital, "capital"),
    },
  };
}

/**
 * LOADER A — from the fields `market_state` already carries, for every market.
 *
 * These are stored by the single writer (refresh-market.server), which derives
 * them from the same snapshot history the per-window baselines come from. The
 * base is recovered by subtraction rather than stored twice.
 *
 * THE PRICE BASE IS AN OBSERVED PRICE, NOT A STORED PERCENTAGE. `yesPriceBaseUsd`
 * comes from `market_state_snapshots` — the same history the per-window baselines
 * read. The old alternative, recovering a base by dividing out
 * `market_state.chg_24h_yes`, is gone: that column was a second producer of the
 * same fact on a different baseline, and it was null on all 2,762 markets.
 *
 * With no baseline the price change is unknown, which is not flat.
 */
export interface State24hRow {
  believersYes?: number | null;
  believersNo?: number | null;
  newBelieversYes24h?: number | null;
  newBelieversNo24h?: number | null;
  yesCapitalUsd?: number | null;
  noCapitalUsd?: number | null;
  yesCapitalDelta24h?: number | null;
  noCapitalDelta24h?: number | null;
  yesPriceUsd?: number | null;
  noPriceUsd?: number | null;
  /** Observed price ~24h ago (market_state_snapshots). Preferred — see above. */
  yesPriceBaseUsd?: number | null;
  noPriceBaseUsd?: number | null;
}

/** base = current − delta, but only when the delta is a real observation. */
const backOut = (current: number | null, delta: number | null): number | null =>
  current == null || delta == null ? null : current - delta;

export function changeFrom24hRow(r: State24hRow): MarketChange {
  const yesCap = fin(r.yesCapitalUsd);
  const noCap = fin(r.noCapitalUsd);
  const yesBel = fin(r.believersYes);
  const noBel = fin(r.believersNo);
  const yesPrice = fin(r.yesPriceUsd);
  const noPrice = fin(r.noPriceUsd);
  return marketChange(
    {
      yes: { believers: yesBel, capitalUsd: yesCap, priceUsd: yesPrice },
      no: { believers: noBel, capitalUsd: noCap, priceUsd: noPrice },
    },
    {
      yes: {
        believers: backOut(yesBel, fin(r.newBelieversYes24h)),
        capitalUsd: backOut(yesCap, fin(r.yesCapitalDelta24h)),
        priceUsd: fin(r.yesPriceBaseUsd),
      },
      no: {
        believers: backOut(noBel, fin(r.newBelieversNo24h)),
        capitalUsd: backOut(noCap, fin(r.noCapitalDelta24h)),
        priceUsd: fin(r.noPriceBaseUsd),
      },
    },
    "24h",
  );
}

/**
 * LOADER B — from a per-window snapshot baseline (market_window_baselines).
 *
 * Exact on any window and on any market, including one past the trade tape's
 * 1000-row cap. A missing baseline is passed through as null, which becomes
 * rank "unknown" — "no history at this boundary", never "no change".
 */
export interface WindowBaselineLike {
  believersYes: number | null;
  believersNo: number | null;
  yesCapitalUsd: number | null;
  noCapitalUsd: number | null;
  yesPriceUsd: number | null;
  noPriceUsd: number | null;
}

export function changeFromBaseline(
  now: ChangeNow,
  baseline: WindowBaselineLike | null | undefined,
  window: string,
): MarketChange {
  return marketChange(
    now,
    baseline == null
      ? null
      : {
          yes: {
            believers: baseline.believersYes,
            capitalUsd: baseline.yesCapitalUsd,
            priceUsd: baseline.yesPriceUsd,
          },
          no: {
            believers: baseline.believersNo,
            capitalUsd: baseline.noCapitalUsd,
            priceUsd: baseline.noPriceUsd,
          },
        },
    window,
  );
}

// ---------------------------------------------------------------------------
// MAJOR NEWS
// ---------------------------------------------------------------------------

/**
 * A move of five percent or more is news, and the feeds must say so.
 *
 * WHY IT IS GATED ON `rank` AND NOT ON THE NUMBER. Five percent of nothing is
 * still nothing. Measured across 2,000 live sides, 22% of funded sides hold less
 * than one cent; on those, every trade is thousands of percent, and a news rule
 * that fired on the ratio alone would fill the feed with five-cent moves and
 * call them major. "Major news" that fires on everything is not major news, it
 * is a broken filter — so the percentage path requires the percentage to be real
 * (see gain: rank `quiet` or `headline`).
 *
 * WHAT THE GATE COSTS, stated plainly rather than discovered later:
 *
 *   PRICE     every side qualifies (no side is priced near zero), and a 5% move
 *             sits above the 95th percentile of price movement — genuinely rare,
 *             genuinely news.
 *   CAPITAL   about a third of funded sides carry a base of a dollar or more and
 *             can produce a ratio at all.
 *   BELIEVERS a ratio needs a base of ten, and only 1% of sides have ten
 *             believers. So the percentage rule is very nearly unreachable for
 *             believers, and it SHOULD be: 1 → 3 people is "+2 believers", not
 *             "+200%". Believer news therefore travels on the absolute path
 *             below and through the milestone and doubling storytellers that
 *             already exist — not by pretending a count has a rate.
 *
 * AN ORIGIN IS ALWAYS NEWS. A side going from nothing to something is the
 * largest thing that can happen to it, and it has no percentage at all. It is
 * reported as the arrival it is.
 *
 * AND A CURRENCY MOVE IS NOT A MARKET MOVE. Every price and capital figure on
 * this platform is stored in USD, and a share is worth a fixed 0.001 ETH until
 * somebody trades it — so the dollar value of every market moves together, with
 * the exchange rate, having done nothing.
 *
 * That is not a theory. Measured across 1,194 live sides over one 24h window,
 * the USD price change was +1.196% at the 5th percentile, the 25th, the 50th,
 * the 75th AND the 95th; not a single side was flat. The identical term sits
 * inside the capital change (p25 +1.197%, p50 +1.243%, p75 +1.255%).
 *
 * At a five percent bar a one percent drift is invisible — until the day ETH
 * moves five percent, when this rule as literally specified would have declared
 * a MAJOR MOVE on all 2,762 markets at once and buried every real story on the
 * platform under the exchange rate.
 *
 * So a rate move is judged NET OF THE DRIFT, and the drift is measured rather
 * than assumed: it is the move the whole cross-section shares (`currencyDrift`).
 * Counts are exempt — a believer is not denominated in anything.
 */
export const MATERIAL = {
  /** The line the product asked for: five percent, where a percent is real. */
  minPct: 5,
  /** Below this many observations the cross-section cannot measure a drift. */
  minDriftSamples: 8,
  /**
   * Believers move in whole people, so the absolute path needs its own bar.
   * Three arrivals on one side inside a window is above the 90th percentile of
   * side size on this platform — a real crowd forming, not a trade.
   */
  minBelieverDelta: 3,
  /**
   * An origin only counts once the arrival is worth naming. Below this the
   * "first capital" is a rounding artefact, not an event.
   */
  minOriginUsd: 1,
  /**
   * Where the DOLLAR half of significance saturates — beyond this, more money
   * affected is not more news.
   *
   * Fifty, which is deliberately well above the typical market here (median
   * total capital $0.96, p90 $5.38) and well below the largest ($14.7k). A cap
   * at the median would flatten the term to 1.0 for anything ordinary and it
   * would stop discriminating; a cap at the maximum would push every real
   * market to nearly zero and reinstate the dollar-only ranking this exists to
   * avoid. Fifty puts the platform's genuinely substantial books in the top
   * half of the curve and leaves the dust at the bottom.
   */
  significantUsd: 50,
} as const;

/**
 * Saturating 0..1 normaliser — diminishing returns, never dominated by one whale.
 *
 * Deliberately a local copy of the same shape as @/domain/feed/config#sat. This
 * module is read by the market panels, which must not depend on the feed, and a
 * three-line log curve is a smaller cost than that layering inversion.
 */
const saturate = (value: number, cap: number): number => {
  if (!(value > 0) || !(cap > 0)) return 0;
  return Math.log1p(Math.min(value, cap)) / Math.log1p(cap);
};

/**
 * SIGNIFICANCE — the two proofs a move has to offer, combined.
 *
 * THE QUESTION THIS ANSWERS: should a dramatic percentage move in a tiny market
 * outrank a smaller percentage move in a meaningfully larger one? The archetype
 * harness made the failure concrete — a $2 market losing $1.90 outranked a $104
 * market moving 9%, because `weight` was purely a percentage.
 *
 * Neither signal works alone:
 *
 *   PERCENTAGE ONLY  a platform whose median market holds under a dollar turns
 *                    into a feed of five-cent moves wearing three-digit
 *                    percentages.
 *   DOLLARS ONLY     permanently buries every small market, which on this
 *                    platform is almost all of them.
 *
 * So: the RELATIVE move proves it mattered to this market, and the ABSOLUTE
 * capital affected proves enough really moved to be worth reporting. The
 * geometric mean is the shape that says AND — both must be present, and
 * strength in one only partly compensates for weakness in the other. A small
 * market can still qualify, but it needs a truly exceptional move; a large one
 * qualifies on a smaller relative move because more capital was affected.
 *
 * COUNTS ARE EXEMPT, and that is not an oversight. A believer count is already
 * an absolute measure of itself — there is no second unit to weigh it in — and
 * `gain` makes a believer percentage very nearly unreachable on purpose. Crowd
 * moves weigh on |delta| directly, which is the same rule expressed in the only
 * unit they have.
 */
export function significance(relativeMove: number, usdAffected: number): number {
  // Both inputs come off nullable columns, and NaN survives Math.min/max
  // untouched — it would sail through the clamp and out the other side as a
  // NaN weight, which sorts unpredictably and silently scrambles an order.
  const rel = Number.isFinite(relativeMove) ? Math.min(1, Math.max(0, relativeMove)) : 0;
  const usd = Number.isFinite(usdAffected) ? usdAffected : 0;
  return Math.sqrt(rel * saturate(usd, MATERIAL.significantUsd));
}

/**
 * The bar a move must clear. A POLICY, separate from the derivation.
 *
 * `MATERIAL` is one setting of it — the news bar, for interrupting a reader.
 * "Is this moving?" is a different question asked by a reader who came looking,
 * and it deserves a lower bar (see @/domain/feed/momentum). Both must come out
 * of ONE derivation or the two answers drift apart, so the bar is passed in
 * rather than read from a constant inside.
 *
 * This was very nearly shipped the other way: the momentum lens declared a 3%
 * threshold while calling `materialMoves`, which had already dropped everything
 * under 5% — a lower threshold that could never be reached, which is the exact
 * shape of bug this codebase keeps producing.
 */
export interface MoveBar {
  minPct: number;
  minBelieverDelta: number;
  minOriginUsd: number;
}

export type MoveKind = "rate" | "arrival" | "crowd";

export interface MaterialMove {
  metric: ChangeMetric;
  /** null when the move is the market as a whole. */
  side: Side | null;
  direction: "up" | "down";
  kind: MoveKind;
  /** Present for `rate` moves only — the others have no honest percentage. */
  pct: number | null;
  delta: number;
  /** How big this is on the shared 0..1 significance scale. */
  weight: number;
}

/**
 * |pct| ≥ 5 net of currency drift, and the percentage is one `gain` produced.
 *
 * `driftPct` defaults to zero, which is the honest reading of "the cross-section
 * was not available to measure it" — never an assumption that there was none.
 */
export function isRateMove(m: MetricChange, driftPct = 0, bar: MoveBar = MATERIAL): boolean {
  return (
    (m.rank === "quiet" || m.rank === "headline") &&
    m.pct != null &&
    Math.abs(m.pct - driftPct) >= bar.minPct
  );
}

/**
 * The move the whole cross-section shares — i.e. the currency, not any market.
 *
 * The median, because the typical market on this platform has never traded: its
 * dollar price changes ONLY because the exchange rate did. So the middle of the
 * distribution is the drift by construction, and the tails are the real moves
 * the news rule exists to find. A handful of samples cannot establish a
 * cross-section, so below `minDriftSamples` this returns null and callers pass
 * no drift rather than a guess from three markets.
 */
export function currencyDrift(pcts: readonly (number | null)[]): number | null {
  const xs = pcts.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length < MATERIAL.minDriftSamples) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function rate(
  m: MetricChange,
  metric: ChangeMetric,
  side: Side | null,
  driftPct: number,
  bar: MoveBar,
  /**
   * The dollars this move actually put at stake.
   *
   * For CAPITAL it is the money that moved. For PRICE it is the side's capital,
   * because a price is per-share and its own delta is cents by construction — a
   * 9% re-rate of a $104 book moves more than a 9% re-rate of a $2 one, and the
   * price delta alone cannot tell them apart.
   */
  usdAtStake: number,
): MaterialMove | null {
  if (!isRateMove(m, driftPct, bar) || m.pct == null || m.delta == null) return null;
  // Believers are a count and carry no currency; price and capital are dollars.
  //
  // AND THE RESULT IS FLOORED AT −100%, because a quantity that cannot go below
  // zero cannot fall by more than all of itself. The drift subtraction is a
  // real-terms adjustment and it happily walks past that boundary: a side that
  // lost ALL its capital on a day the currency rose 1% computes to −101%, which
  // the archetype harness printed sixteen times before this line existed. In
  // real terms −101% is arguably correct and as a sentence shown to a person it
  // is simply wrong, and being wrong in a checkable way is how a feed loses the
  // reader it just spent a paragraph convincing.
  const adjusted = metric === "believers" ? m.pct : m.pct - driftPct;
  const net = Math.max(adjusted, -100);
  const abs = Math.abs(net);
  return {
    metric,
    side,
    direction: net > 0 ? "up" : "down",
    kind: "rate",
    // The reported percentage is the one that cleared the bar — the market's own
    // move. Reporting the raw figure beside a headline earned by the net one
    // would be the same number meaning two things.
    pct: net,
    delta: m.delta,
    // TWO SIGNALS, not one. The relative term is the old curve — the entry bar
    // must not also be the top of the scale, so a 5% move and a 60% move are
    // not the same news — and it is now weighed against the capital actually
    // affected. See `significance`. Counts keep the relative term alone,
    // because a count has no second unit.
    weight:
      metric === "believers"
        ? Math.min(1, 0.5 + (abs - bar.minPct) / 100)
        : significance(Math.min(1, 0.5 + (abs - bar.minPct) / 100), usdAtStake),
  };
}

function arrival(
  m: MetricChange,
  metric: ChangeMetric,
  side: Side | null,
  bar: MoveBar,
): MaterialMove | null {
  if (m.rank !== "origin" || m.delta == null || m.current == null) return null;
  if (metric === "capital" && m.current < bar.minOriginUsd) return null;
  if (metric === "believers" && m.current < 1) return null;
  return { metric, side, direction: "up", kind: "arrival", pct: null, delta: m.delta, weight: 0.8 };
}

function crowd(m: MetricChange, side: Side | null, bar: MoveBar): MaterialMove | null {
  if (m.rank === "unknown" || m.delta == null) return null;
  if (Math.abs(m.delta) < bar.minBelieverDelta) return null;
  // An origin is already reported as an arrival; do not say it twice.
  if (m.rank === "origin") return null;
  return {
    metric: "believers",
    side,
    direction: m.delta > 0 ? "up" : "down",
    kind: "crowd",
    pct: m.pct,
    delta: m.delta,
    weight: Math.min(1, 0.6 + Math.abs(m.delta) / 40),
  };
}

/**
 * Every move in this window that clears the bar, heaviest first.
 *
 * Per SIDE, not market-wide: "YES capital rose 40%" is a claim about the
 * argument, while the market total can be flat because NO fell by as much. The
 * market-wide figures stay in `MarketChange` for the panels that show a total;
 * the news is about a side taking or losing ground.
 */
export function sideMaterialMoves(
  s: SideChange,
  side: Side | null,
  driftPct = 0,
  bar: MoveBar = MATERIAL,
): MaterialMove[] {
  // AT MOST ONE MOVE PER METRIC. A side that gained four believers off a base of
  // twenty is both a 20% rate and a crowd of four; reporting both would announce
  // one event twice and let it outrank a market where two genuinely different
  // things happened.
  // What this side has on the table — the absolute half of significance for a
  // price move, whose own delta is per-share cents and says nothing about size.
  const sideCapital = Math.abs(s.capital.current ?? 0);
  return [
    rate(s.price, "price", side, driftPct, bar, sideCapital),
    rate(s.capital, "capital", side, driftPct, bar, Math.abs(s.capital.delta ?? 0)) ??
      arrival(s.capital, "capital", side, bar),
    rate(s.believers, "believers", side, driftPct, bar, 0) ??
      crowd(s.believers, side, bar) ??
      arrival(s.believers, "believers", side, bar),
  ].filter((m): m is MaterialMove => m != null);
}

/**
 * @param driftPct the move every market shares because the CURRENCY moved. Pass
 * `currencyDrift(...)` measured over the batch; zero means "not measurable
 * here", which is the same behaviour this had before the drift was found.
 */
export function materialMoves(
  c: MarketChange,
  driftPct: number | null = 0,
  bar: MoveBar = MATERIAL,
): MaterialMove[] {
  const d = driftPct ?? 0;
  return [
    ...sideMaterialMoves(c.yes, "YES", d, bar),
    ...sideMaterialMoves(c.no, "NO", d, bar),
  ].sort((a, b) => b.weight - a.weight);
}

/** The single most newsworthy move in this window, or null on a quiet market. */
export function topMaterialMove(
  c: MarketChange,
  driftPct: number | null = 0,
  bar: MoveBar = MATERIAL,
): MaterialMove | null {
  return materialMoves(c, driftPct, bar)[0] ?? null;
}
