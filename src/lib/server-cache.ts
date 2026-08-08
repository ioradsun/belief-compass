/**
 * In-process stale-while-revalidate cache (server-only).
 *
 * The point: SSR can read a warm snapshot in sub-millisecond time instead of
 * paying a live multi-query Supabase round trip on every request. A busy app
 * (the poller runs constantly) keeps the instance warm, so the FIRST paint of a
 * first-time visitor is real content, not a skeleton.
 *
 * Semantics:
 *   • fresh (within ttl)        → return cached value, no work
 *   • stale (past ttl, present) → return the stale value NOW, refresh in the
 *                                 background (one refresh at a time per key)
 *   • cold (absent)             → ONE computation, shared by every concurrent
 *                                 caller, then cached
 *
 * A background refresh failure is swallowed and the stale value is kept, so a
 * transient DB blip never turns into a user-facing error.
 */
type Entry<T> = { value: T; expires: number; refreshing: boolean; refreshAt?: number };

/**
 * A SHARED PROMISE MUST NEVER BE ABLE TO HANG FOREVER.
 *
 * On the serverless runtime the app is deployed to, pending I/O belonging to a
 * request that has already responded is cancelled — and a cancelled await does
 * not always reject: it can simply never resume. The single-flight map below is
 * per-isolate and long-lived, so ONE such build wedges the key permanently and
 * every later request joins a promise that will never settle. That is exactly
 * the "published site shows the skeleton forever while preview is fine" shape:
 * the request is made, the connection stays open, nothing ever comes back.
 *
 * So every shared computation gets a watchdog. If it has not settled in time we
 * evict the slot and reject the waiters, which turns a permanent wedge into one
 * ordinary failed request that the next caller genuinely retries.
 */
const MAX_INFLIGHT_MS = 10_000;
/** A background refresh that never settles must not block later refreshes. */
const MAX_REFRESH_MS = 15_000;

const store = new Map<string, Entry<unknown>>();

/**
 * COLD COMPUTES CURRENTLY RUNNING, so concurrent callers share one.
 *
 * THE DEFECT THIS CLOSES, and it is why a first load on mobile was slow and a
 * refresh was fast. The cold branch used to say "compute once, then cache" and
 * did not: the entry is written only AFTER `fn()` resolves, so every caller that
 * arrives while the first is still working finds the key absent and starts its
 * own full build.
 *
 * On a cold instance that is not a theoretical race — it is the normal sequence:
 *
 *   1. the SSR loader asks for the feed → cold, starts build A
 *   2. ~200ms later the loader's race times out, the shell ships, the client
 *      hydrates and asks for the feed   → still cold, starts build B
 *   3. 4s later the client's own timeout fires its anonymous fallback
 *                                       → still cold, starts build C
 *
 * Three concurrent runs of the same seven pool queries, the platform-wide
 * participation aggregate and the window-change loader — each making the others
 * slower, none cancelled. Then the reader reloads, the cache is finally warm,
 * and the page appears at once. "Slow the first time, fine on refresh" is
 * precisely the shape this produces.
 *
 * The first caller now registers its promise and the rest await it, so a cold
 * instance does the work once. A rejection reaches every waiter and clears the
 * slot, so a failure is never cached and the next request genuinely retries.
 */
const inflight = new Map<string, Promise<unknown>>();

export interface SwrOptions {
  ttlMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export async function swrCache<T>(key: string, opts: SwrOptions, fn: () => Promise<T>): Promise<T> {
  const now = opts.now ?? Date.now;
  const hit = store.get(key) as Entry<T> | undefined;
  const t = now();

  if (hit && hit.expires > t) return hit.value; // fresh

  if (hit) {
    // Stale: serve immediately, refresh once in the background. A refresh that
    // was cancelled mid-flight (and so never settles) is retried once its own
    // watchdog window passes, instead of latching `refreshing` forever.
    const refreshStale = hit.refreshing && (hit.refreshAt ?? 0) + MAX_REFRESH_MS < t;
    if (!hit.refreshing || refreshStale) {
      hit.refreshing = true;
      hit.refreshAt = t;
      void fn()
        .then((value) => store.set(key, { value, expires: now() + opts.ttlMs, refreshing: false }))
        .catch(() => {
          hit.refreshing = false; // keep the stale value; try again next miss
        });
    }
    return hit.value;
  }

  // Cold: ONE computation for every caller waiting on this key.
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = Promise.race<T>([
    fn().then((value) => {
      store.set(key, { value, expires: now() + opts.ttlMs, refreshing: false });
      return value;
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Evict eagerly: the next caller must start a fresh build rather than
        // await a computation that may never come back.
        if (inflight.get(key) === started) inflight.delete(key);
        reject(new Error(`swrCache: "${key}" did not settle in ${MAX_INFLIGHT_MS}ms`));
      }, MAX_INFLIGHT_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
    // Cleared whether it resolved or threw — a failed build must not become a
    // promise every future caller keeps awaiting.
    if (inflight.get(key) === started) inflight.delete(key);
  });
  inflight.set(key, started);
  return started;
}

/**
 * A NON-BLOCKING READ. Returns the cached value if this isolate already has one
 * — fresh OR stale — and `undefined` otherwise. It never computes, never awaits
 * and never joins an in-flight build.
 *
 * This exists for the SSR path. The HTML shell must not be hostage to a cold
 * build: on the serverless runtime a cold isolate has nothing cached, the build
 * is a multi-query round trip, and awaiting it turned TTFB into the whole page
 * budget (measured: 10s in production, exactly the in-flight watchdog). A peek
 * lets a warm isolate serve real content instantly and a cold one ship the
 * shell immediately and let the browser fetch the feed in the background.
 */
export function peekSwr<T>(key: string): T | undefined {
  return (store.get(key) as Entry<T> | undefined)?.value;
}

/** Test-only: drop all cached entries and any computation in flight. */
export function _clearSwrCache(): void {
  store.clear();
  inflight.clear();
}

