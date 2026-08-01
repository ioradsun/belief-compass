/**
 * The one realtime coordinator.
 *
 * ONE websocket for the whole app. It subscribes once to the `market_state`
 * stream Postgres already publishes (`ALTER PUBLICATION supabase_realtime ADD
 * TABLE public.market_state`), batches inbound rows into a single per-frame
 * reducer pass, and patches the shared React Query cache. Components never open a
 * channel — they read the cache the reducer maintains.
 *
 * Cost model: loading happens once (SSR snapshot + persisted cache); moving
 * happens forever over this one socket. The polls that used to *discover* market
 * movement are retired in favor of this stream, with only a slow reconcile poll
 * left as a safety net.
 *
 * Bundle: supabase-js (auth+realtime+storage+postgrest) is dynamically imported
 * here, so it lands in a post-first-paint async chunk instead of the critical
 * bundle — the socket opens after the snapshot is already on screen.
 */
import type { QueryClient } from "@tanstack/react-query";
import {
  applyMarketStateBatch,
  affectedPulseKeys,
  affectedPositionsTapeKeys,
  type MarketStateRow,
} from "./reduce";

/** How long after a socket recovery we let a single feed reconcile fire. */
const RECONCILE_DEBOUNCE_MS = 400;

/**
 * Min gap between activity refetches. A burst of trades coalesces into at most
 * one refetch of the narrated slices per window — instant enough to feel live,
 * bounded enough that 40 trades in 100ms is one refresh, not forty.
 */
const ACTIVITY_THROTTLE_MS = 1_500;

/**
 * Start the app-level realtime replica. Client-only; a no-op on the server and
 * during SSR. Returns a cleanup that tears the channel down.
 */
export function startRealtime(qc: QueryClient): () => void {
  if (typeof window === "undefined") return () => {};

  let disposed = false;
  let cleanup: (() => void) | null = null;

  // Per-market read_model_version high-water mark → deterministic ordering, so a
  // late or duplicated row is a no-op (matches the server's version guard).
  const lastVersion = new Map<number, number>();

  // One coalesced flush per animation frame: a burst of 40 rows in 100ms becomes
  // one reducer pass and one render, never 40.
  let queue: MarketStateRow[] = [];
  let frame: number | null = null;
  const flush = () => {
    frame = null;
    if (disposed || queue.length === 0) return;
    const batch = queue;
    queue = [];
    try {
      applyMarketStateBatch(qc, batch, lastVersion);
    } catch {
      // A malformed row must never wedge the socket; drop the batch and move on.
    }
  };
  const schedule = () => {
    if (frame != null) return;
    frame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(flush)
        : (setTimeout(flush, 16) as unknown as number);
  };
  const cancelFrame = () => {
    if (frame == null) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    else clearTimeout(frame as unknown as ReturnType<typeof setTimeout>);
    frame = null;
  };

  // Activity signal: trade events say WHICH market changed; we refetch only that
  // market's narrated slices (server owns the copy), coalesced + throttled so a
  // burst is one refresh. Quiet markets cost nothing — no timer, no fetch.
  const affected = new Set<number>();
  let activityTimer: ReturnType<typeof setTimeout> | null = null;
  let lastActivityAt = 0;
  const drainActivity = () => {
    activityTimer = null;
    lastActivityAt = Date.now();
    if (disposed || affected.size === 0) return;
    const ids = new Set(affected);
    affected.clear();
    // Per-card pulses + the position network tape: only caches that actually
    // hold a traded market.
    for (const key of affectedPulseKeys(qc, ids)) {
      void qc.invalidateQueries({ queryKey: key, exact: true });
    }
    for (const key of affectedPositionsTapeKeys(qc, ids)) {
      void qc.invalidateQueries({ queryKey: key, exact: true });
    }
    // The live tape is chronological across all markets, so any trade can change
    // it; refetch only the mounted (active) tapes, never the whole family.
    void qc.invalidateQueries({ queryKey: ["live-tape"], refetchType: "active" });
  };
  const noteActivity = (marketId: number) => {
    if (Number.isFinite(marketId)) affected.add(marketId);
    if (activityTimer != null) return;
    const wait = Math.max(0, ACTIVITY_THROTTLE_MS - (Date.now() - lastActivityAt));
    activityTimer = setTimeout(drainActivity, wait);
  };

  // A dropped-then-recovered socket can have missed rows; a single, debounced,
  // low-cost reconcile re-syncs the visible feed. We reconcile, we don't reload
  // everything — the reducer keeps the rest converged.
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  const reconcileSoon = () => {
    if (reconcileTimer != null) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      if (disposed) return;
      // A gap may have dropped both market facts and trade activity — re-sync the
      // visible feed and the mounted activity slices once.
      void qc.invalidateQueries({ queryKey: ["opp-feed"] });
      void qc.invalidateQueries({ queryKey: ["live-tape"], refetchType: "active" });
      void qc.invalidateQueries({ queryKey: ["market-pulses"], refetchType: "active" });
    }, RECONCILE_DEBOUNCE_MS);
  };

  // Dynamic import keeps supabase-js off the first-paint critical path.
  void import("@/integrations/supabase/client")
    .then(({ supabase }) => {
      if (disposed) return;
      let sawError = false;

      const channel = supabase
        .channel("belief-realtime")
        // Truth of each market's current facts — patched in place by the reducer.
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "market_state" },
          (payload: { new?: Record<string, unknown> | null }) => {
            const row = payload.new;
            if (row && row.onchain_id != null) {
              queue.push(row as MarketStateRow);
              schedule();
            }
          },
        )
        // Trade activity — a signal to refetch the narrated slice (server-authored).
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "events", filter: "kind=eq.trade" },
          (payload: { new?: Record<string, unknown> | null }) => {
            const mid = Number(payload.new?.market_id);
            if (Number.isFinite(mid)) noteActivity(mid);
          },
        )
        .subscribe((status: string) => {
          // Re-subscribe after a transient error means we may have a gap → reconcile.
          if (status === "SUBSCRIBED" && sawError) {
            sawError = false;
            reconcileSoon();
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") sawError = true;
        });

      cleanup = () => {
        cancelFrame();
        if (reconcileTimer != null) clearTimeout(reconcileTimer);
        if (activityTimer != null) clearTimeout(activityTimer);
        void supabase.removeChannel(channel);
      };
    })
    .catch(() => {
      // Realtime unavailable (offline, blocked socket): the slow reconcile polls
      // that remain still keep the app correct, just not instant.
    });

  return () => {
    disposed = true;
    cancelFrame();
    if (reconcileTimer != null) clearTimeout(reconcileTimer);
    if (activityTimer != null) clearTimeout(activityTimer);
    cleanup?.();
  };
}
