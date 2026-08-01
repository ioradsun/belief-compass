/**
 * Side lens — one side, investigated through one metric at a time.
 *
 * A side panel used to show believers, capital and price at once under a single
 * unlabeled sparkline, so the chart had no identity. This module gives the panel
 * three explicit lenses instead — believers (👥), capital (💰), price (📈) — and
 * for the SELECTED lens derives everything the chart needs to answer exactly one
 * question:
 *
 *     Believers → Are more people joining this side?
 *     Capital   → Are believers committing more, or pulling back?
 *     Price     → How has the market valued this side?
 *
 * That order mirrors how conviction forms: People → Money → Price. This module is
 * ZERO IO and pure — money arrives in ETH and the caller supplies the USD rate, so
 * copy stays unit-agnostic and fully testable.
 */
import type { SeriesPoint } from "./conviction-series";

export type LensMetric = "believers" | "capital" | "price";

/** People first, money second, price last — conviction is built in that order. */
export const LENS_ORDER: LensMetric[] = ["believers", "capital", "price"];

export interface LensMeta {
  icon: string;
  /** The chart's explicit title — the user never wonders what they're looking at. */
  title: string;
  /** Believers/capital move in discrete steps; price re-rates continuously. */
  kind: "step" | "line";
}

export const LENS_META: Record<LensMetric, LensMeta> = {
  believers: { icon: "👥", title: "Believer Trend", kind: "step" },
  capital: { icon: "💰", title: "Capital Trend", kind: "step" },
  price: { icon: "📈", title: "Price Trend", kind: "line" },
};

/** The raw value this lens plots at a point, or null when the point has none
 *  (price before the side's first trade). Never mixes one metric into another. */
export function lensValue(p: SeriesPoint, m: LensMetric): number | null {
  return m === "believers" ? p.believers : m === "capital" ? p.capital : p.price;
}

export interface LensMarker {
  /** Epoch ms — the chart maps this onto its own x-axis. */
  t: number;
  label: string;
  dir: "up" | "down" | "flat";
}

/** The window's own start→end facts for one lens. Pure read of the series. */
export interface LensFacts {
  believerDelta: number;
  capitalDeltaEth: number;
  pricePct: number | null;
  hasPrice: boolean;
  /** Total capital that left across the window (ETH, positive). */
  outflowEth: number;
  /** The single largest capital exit in the window (ETH, positive). */
  biggestExitEth: number;
}

export function lensFacts(series: SeriesPoint[]): LensFacts {
  if (series.length < 2) {
    const only = series[0];
    return {
      believerDelta: 0,
      capitalDeltaEth: 0,
      pricePct: only?.pricePct ?? null,
      hasPrice: only?.price != null,
      outflowEth: 0,
      biggestExitEth: 0,
    };
  }
  const a = series[0];
  const z = series[series.length - 1];
  let outflowEth = 0;
  let biggestExitEth = 0;
  for (let i = 1; i < series.length; i += 1) {
    const d = series[i].capital - series[i - 1].capital;
    if (d < 0) {
      const exit = -d;
      outflowEth += exit;
      if (exit > biggestExitEth) biggestExitEth = exit;
    }
  }
  return {
    believerDelta: z.believers - a.believers,
    capitalDeltaEth: z.capital - a.capital,
    pricePct: z.pricePct,
    hasPrice: series.some((p) => p.price != null),
    outflowEth,
    biggestExitEth,
  };
}

/** A single exit that carried most of the window's outflow is its own story. */
const DOMINANT_EXIT_SHARE = 0.6;
/** Below this ETH the capital move is noise, not a story. */
const CAPITAL_STEADY_ETH = 1e-9;
/** Below this |%| the price line is flat, not a move. */
const PRICE_FLAT_PCT = 1;

/**
 * The one sentence under the chart — always about the SELECTED lens, so the story
 * can never drift from what's drawn. `money` formats ETH → the caller's currency;
 * `when` is the window phrase ("today", "this week").
 */
