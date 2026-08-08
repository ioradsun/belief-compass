/**
 * Relative time — one compact "how long ago" string for the whole app.
 *
 * Truncating, not rounding: 90 seconds reads "1m", never "2m", so a duration is
 * never reported as longer than it was.
 */

/** Compact elapsed time since an ISO timestamp: 45s / 12m / 3h / 6d. */
export function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
