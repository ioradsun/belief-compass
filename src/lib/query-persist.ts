/**
 * Instant-on-return cache — persist the React Query cache across reloads.
 *
 * The problem: on a return visit every client-side panel (live tape, positions,
 * pulses, evidence, network, challenges …) starts from an EMPTY QueryClient and
 * shows a skeleton until its first network round-trip. The feel is "loading",
 * even though we already showed this person almost exactly this data minutes ago.
 *
 * The fix (stale-while-revalidate, persisted): mirror the cache to localStorage,
 * and on the next boot re-hydrate it. The last-seen data paints immediately, then
 * React Query's normal staleTime / refetchInterval revalidates in the background
 * so fresh numbers stream in. Nothing blocks on the network to show SOMETHING.
 *
 * Safety:
 *  - Client only (no-ops on the server and in dev, where HMR + fresh fetches win).
 *  - Busted by BUILD_ID: a new deploy can change a query's shape, so a stale cache
 *    from an old build is discarded wholesale rather than rendered.
 *  - Aged out after MAX_AGE_MS so we never paint truly ancient state.
 *  - Only a whitelist of query families is persisted, success-only, under a byte
 *    cap — a quota/parse failure clears the cache instead of wedging the app.
 *  - Financial staleness is display-only: the trade flow always re-quotes on-chain
 *    (simulate) before executing, so a briefly-stale price can never drive a bet.
 */
import { dehydrate, hydrate, type QueryClient, type DehydratedState } from "@tanstack/react-query";
import { BUILD_ID } from "@/lib/build-id";

const KEY = "conviction:qcache:v1";
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h — older than this, just fetch fresh
const WRITE_THROTTLE_MS = 3_000; // coalesce the 8s poll churn into one write
const MAX_BYTES = 3_000_000; // localStorage safety cap (~3MB); skip oversized writes

/**
 * Query families worth persisting for an instant return paint. Keyed by the first
 * queryKey segment. Everything else (one-offs, private computes) is left to fetch.
 */
const PERSIST_PREFIXES = new Set([
  "feed",
  // The authoritative sequenced feed — the single most valuable thing to have
  // painted before the first byte comes back on a return visit.
  "opp-feed",
  "market-row",
  // The Insider cache root — the global feed and the per-market activity.
  "insider",
  "my-convictions",
  "positions-tape",
  "market-change",
  "evidence",
  "network",
  // Challenge is deliberately NOT persisted: an open call is
  // about who has acted since you last looked, and a restored snapshot would
  // show yesterday's obligations as though they were still waiting.
  "conviction-market",
  // Who the viewer is, so a return visit paints signed-in immediately.
  "wallet-link",
]);

const persistable = (queryKey: readonly unknown[]): boolean =>
  typeof queryKey[0] === "string" && PERSIST_PREFIXES.has(queryKey[0]);

/** Persistence is off in dev (constant buster + HMR would surface stale shapes). */
const enabled = () => typeof window !== "undefined" && BUILD_ID !== "dev";

interface Envelope {
  buster: string;
  savedAt: number;
  state: DehydratedState;
}

/**
 * Re-hydrate last session's cache. Safe no-op on miss, a different build, expiry,
 * or unavailable storage. Call once as early as possible on the client.
 */
export function restoreQueryCache(qc: QueryClient): void {
  if (!enabled()) return;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    const env = JSON.parse(raw) as Envelope;
    if (env.buster !== BUILD_ID || Date.now() - env.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(KEY);
      return;
    }
    hydrate(qc, env.state);
  } catch {
    // Corrupt or unavailable storage — the app simply fetches fresh.
  }
}

/**
 * Mirror the cache to storage: throttled on change, and flushed when the tab is
 * hidden/closed (so the freshest state is what we restore next time). Returns a
 * cleanup that stops persisting and flushes nothing (the last throttled write or
 * the pagehide flush already captured state).
 */
export function startQueryPersist(qc: QueryClient): () => void {
  if (!enabled()) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = () => {
    timer = null;
    try {
      const state = dehydrate(qc, {
        shouldDehydrateQuery: (q) => q.state.status === "success" && persistable(q.queryKey),
      });
      const json = JSON.stringify({ buster: BUILD_ID, savedAt: Date.now(), state } as Envelope);
      if (json.length > MAX_BYTES) return; // too large this tick — try again next change
      window.localStorage.setItem(KEY, json);
    } catch {
      // Quota exceeded / serialization failure — drop the cache so we never wedge.
      try {
        window.localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    }
  };

  const schedule = () => {
    if (timer == null) timer = setTimeout(write, WRITE_THROTTLE_MS);
  };
  const flushIfHidden = () => {
    if (document.visibilityState === "hidden") write();
  };

  const unsub = qc.getQueryCache().subscribe(schedule);
  window.addEventListener("pagehide", write);
  document.addEventListener("visibilitychange", flushIfHidden);

  return () => {
    unsub();
    window.removeEventListener("pagehide", write);
    document.removeEventListener("visibilitychange", flushIfHidden);
    if (timer != null) clearTimeout(timer);
  };
}
