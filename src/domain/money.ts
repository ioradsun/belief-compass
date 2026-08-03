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

/** The ETH unit is rendered as a symbol, never the word — it keeps money on one
 *  line inside narrow rails. */
export const ETH_SYMBOL = "\u039E";

/**
 * ETH magnitude → string with adaptive precision, capped at 5 decimals so a
 * figure never grows wide enough to wrap. Trailing zeros are trimmed.
 */
function ethBody(abs: number): string {
  if (abs === 0) return "0";
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 5;
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
 * `$12.34`; ETH renders as `Ξ0.0842`. When the rate is unavailable the value
 * can't be honestly shown → "—".
 */
export function formatMoney(value: number, opts: FormatMoneyOpts): string {
  const { from, to, ethUsd, signed } = opts;
  const converted = convertMoney(value, from, to, ethUsd);
  if (converted == null) return "—";
  const abs = Math.abs(converted);
  const sign = converted < 0 ? "−" : signed ? "+" : "";
  return to === "USD" ? `${sign}$${usdBody(abs)}` : `${sign}${ETH_SYMBOL}${ethBody(abs)}`;
}

/** The live rate, shown beside the toggle: "1 ETH = $3,214". Null when unknown. */
export function formatRate(ethUsd: number): string | null {
  if (!(ethUsd > 0) || !Number.isFinite(ethUsd)) return null;
  return `1 ETH = $${usdBody(ethUsd)}`;
}

/**
 * The rate itself as a plain price with cents — "$3,421.18" — for the currency
 * toggle's live USD side. Null when the rate is unknown (the toggle then shows a
 * stale/unavailable state rather than a fabricated number).
 */
export function formatUsdPrice(ethUsd: number): string | null {
  if (!(ethUsd > 0) || !Number.isFinite(ethUsd)) return null;
  return `$${ethUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A rate older than this counts as stale — surfaced as a subtle marker so a
 * conversion is never silently made against a rate that has stopped updating. The
 * rate refreshes on the order of minutes; 30 minutes flags a genuinely stalled
 * feed without false-positiving on ordinary jitter.
 */
export const RATE_STALE_MS = 30 * 60_000;

/**
 * Is the rate stale? A missing timestamp is stale by definition (we can't prove
 * it's fresh). Pure — the caller passes `now` so it stays deterministic.
 */
export function isRateStale(updatedAtMs: number | null | undefined, nowMs: number): boolean {
  if (updatedAtMs == null || !Number.isFinite(updatedAtMs)) return true;
  return nowMs - updatedAtMs > RATE_STALE_MS;
}

/** The short unit tag for a header/label, e.g. "USD" or "ETH". */
export function unitLabel(unit: DisplayUnit): string {
  return unit;
}
