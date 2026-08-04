/**
 * TENURE — how long someone has believed something, and how much of that we
 * are actually entitled to claim.
 *
 * "Held 43 days" is one of the most valuable sentences this product can write.
 * It is also the easiest to get silently wrong, because the number is derived
 * from `wallet_beliefs.first_backed_at`, and that column can only ever be as
 * old as the index behind it.
 *
 * MEASURED, 2026-08-04. Trade events by day:
 *
 *     2026-07-23        0
 *     2026-07-24     4288   ← 76% of all trade history, on one day
 *     2026-07-25       92
 *     …              ~130/day
 *     older than 14d:   0
 *
 * There is no history before 2026-07-24. Everything that existed on chain
 * before the indexer's first block landed on that one timestamp, and it shows
 * up downstream exactly as you'd expect: of 782 markets with tenure data, 681
 * reported a p75 holder tenure of 10.9 days — the same value, to one decimal,
 * for 87% of the platform. That is not a distribution of human behaviour. It is
 * one write.
 *
 * So for anyone whose belief traces back to the epoch, `first_backed_at` is a
 * FLOOR, not a fact: they have held for at least that long, and possibly far
 * longer. The honest rendering is "43+ days".
 *
 * WHAT THIS DOES AND DOESN'T CENSOR:
 *
 *   · A precise duration claim ("Held 43 days") is censored to a floor, because
 *     stating a number we cannot support is the actual lie.
 *   · A THRESHOLD claim is not, and must not be. "Reached 30 days" is already a
 *     lower bound — if the true start is earlier, the crossing still happened,
 *     just sooner. Conviction cohorts are therefore safe as they are, and
 *     suppressing them would trade a true statement for silence.
 *
 * SELF-HEALING. `knownSinceDays` grows with the clock. Once the index is a year
 * old, a 43-day tenure is nowhere near the epoch and nothing is censored — this
 * module quietly stops applying without anyone editing a threshold. It only
 * ever needs deleting if the history before the epoch is genuinely backfilled.
 *
 * ZERO IO, pure, fully testable.
 */

/**
 * The first instant the trade index has real data for. Before this, the
 * platform knows nothing — not "nothing happened", which is the distinction the
 * whole module exists to preserve.
 */
export const INDEX_EPOCH_ISO = "2026-07-24T00:00:00.000Z";

export const TENURE = {
  epochMs: Date.parse(INDEX_EPOCH_ISO),
  /**
   * How close to the epoch still counts as "pinned to it". The backfill wrote a
   * range of timestamps across that first day rather than a single instant, and
   * a holder at 10.4 days is as unknowable as one at 10.9. Generous on purpose:
   * over-claiming precision is the failure that matters, and under-claiming by
   * a day costs a "+" on a sentence that is true either way.
   */
  graceDays: 1.5,
} as const;

const DAY = 86_400_000;

/**
 * The longest tenure the index can possibly evidence right now. Anything at or
 * above this is capped by when we started looking, not by when the person
 * started believing.
 */
export function knownSinceDays(nowMs: number = Date.now()): number {
  return Math.max(0, (nowMs - TENURE.epochMs) / DAY);
}

/**
 * Is this tenure a floor rather than a measurement? True when the belief traces
 * back to the epoch — i.e. we found it the moment we started looking, so its
 * real beginning is unknown.
 */
export function isFloorTenure(daysHeld: number, nowMs: number = Date.now()): boolean {
  if (!Number.isFinite(daysHeld) || daysHeld <= 0) return false;
  return daysHeld >= knownSinceDays(nowMs) - TENURE.graceDays;
}

/** The same question, from the timestamp itself — for callers that hold one. */
export function firstBackedIsFloor(firstBackedAtMs: number): boolean {
  if (!Number.isFinite(firstBackedAtMs)) return false;
  return firstBackedAtMs <= TENURE.epochMs + TENURE.graceDays * DAY;
}
