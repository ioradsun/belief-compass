/**
 * Predictive prefetch — make "Next" feel local.
 *
 * The feed already holds each market's read-model row, but the deck's heavier
 * per-market payloads (market-change: prices/flows/tape; evidence; creator) are
 * fetched when the deck mounts, so a fresh "Next" shows a spinner. We warm the
 * immediate neighbors' deck-core into the SAME cache the deck reads, on idle so
 * it never competes with the active navigation render.
 *
 * Bounded on purpose: next, next+1, previous — never the whole catalog. The
 * likely-next market gets the full trio; the others just the deck-core
 * (market-change), which is what visibly populates the deck body.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getMarketChange } from "@/lib/markets.functions";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { getConvictionMarket } from "@/lib/market-create.functions";

/** Immediate neighbors to warm, in likelihood order: next, next+1, previous.
 *  Deduped, current excluded, invalid indices dropped. Pure/testable. */
export function neighborIds(ids: number[], idx: number): number[] {
  if (idx < 0 || idx >= ids.length) return [];
  const current = ids[idx];
  const out: number[] = [];
  const seen = new Set<number>([current]);
  for (const id of [ids[idx + 1], ids[idx + 2], ids[idx - 1]]) {
    if (id == null || !Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function usePredictivePrefetch(ids: number[], activeIdx: number): void {
  const qc = useQueryClient();
  // A stable string key so the effect only re-runs when the neighbor SET changes,
  // not on every feed poll that returns the same neighbors.
  const key = neighborIds(ids, activeIdx).join(",");

  useEffect(() => {
    if (!key || typeof window === "undefined") return;
    const targets = key.split(",").map(Number);
    let cancelled = false;

    const warm = () => {
      if (cancelled) return;
      targets.forEach((id, i) => {
        // Deck-core for every neighbor; prefetchQuery no-ops when already fresh.
        void qc.prefetchQuery({
          queryKey: ["market-change", id],
          queryFn: () => getMarketChange({ data: { id } }),
          staleTime: 10_000,
        });
        // The full trio only for the likely-next market — keep neighbor warming
        // cheap (no whole-catalog preload).
        if (i === 0) {
          void qc.prefetchQuery({
            queryKey: ["evidence", id],
            queryFn: () => getMarketEvidence({ data: { marketId: id } }),
            staleTime: 30_000,
          });
          void qc.prefetchQuery({
            queryKey: ["conviction-market", id],
            queryFn: () => getConvictionMarket({ data: { onchainId: id } }),
            staleTime: 5 * 60_000,
          });
        }
      });
    };

    // requestIdleCallback isn't in every target lib; feature-detect via a cast.
    const ric = window as unknown as {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    const idle = typeof ric.requestIdleCallback === "function";
    const handle = idle ? ric.requestIdleCallback!(warm) : window.setTimeout(warm, 200);
    return () => {
      cancelled = true;
      if (idle && typeof ric.cancelIdleCallback === "function") ric.cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [qc, key]);
}
