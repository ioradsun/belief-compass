/**
 * conviction.company — price block builder (pure).
 *
 * Turns a market's daily price history into the ambient context block: implied
 * probability, 24h change, and a truthful-window sparkline series. Honesty rules
 * baked in: the window is labeled to whatever history actually exists, and a
 * series too short to be meaningful is left for the renderer to omit rather than
 * drawn as a confident flat line.
 *
 * ZERO IO. Pure and unit-tested.
 */
import type { PriceBlock } from "./conviction-feed";

export const SPARK_POINTS = 60; // one point per day over the target window
export const MIN_SPARK_POINTS = 6; // fewer than this → renderer omits the sparkline

/** One daily bucket from price_series_daily(). */
export interface DailyPoint {
  bucket: string; // YYYY-MM-DD
  pct: number; // implied YES %, 0..100
}

/** Truthful label for however many days of history we actually have. */
export function priceWindowLabel(days: number): string {
  if (days >= 55) return "2 months";
  if (days >= 40) return "6 weeks";
  if (days >= 12) return `${Math.round(days / 7)} weeks`;
  if (days >= 2) return `${Math.round(days)} days`;
  if (days >= 1) return "1 day";
  return "today";
}

/** Evenly sample down to at most `max` points, preserving first and last. */
export function downsampleSeries(vals: number[], max = SPARK_POINTS): number[] {
  if (vals.length <= max) return vals;
  const out: number[] = [];
  const step = (vals.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(vals[Math.round(i * step)]);
  return out;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

/**
 * Build the block from ascending daily buckets and the freshest implied % (from
 * market_state, more current than the last daily average). Returns null only
 * when there is nothing honest to show at all.
 */
export function buildPriceBlock(
  daily: DailyPoint[],
  impliedPctNow: number | null,
): PriceBlock | null {
  const pts = daily.filter((d) => Number.isFinite(d.pct));
  const impliedPct =
    impliedPctNow != null
      ? Math.round(impliedPctNow)
      : pts.length > 0
        ? Math.round(pts[pts.length - 1].pct)
        : null;

  if (impliedPct == null && pts.length === 0) return null;

  // 24h change ≈ last day vs the previous day (daily resolution).
  const chg24h =
    pts.length >= 2 ? Math.round(pts[pts.length - 1].pct - pts[pts.length - 2].pct) : null;

  const series = downsampleSeries(pts.map((p) => p.pct));
  const windowDays = pts.length > 1 ? daysBetween(pts[0].bucket, pts[pts.length - 1].bucket) : 0;

  return {
    impliedPct,
    chg24h,
    series,
    windowDays,
    windowLabel: priceWindowLabel(windowDays),
  };
}
