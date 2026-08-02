/**
 * MONEY — one display unit, one conversion path (pure, no IO).
 *
 * The app stores value in two native units: USD (POV's marked position value,
 * capital/volume already priced) and ETH (the bonding curve's native cost basis
 * and committed capital). Historically those got mixed at the point of display.
 * This module is the SINGLE place a number crosses between units, always through
 * ONE current ETH/USD rate — so whatever the viewer chooses to see, both sides of
 * a subtraction (worth − cost) share one rate and one moment.
 *
 * The viewer picks the unit in their profile; every money surface formats through
 * `formatMoney`, passing the value's TRUE native unit as `from`. A value never
 * lies about where it started.
 *
 * ZERO IO, deterministic, fully testable.
 */

export type DisplayUnit = "USD" | "ETH";

/**
 * Convert a plain amount between USD and ETH at the current rate. Returns null
 * when the conversion is impossible (no positive rate) or the input is not a
 * finite number — callers render "—" rather than a fabricated figure.
 */
export function convertMoney(
  value: number,
  from: DisplayUnit,
  to: DisplayUnit,
  ethUsd: number,
): number | null {
  if (!Number.isFinite(value)) return null;
  if (from === to) return value;
  if (!(ethUsd > 0) || !Number.isFinite(ethUsd)) return null;
  return from === "USD" ? value / ethUsd : value * ethUsd;
}

/** USD magnitude → string: grouped whole dollars at $1k+, cents below. */
function usdBody(abs: number): string {
  return abs >= 1000
    ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * ETH magnitude → string with adaptive precision. ETH amounts span many orders
 * of magnitude (a $12 dust trade is ~0.004 ETH), so small amounts earn more
 * decimals while large ones stay readable. Trailing zeros are trimmed.
 */
function ethBody(abs: number): string {
  if (abs === 0) return "0";
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 6;
  const s = abs.toFixed(decimals);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

export interface FormatMoneyOpts {
  /** The value's true native unit. */
  from: DisplayUnit;
  /** The unit the viewer wants to see. */
  to: DisplayUnit;
  ethUsd: number;
  /** Prefix a "+"/"−" sign (for gains/deltas). Negative always shows "−". */
  signed?: boolean;
}

/**
 * Format a money amount in the viewer's chosen unit. USD renders as `$1,234` /
 * `$12.34`; ETH renders as `0.0842 ETH`. When the rate is unavailable the value
 * can't be honestly shown → "—".
 */
export function formatMoney(value: number, opts: FormatMoneyOpts): string {
  const { from, to, ethUsd, signed } = opts;
  const converted = convertMoney(value, from, to, ethUsd);
  if (converted == null) return "—";
  const abs = Math.abs(converted);
  const sign = converted < 0 ? "−" : signed ? "+" : "";
  return to === "USD" ? `${sign}$${usdBody(abs)}` : `${sign}${ethBody(abs)} ETH`;
}

/** The live rate, shown beside the toggle: "1 ETH = $3,214". Null when unknown. */
export function formatRate(ethUsd: number): string | null {
  if (!(ethUsd > 0) || !Number.isFinite(ethUsd)) return null;
  return `1 ETH = $${usdBody(ethUsd)}`;
}

/** The short unit tag for a header/label, e.g. "USD" or "ETH". */
export function unitLabel(unit: DisplayUnit): string {
  return unit;
}
