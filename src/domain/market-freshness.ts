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

/**
 * Human age copy — how old a market reads to a person, not a timestamp.
 * "Just created" / "3 hours old" / "1 day old" / "Less than a week old".
 * Coarser as it ages, because precision stops mattering.
 */
export function marketAgeCopy(ageMs: number): string {
  const ms = Math.max(0, ageMs);
  if (ms < 15 * MIN) return "Just created";
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} minutes old`;
  if (ms < DAY) {
    const h = Math.max(1, Math.floor(ms / HOUR));
    return `${h} ${h === 1 ? "hour" : "hours"} old`;
  }
  const d = Math.floor(ms / DAY);
  if (d === 1) return "1 day old";
  if (d < 7) return `${d} days old`;
  if (d < 14) return "About a week old";
  if (d < 30) return `${Math.floor(d / 7)} weeks old`;
  if (d < 60) return "About a month old";
  if (d < 365) return `${Math.round(d / 30)} months old`;
  return "Over a year old";
}

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
