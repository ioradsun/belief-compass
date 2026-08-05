/**
 * METRIC DISPLAY — the one rule for how a number is shown, everywhere.
 *
 * The product shows the same five metrics on many surfaces (believers, capital,
 * price, personal position, YES/NO split). Before this module each surface made
 * its own call about whether to lead with a percentage or an actual amount, so a
 * "−86%" could headline a market that is really ±$2. This encodes a single rule
 * so every surface agrees:
 *
 *   • The CURRENT state is always an actual number (a count, an amount, a price).
 *   • MOVEMENT is both an absolute change AND a percentage — then each surface
 *     leads with whichever a human reads faster for that metric:
 *
 *       believers → the count leads   ("+1 believer")   — humans are discrete
 *       capital   → the money leads   ("−$209.56")      — reveals real scale
 *       price     → the percentage leads ("+12%")       — traders read price as %
 *       position  → the P&L leads     ("+$8.42")        — answers "what did I make?"
 *
 *   • SMALL-NUMBER PROTECTION: a percentage off a tiny base is noise ("+100%" =
 *     one believer became two). Below a per-metric base it never HEADLINES; below
 *     an even smaller base it isn't shown at all. `pctRank` says which.
 *
 * ZERO IO, pure, fully testable. Money is unit-agnostic: callers pass a formatter
 * (they own the USD/ETH choice and the live rate), so this stays free of display
 * units exactly like side-lens and position-story.
 */

export type Direction = "up" | "down" | "flat";

/**
 * How loudly a percentage may speak, given its base:
 *   headline — the base is large enough to trust; the % can be the lead figure.
 *   quiet    — real but small base; show the % small/muted, never as the headline.
 *   none     — no meaningful denominator (base ≤ 0); don't show a % at all.
 */
export type PctRank = "headline" | "quiet" | "none";

/** Per-metric thresholds. Bases are in the metric's own unit (USD for capital). */
export const METRIC_DISPLAY = {
  /** Discrete people: a % needs a base, and only leads once the crowd is real. */
  believers: { pctValidMinBase: 1, pctHeadlineMinBase: 10 },
  /** Capital, judged in USD so the display unit never changes what's "small". */
  capitalUsd: { pctValidMinBase: 1, pctHeadlineMinBase: 10, flatEps: 0.5 },
  /** Price re-rates continuously; a % is meaningful even on a small market. */
  price: { flatPct: 1 },
} as const;

/** Direction of a move, with an epsilon so an immaterial wiggle reads flat. */
export function metricDirection(delta: number, eps = 0): Direction {
  if (!Number.isFinite(delta)) return "flat";
  if (delta > eps) return "up";
  if (delta < -eps) return "down";
  return "flat";
}

/** delta / base × 100, or null when there is no positive base to divide by. */
export function pctOf(delta: number, base: number): number | null {
  return base > 0 && Number.isFinite(delta) ? (delta / base) * 100 : null;
}

/** How loudly the % for this base may speak (see PctRank). */
export function pctRank(base: number, validMin: number, headlineMin: number): PctRank {
  if (base < validMin) return "none";
  return base >= headlineMin ? "headline" : "quiet";
}

/**
 * A percentage as text: signed by default (+12% / −4%). Two precisions:
 *   default — a headline magnitude read: one decimal only when it matters
 *     (|pct| < 10), integer otherwise, so "−86%" and "+12%" stay clean.
 *   precise — round to one decimal and drop a trailing ".0", so a personal
 *     return reads "+84.2%" but a whole number stays "−25%".
 * Flat reads "0%".
 */
export function formatPct(pct: number, opts: { signed?: boolean; precise?: boolean } = {}): string {
  const { signed = true, precise = false } = opts;
  const abs = Math.abs(pct);
  if (abs < 0.05) return "0%";
  const body = precise
    ? abs.toFixed(1).replace(/\.0$/, "")
    : abs < 10
      ? abs.toFixed(1).replace(/\.0$/, "")
      : String(Math.round(abs));
  const sign = pct > 0 ? (signed ? "+" : "") : "−";
  return `${sign}${body}%`;
}

/** The two movement lines a surface renders for one metric. */
export interface MetricMove {
  direction: Direction;
  /** e.g. "+14%" — present only when the % is allowed to show (rank ≠ none). */
  pct: string | null;
  /** true when `pct` exists but must stay quiet (small base — never the headline). */
  pctQuiet: boolean;
  /** The exact change with its timeframe, e.g. "+1 believer over 1D". Always shown. */
  absolute: string;
}

/**
 * BELIEVERS — the count is the truth; the % only colours it. `since` is the
 * window phrase ("over 1D" / "since open"). Cold start (opened inside the window)
 * has no denominator, so it states the arrival plainly.
 */
