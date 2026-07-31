/**
 * Market freshness — deterministic age → product language. Pure, no IO.
 *
 * A market's age is meaningful copy, not a timestamp. A minute-old market reads
 * "FRESHLY CREATED", not "Created 1m ago". The token sits in the identity line
 * (CATEGORY · FRESH); `fresh` also drives the byline phrasing ("Just opened this
 * market" vs "Created this market · 18m ago").
 */
export interface Freshness {
  /** Uppercase token for the identity line, e.g. FRESHLY CREATED / FRESH / 8D OLD. */
  token: string;
  /** True while the market still reads as newly opened (under ~24h). */
  fresh: boolean;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function marketFreshness(ageMs: number): Freshness {
  const ms = Math.max(0, ageMs);
  if (ms < 15 * MIN) return { token: "FRESHLY CREATED", fresh: true };
  if (ms < 2 * HOUR) return { token: "FRESH", fresh: true };
  if (ms < DAY) return { token: "NEW TODAY", fresh: true };
  const d = ms / DAY;
  if (d < 30) return { token: `${Math.max(1, Math.round(d))}D OLD`, fresh: false };
  if (d < 365) return { token: `${Math.round(d / 30)}MO OLD`, fresh: false };
  return { token: `${Math.round(d / 365)}Y OLD`, fresh: false };
}
