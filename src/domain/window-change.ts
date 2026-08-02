/**
 * Window change — the honest move of a metric over one timeframe, from an
 * AUTHORITATIVE current total and its window-open baseline (both server-sourced,
 * so the numbers hold even when the trade tape is truncated on a busy market).
 *
 * The rules the audit demands, in one place:
 *   • No baseline yet (null) → we cannot claim a change. delta and pct are null;
 *     the caller shows the current total alone. This is "no history at the
 *     boundary", not "no change".
 *   • A real zero baseline (the market opened inside the window) → an absolute
 *     delta is honest, but a % has no denominator, so pct is null (never +100%
 *     dressed as a rate).
 *   • Otherwise delta = current − base and pct = delta / base × 100.
 *
 * ZERO IO, pure, fully testable.
 */

export interface WindowChange {
  /** current − base, or null when there is no baseline to subtract. */
  delta: number | null;
  /** delta / base × 100, or null when there is no positive base to divide by. */
  pct: number | null;
}

export function windowChange(current: number, base: number | null | undefined): WindowChange {
  if (!Number.isFinite(current)) return { delta: null, pct: null };
  if (base == null || !Number.isFinite(base)) return { delta: null, pct: null };
  const delta = current - base;
  return { delta, pct: base > 0 ? (delta / base) * 100 : null };
}
