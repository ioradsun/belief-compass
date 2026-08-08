/**
 * Focus revalidation policy — one gate for "the tab came back".
 *
 * On mobile, flipping between the chat and the preview hides and re-shows the
 * tab constantly. React Query's `refetchOnWindowFocus` plus the realtime
 * coordinator's reconcile both fire on EVERY return, so a few quick flips queue
 * dozens of server-function round-trips on a phone radio. The app then feels
 * like it is "loading forever" — it is, but only because it was asked to reload
 * everything several times in a row.
 *
 * The gate: a return only counts as a revalidation moment if the tab was
 * genuinely away for a while, and never more than once per cooldown. Anything
 * shorter is a glance, not an absence — the cache is still current, the socket
 * was never suspended, and the correct amount of work is zero.
 *
 * This is a throttle on *redundant* revalidation only. Real freshness still
 * comes from the realtime socket, per-query staleTime, refetchOnReconnect, and
 * a query's own fetch when it mounts.
 */

/** Below this away-time, a return is a glance — nothing can have gone stale. */
const MIN_AWAY_MS = 10_000;

/** Never revalidate-on-return more than once inside this window. */
const COOLDOWN_MS = 30_000;

let hiddenAt: number | null = null;
let lastRevalidateAt = 0;

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
  });
}

/** How long the tab was most recently hidden, in ms (0 if it never was). */
export function awayMs(): number {
  return hiddenAt == null ? 0 : Date.now() - hiddenAt;
}

/**
 * True when a tab-return is worth re-reading the world for. Consumes the
 * cooldown, so callers should only ask when they intend to act on the answer.
 */
export function shouldRevalidateOnReturn(): boolean {
  const now = Date.now();
  if (awayMs() < MIN_AWAY_MS) return false;
  if (now - lastRevalidateAt < COOLDOWN_MS) return false;
  lastRevalidateAt = now;
  hiddenAt = null;
  return true;
}