export function lensStory(
  metric: LensMetric,
  side: "YES" | "NO",
  facts: LensFacts,
  when: string,
  money: (eth: number) => string,
): string {
  if (metric === "believers") {
    const d = facts.believerDelta;
    if (d <= 0) return `No new believers backed ${side} ${when}.`;
    if (d === 1) return `One new believer backed ${side} ${when}.`;
    return `${d} believers joined ${side} ${when}.`;
  }
  if (metric === "capital") {
    const d = facts.capitalDeltaEth;
    if (
      d < 0 &&
      facts.outflowEth > 0 &&
      facts.biggestExitEth >= facts.outflowEth * DOMINANT_EXIT_SHARE
    ) {
      return `Most capital left ${side} in one large exit.`;
    }
    if (Math.abs(d) < CAPITAL_STEADY_ETH) return `Capital in ${side} held steady ${when}.`;
    if (d > 0) return `${money(d)} entered ${side} ${when}.`;
    return `${money(-d)} left ${side} ${when}.`;
  }
  // price
  if (!facts.hasPrice || facts.pricePct == null) {
    return `The market hasn't priced ${side} yet.`;
  }
  const p = facts.pricePct;
  if (Math.abs(p) < PRICE_FLAT_PCT) return `${side} share price has stayed flat ${when}.`;
  if (p > 0) return `${side} share price climbed ${when}.`;
  return `${side} share price weakened ${when}.`;
}

/**
 * Cold start: with too little history, say so plainly instead of drawing a
 * meaningless flat line. Returns the copy to show, or null when the chart is real.
 */
export function lensColdStart(metric: LensMetric, series: SeriesPoint[]): string | null {
  if (metric === "price") {
    const priced = series.filter((p) => p.price != null);
    if (priced.length < 2)
      return "Not enough price history yet.\nConviction is just beginning to form.";
    return null;
  }
  if (series.length < 2) {
    return metric === "believers"
      ? "Waiting for more believers.\nHistory will appear as this side grows."
      : "Not enough history yet.\nConviction is just beginning to form.";
  }
  return null;
}

/**
 * Up to two markers for the SELECTED lens, placed on real moves in the drawn
 * series so a marker never points at nothing. Believers/capital mark their biggest
 * steps (one up + one down when both exist); price marks its high and low.
 */
export function lensMarkers(
  metric: LensMetric,
  series: SeriesPoint[],
  money: (eth: number) => string,
): LensMarker[] {
  if (series.length < 2) return [];

  if (metric === "price") {
    const priced = series.filter((p) => p.price != null);
    if (priced.length < 2) return [];
    let hi = priced[0];
    let lo = priced[0];
    for (const p of priced) {
      if ((p.price ?? 0) > (hi.price ?? 0)) hi = p;
      if ((p.price ?? 0) < (lo.price ?? 0)) lo = p;
    }
    if (hi.t === lo.t || (hi.price ?? 0) <= (lo.price ?? 0)) return [];
    return [
      { t: hi.t, label: "High", dir: "up" as const },
      { t: lo.t, label: "Low", dir: "down" as const },
    ].sort((a, b) => a.t - b.t);
  }

  // Step lenses: the biggest jump up and the biggest drop, at most one of each.
  let up: { t: number; d: number } | null = null;
  let down: { t: number; d: number } | null = null;
  for (let i = 1; i < series.length; i += 1) {
    const d = lensValue(series[i], metric)! - lensValue(series[i - 1], metric)!;
    if (d > 0 && (!up || d > up.d)) up = { t: series[i].t, d };
    if (d < 0 && (!down || d < down.d)) down = { t: series[i].t, d };
  }
  const label = (d: number): string =>
    metric === "believers" ? (d > 0 ? `+${d}` : `${d}`) : d > 0 ? `+${money(d)}` : `−${money(-d)}`;
  const out: LensMarker[] = [];
  if (up) out.push({ t: up.t, label: label(up.d), dir: "up" });
  if (down) out.push({ t: down.t, label: label(down.d), dir: "down" });
  return out.sort((a, b) => a.t - b.t);
}
