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
 *   • cold (absent)             → await the computation once, then cache it
 *
 * A background refresh failure is swallowed and the stale value is kept, so a
 * transient DB blip never turns into a user-facing error.
 */
type Entry<T> = { value: T; expires: number; refreshing: boolean };

const store = new Map<string, Entry<unknown>>();

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
    // Stale: serve immediately, refresh once in the background.
    if (!hit.refreshing) {
      hit.refreshing = true;
      void fn()
        .then((value) => store.set(key, { value, expires: now() + opts.ttlMs, refreshing: false }))
        .catch(() => {
          hit.refreshing = false; // keep the stale value; try again next miss
        });
    }
    return hit.value;
  }

  // Cold: compute once, then cache.
  const value = await fn();
  store.set(key, { value, expires: now() + opts.ttlMs, refreshing: false });
  return value;
}

/** Test-only: drop all cached entries. */
export function _clearSwrCache(): void {
  store.clear();
}
