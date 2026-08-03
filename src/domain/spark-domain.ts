/**
 * Sparkline domain — make a spark tell the truth about MAGNITUDE, not just shape.
 *
 * A sparkline that auto-scales to its own min/max has no sense of materiality: a
 * 0.05% price wiggle and a 40% crash both fill the box, so the chart screams
 * "big move" while the headline reads "0% · flat". That contradiction is the bug
 * this fixes.
 *
 * The rule: a move the rest of the UI calls immaterial must RENDER as nearly
 * flat. So the vertical domain is never smaller than a per-metric "material span"
 * (a floor tied to that metric's own flat threshold), and it always contains the
 * window's baseline so up-vs-down-from-the-start is never hidden. A genuinely
 * large move still fills the box; a tiny one occupies a tiny slice of it.
 *
 * ZERO IO, pure, fully testable.
 */

export interface SparkDomain {
  min: number;
  max: number;
}

export interface SparkDomainOpts {
  /** Minimum span as a fraction of |baseline| — the materiality floor. */
  minRelSpan?: number;
  /** Absolute minimum span, in the metric's own units (for small/zero baselines). */
  minAbsSpan?: number;
}

/**
 * Per-metric floors. Each is set so a move at (or below) the metric's "flat"
 * threshold occupies only a small slice of the chart, while a clearly material
 * move fills it. These mirror the copy's own materiality thresholds so the chart,
 * the % and the sentence always agree.
 */
export const SPARK_DOMAIN: Record<"price" | "capital" | "believers", SparkDomainOpts> = {
  // Price re-rates on every trade; <1% is "flat" (side-lens PRICE_FLAT_PCT). A ±4%
  // floor renders a 1% move at ~1/8 height and a sub-0.1% wiggle as flat.
  price: { minRelSpan: 0.08 },
  // Capital: a couple of percent is small. ±7.5% floor keeps a 2% move gentle.
  capital: { minRelSpan: 0.15 },
  // Believers are small integer counts, so anchor mostly on an absolute band: a
  // single joiner on a base of 15 is a modest step, not a cliff — but a real
  // doubling still fills the box.
  believers: { minRelSpan: 0.4, minAbsSpan: 3 },
};

/**
 * The [min, max] a sparkline should plot against. `values` are the plotted
 * points; `baseline` is the window-open value (the anchor for both inclusion and
 * the relative floor). Grows symmetrically around the data envelope so the line
 * keeps its position while the box reaches the material span.
 */
export function sparkDomain(
  values: number[],
  baseline: number,
  opts: SparkDomainOpts = {},
): SparkDomain {
  const finite = values.filter((v) => Number.isFinite(v));
  const base = Number.isFinite(baseline) ? baseline : (finite[0] ?? 0);
  // Always include the baseline so "did it move up or down from the start" is honest.
  let lo = Math.min(base, ...finite);
  let hi = Math.max(base, ...finite);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = base;
    hi = base;
  }

  const span = hi - lo;
  const minSpan = Math.max(opts.minAbsSpan ?? 0, Math.abs(base) * (opts.minRelSpan ?? 0));
  if (span < minSpan) {
    const grow = (minSpan - span) / 2;
    lo -= grow;
    hi += grow;
  }
  return { min: lo, max: hi };
}
