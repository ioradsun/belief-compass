/**
 * POLL WHILE IT IS BEING COMPUTED. STOP WHEN IT IS.
 *
 * The viewer's DNA — their network, their overview — is not read live. It is
 * computed by a background worker into `viewer_dna_cache`, and both server
 * functions report which state that computation is in:
 *
 *   "empty"     no cache. The read ALSO fired `request_viewer_match_refresh`,
 *               so a computation is now on its way. This is what a brand-new
 *               reader sees for the first minute of their first session.
 *   "updating"  a cache exists but the worker has been asked to redo it.
 *   "fresh"     done. Nothing will change it until positions change.
 *
 * TWO OPPOSITE MISTAKES WERE LIVE AT ONCE, and they share one cause: a timer
 * cannot tell "still computing" from "nothing is happening".
 *
 *   `["dna-overview"]` polled every 60s FOREVER — long after the answer went
 *   fresh, when nothing could change it, re-reading a settled cache for the
 *   length of the session.
 *
 *   `["network"]` polled NEVER — correct for a settled cache, and wrong for the
 *   one moment it matters. A first-time reader who triggered the computation on
 *   load then waited for the worker with no one asking again, so their network
 *   stayed empty until they happened to switch tabs and come back.
 *   `network-freshness.test.ts` recorded that gap as acceptable on the grounds
 *   that "DNA relationships move over hours" — true of a settled cache, not of
 *   one that does not exist yet.
 *
 * The state is reported, so the rule can just read it. Zero IO, pure.
 */

export type DnaFreshnessStatus = "fresh" | "updating" | "stale" | "empty";
export interface DnaFreshness {
  status: DnaFreshnessStatus;
  calculatedAt?: string;
}

/**
 * How often to ask while the worker is working.
 *
 * Short, because this is a first-run wait a person is actually sitting through
 * — and bounded by `MAX_ATTEMPTS`, so it cannot become the forever-poll it
 * replaces.
 */
export const DNA_COMPUTE_POLL_MS = 5_000;

/**
 * How many times before we stop asking. Twenty at five seconds is a hundred
 * seconds: past that the worker is not slow, it is not coming, and continuing
 * to ask would be the same mistake in a smaller font. The reader is not
 * stranded — focus and reconnect refetching still apply, so returning to the
 * tab picks the answer up.
 */
export const DNA_COMPUTE_MAX_ATTEMPTS = 20;

/** Is a computation actually in flight — or is this just a settled answer? */
export function isComputing(freshness: DnaFreshness | null | undefined): boolean {
  const s = freshness?.status;
  // No payload yet means the first request has not landed; there is nothing to
  // poll for, because the request itself is still the thing in flight.
  if (!s) return false;
  // "stale" is a cache that exists and is old — a worker-schedule matter, not a
  // computation to wait on. It renders, and it is not worth a timer.
  return s === "empty" || s === "updating";
}

/**
 * The `refetchInterval` for a DNA-backed query: a delay while the worker is
 * working, `false` the moment it is not.
 *
 * `attempts` is React Query's `dataUpdateCount` — how many times this query has
 * produced data — which makes the ceiling count real answers rather than
 * elapsed wall time, so a slow network cannot burn the budget without ever
 * having asked.
 */
export function dnaPollInterval(
  freshness: DnaFreshness | null | undefined,
  attempts: number,
): number | false {
  if (!isComputing(freshness)) return false;
  if (!Number.isFinite(attempts) || attempts >= DNA_COMPUTE_MAX_ATTEMPTS) return false;
  return DNA_COMPUTE_POLL_MS;
}
