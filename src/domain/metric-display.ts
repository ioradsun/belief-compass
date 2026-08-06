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
 *     an even smaller base it isn't shown at all.
 *
 *   • THE FIRST MONEY IN IS NOT A GAIN. Growth is measured against something
 *     that was already there. When a side goes from nothing to something there
 *     is no proportion to state, only an arrival. `gain` — the second half of
 *     this file — is the single entry point every surface asks before it prints
 *     a percentage, and it is what the ranks above are for.
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
 *   none     — the base is below the metric's floor; don't show a % at all.
 *
 * `GainRank` below is this plus the two cases a bare rank cannot express: no
 * baseline at all, and a baseline of nothing. Prefer `gain`.
 */
export type PctRank = "headline" | "quiet" | "none";

/**
 * Per-metric thresholds. Bases are in the metric's own unit (USD for capital).
 *
 * CALIBRATED AGAINST THE MARKETS THAT EXIST, not against a guess. Measured over
 * 1,000 market_state rows (2,000 sides), counting only sides that hold anything:
 *
 *   capital per side  383 funded · p10 $0.0095 · p25 $0.016 · p50 $0.95
 *                     p75 $1.91 · p90 $5.16 · p95 $14.32 · max $265
 *                     85 of them (22%) hold LESS THAN ONE CENT
 *   believers/side    395 non-empty · p50 1 · p75 2 · p90 3 · p95 5 · max 34
 *                     only 4 sides (1%) have ten or more
 *   price per share   min $1.905 · p50 $1.905 · p95 $1.96 — never near zero
 *
 * That distribution is the whole argument. A percentage divides by the base, so
 * on a platform where a fifth of funded sides hold sub-cent dust, an unguarded
 * ratio does not measure the move — it measures how empty the market was.
 */
export const METRIC_DISPLAY = {
  /**
   * Discrete people. `pctValidMinBase` is TEN, not one: with a median side of
   * one believer, a ratio below ten is just the count restated with worse
   * precision — 1 → 3 people is "+2 believers", never "+200%". Only 1% of sides
   * are large enough for the ratio to add anything, and those are exactly the
   * ones where it does.
   */
  believers: { originMaxBase: 0, pctValidMinBase: 10, pctHeadlineMinBase: 10 },
  /**
   * Capital, judged in USD so the display unit never changes what's "small".
   * `originMaxBase` is the app's own dust line: elsewhere it already refuses to
   * let sub-cent capital seed a believer, so it must not divide by it either.
   */
  capitalUsd: {
    originMaxBase: 0.01,
    pctValidMinBase: 1,
    pctHeadlineMinBase: 10,
    flatEps: 0.5,
  },
  /**
   * Price re-rates continuously and never approaches zero here (min observed
   * $1.905), so the floor is a guard against a future sub-cent share rather
   * than a rule that binds today.
   */
  price: { originMaxBase: 0, pctValidMinBase: 0.01, pctHeadlineMinBase: 0.01, flatPct: 1 },
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
 * THE FIRST MONEY IN IS NOT A GAIN.
 *
 * A percentage answers "how much did this grow, relative to what was already
 * here?". That question needs a *here* to have existed. When a side goes from
 * nothing to something there is no proportion to state — only an arrival — and
 * an unguarded ratio turns the emptiness of the denominator into a headline.
 *
 * This is not hypothetical. A live market showed "$2.70 COMMITTED · 67298%▲"
 * beside the line "+$2.69 committed today". Both numbers were arithmetically
 * correct. The base was $0.004 — four tenths of a cent, an amount this very app
 * refuses to call capital when it decides whether anyone is backing a side. We
 * were dividing by a number we had already ruled was not money.
 *
 * So a move is ranked before it is rendered:
 *
 *   unknown   no baseline at all. We cannot claim a change of any kind. This is
 *             "no history at this boundary", never "no change".
 *   origin    there was nothing here and now there is something. The absolute
 *             amount is the entire truth: "First capital", "First believer".
 *             A percentage here would be a lie dressed as a rate.
 *   none      a real base, but too thin to divide by. The change is stated in
 *             its own unit and no ratio is shown.
 *   quiet     a real base, large enough to divide by, too small to trust with
 *             the reader's attention. Shown small; never the headline figure.
 *   headline  the base is an established quantity. The ratio is the story.
 *
 * `delta` is present for every rank except `unknown` — the absolute change is
 * always honest, and it is what the surface shows when the percentage is
 * withheld. The two are never withheld together.
 */
export type GainRank = "unknown" | "origin" | "none" | "quiet" | "headline";

export interface GainRule {
  /** At or below this the base is nothing; crossing it is an arrival, not growth. */
  originMaxBase: number;
  /** Below this a ratio measures the base's smallness, so none is shown. */
  pctValidMinBase: number;
  /** At or above this the ratio may be the lead figure. */
  pctHeadlineMinBase: number;
}

export interface Gain {
  rank: GainRank;
  /** current − base, in the metric's own unit. Null only when there is no base. */
  delta: number | null;
  /** The ratio, present only for `quiet` and `headline`. */
  pct: number | null;
}

const NO_BASE: Gain = { rank: "unknown", delta: null, pct: null };

/** Rank and measure one move. See GainRank for what each outcome means. */
export function gain(
  current: number | null | undefined,
  base: number | null | undefined,
  rule: GainRule,
): Gain {
  if (current == null || !Number.isFinite(current)) return NO_BASE;
  if (base == null || !Number.isFinite(base)) return NO_BASE;
  const delta = current - base;
  // Nothing became something. The arrival is the fact; there is no rate.
  if (base <= rule.originMaxBase && current > rule.originMaxBase) {
    return { rank: "origin", delta, pct: null };
  }
  if (base < rule.pctValidMinBase) return { rank: "none", delta, pct: null };
  return {
    rank: base >= rule.pctHeadlineMinBase ? "headline" : "quiet",
    delta,
    pct: (delta / base) * 100,
  };
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
  const g = gain(current, base, METRIC_DISPLAY.believers);
  const delta = current - base;

  if (g.rank === "origin") {
    return {
      direction: "up",
      pct: null,
      pctQuiet: false,
      absolute: current === 1 ? "First believer" : `+${current} believers ${since}`,
    };
  }

  const pct = g.pct == null ? null : formatPct(g.pct);
  const pctQuiet = g.rank === "quiet";

  if (delta === 0) {
    return { direction: "flat", pct, pctQuiet, absolute: `No change ${since}` };
  }
  const n = Math.abs(delta);
  return {
    direction: metricDirection(delta),
    pct,
    pctQuiet,
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
  const cfg = METRIC_DISPLAY.capitalUsd;
  const deltaUsd = usd(delta);
  const direction = metricDirection(deltaUsd, cfg.flatEps);

  const g = gain(usd(currentEth), usd(baseEth), cfg);
  if (g.rank === "origin") {
    return {
      direction: "up",
      pct: null,
      pctQuiet: false,
      absolute: `First capital · ${money(currentEth)}`,
    };
  }

  const pct = g.pct == null ? null : formatPct(g.pct);
  const pctQuiet = g.rank === "quiet";

  if (direction === "flat") {
    return { direction, pct, pctQuiet, absolute: `No change ${since}` };
  }
  return {
    direction,
    pct,
    pctQuiet,
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