export function believerMove(current: number, base: number, since: string): MetricMove {
  const delta = current - base;
  const direction = metricDirection(delta);
  const cfg = METRIC_DISPLAY.believers;

  if (base === 0 && current > 0) {
    return {
      direction: "up",
      pct: null,
      pctQuiet: false,
      absolute: current === 1 ? "First believer" : `+${current} believers ${since}`,
    };
  }

  const rank = pctRank(base, cfg.pctValidMinBase, cfg.pctHeadlineMinBase);
  const pctVal = pctOf(delta, base);
  const pct = rank !== "none" && pctVal != null ? formatPct(pctVal) : null;

  if (delta === 0) {
    return { direction: "flat", pct, pctQuiet: rank === "quiet", absolute: `No change ${since}` };
  }
  const n = Math.abs(delta);
  return {
    direction,
    pct,
    pctQuiet: rank === "quiet",
    absolute: `${delta > 0 ? "+" : "−"}${n} believer${n === 1 ? "" : "s"} ${since}`,
  };
}

/**
 * CAPITAL — the money leads. Materiality (direction, whether a % is real) is judged
 * in USD so the display unit never changes the story; the shown figures come from
 * `money`, which converts the ETH-native amount into the viewer's chosen unit.
 */
export function capitalMove(input: {
  currentEth: number;
  baseEth: number;
  since: string;
  usd: (eth: number) => number;
  money: (eth: number, signed?: boolean) => string;
}): MetricMove {
  const { currentEth, baseEth, since, usd, money } = input;
  const delta = currentEth - baseEth;
  const baseUsd = usd(baseEth);
  const deltaUsd = usd(delta);
  const cfg = METRIC_DISPLAY.capitalUsd;
  const direction = metricDirection(deltaUsd, cfg.flatEps);

  if (baseUsd < cfg.flatEps && usd(currentEth) > cfg.flatEps) {
    return {
      direction: "up",
      pct: null,
      pctQuiet: false,
      absolute: `First capital · ${money(currentEth)}`,
    };
  }

  const rank = pctRank(baseUsd, cfg.pctValidMinBase, cfg.pctHeadlineMinBase);
  const pctVal = pctOf(deltaUsd, baseUsd);
  const pct = rank !== "none" && pctVal != null ? formatPct(pctVal) : null;

  if (direction === "flat") {
    return { direction, pct, pctQuiet: rank === "quiet", absolute: `No change ${since}` };
  }
  return {
    direction,
    pct,
    pctQuiet: rank === "quiet",
    absolute: `${money(delta, true)} ${direction === "down" ? "left" : "committed"} ${since}`,
  };
}

/**
 * PRICE — the percentage leads (traders read price proportionally), but the rule
 * still forbids "% only": we pair it with the exact price change and the caller
 * shows the current price beside it. `money` formats the per-share price change.
 */
export function priceMove(input: {
  pricePct: number | null;
  priceDelta: number | null;
  since: string;
  money: (v: number, signed?: boolean) => string;
}): MetricMove {
  const { pricePct, priceDelta, since, money } = input;
  if (pricePct == null) {
    return { direction: "flat", pct: null, pctQuiet: false, absolute: "" };
  }
  const direction: Direction =
    Math.abs(pricePct) < METRIC_DISPLAY.price.flatPct ? "flat" : pricePct > 0 ? "up" : "down";
  const pct = formatPct(pricePct);
  const absolute =
    priceDelta == null || direction === "flat"
      ? direction === "flat"
        ? `Flat ${since}`
        : ""
      : `${money(priceDelta, true)} ${since}`;
  return { direction, pct, pctQuiet: false, absolute };
}

/**
 * PERSONAL POSITION — the P&L leads ("what did I make?"), the return % is paired.
 * Both come straight from positionPnl (an authoritative cost basis vs a live mark),
 * never from a market's price %. `money` formats the signed dollar P&L.
 */
export function positionReturn(input: {
  gainUsd: number | null;
  gainPct: number | null;
  money: (usd: number, signed?: boolean) => string;
}): { direction: Direction; pnl: string; pct: string | null } | null {
  const { gainUsd, gainPct, money } = input;
  if (gainUsd == null) return null;
  const direction = metricDirection(gainUsd, 0.005);
  // Flat is flat: "+$0.00 / +0.0%" reads as a result when nothing happened. A
  // single em dash says "no movement" without pretending to be a number.
  if (direction === "flat") return { direction, pnl: "—", pct: null };
  return {
    direction,
    pnl: money(gainUsd, true),
    pct: gainPct == null ? null : formatPct(gainPct, { precise: true }),
  };
}

