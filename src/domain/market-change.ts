/**
 * MARKET CHANGE — what moved, computed once, read everywhere.
 *
 * THE PROBLEM THIS EXISTS TO END. "How much did this market change over the
 * window?" had four independent answers, on three different tiers:
 *
 *   1. SQL          `recompute_price_changes` → market_state.chg_24h_yes/no, and
 *                   `market_change_window` → market_window_change.chg_yes/no.
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
} as const;

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
export function isRateMove(m: MetricChange, driftPct = 0): boolean {
  return (
    (m.rank === "quiet" || m.rank === "headline") &&
    m.pct != null &&
    Math.abs(m.pct - driftPct) >= MATERIAL.minPct
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
): MaterialMove | null {
  if (!isRateMove(m, driftPct) || m.pct == null || m.delta == null) return null;
  // Believers are a count and carry no currency; price and capital are dollars.
  const net = metric === "believers" ? m.pct : m.pct - driftPct;
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
    // Five percent is the entry bar, so it must not also be the top of the
    // scale — a 5% move and a 60% move are not the same news. Saturating rather
    // than clamping at the bar keeps the ordering meaningful.
    weight: Math.min(1, 0.5 + (abs - MATERIAL.minPct) / 100),
  };
}

function arrival(m: MetricChange, metric: ChangeMetric, side: Side | null): MaterialMove | null {
  if (m.rank !== "origin" || m.delta == null || m.current == null) return null;
  if (metric === "capital" && m.current < MATERIAL.minOriginUsd) return null;
  if (metric === "believers" && m.current < 1) return null;
  return { metric, side, direction: "up", kind: "arrival", pct: null, delta: m.delta, weight: 0.8 };
}

function crowd(m: MetricChange, side: Side | null): MaterialMove | null {
  if (m.rank === "unknown" || m.delta == null) return null;
  if (Math.abs(m.delta) < MATERIAL.minBelieverDelta) return null;
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
export function sideMaterialMoves(s: SideChange, side: Side | null, driftPct = 0): MaterialMove[] {
  // AT MOST ONE MOVE PER METRIC. A side that gained four believers off a base of
  // twenty is both a 20% rate and a crowd of four; reporting both would announce
  // one event twice and let it outrank a market where two genuinely different
  // things happened.
  return [
    rate(s.price, "price", side, driftPct),
    rate(s.capital, "capital", side, driftPct) ?? arrival(s.capital, "capital", side),
    rate(s.believers, "believers", side, driftPct) ??
      crowd(s.believers, side) ??
      arrival(s.believers, "believers", side),
  ].filter((m): m is MaterialMove => m != null);
}

/**
 * @param driftPct the move every market shares because the CURRENCY moved. Pass
 * `currencyDrift(...)` measured over the batch; zero means "not measurable
 * here", which is the same behaviour this had before the drift was found.
 */
export function materialMoves(c: MarketChange, driftPct: number | null = 0): MaterialMove[] {
  const d = driftPct ?? 0;
  return [...sideMaterialMoves(c.yes, "YES", d), ...sideMaterialMoves(c.no, "NO", d)].sort(
    (a, b) => b.weight - a.weight,
  );
}

/** The single most newsworthy move in this window, or null on a quiet market. */
export function topMaterialMove(c: MarketChange, driftPct: number | null = 0): MaterialMove | null {
  return materialMoves(c, driftPct)[0] ?? null;
}
