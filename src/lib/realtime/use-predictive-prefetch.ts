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
import { marketChangeQO, evidenceQO } from "@/lib/market-queries";
import { getConvictionMarket } from "@/lib/market-create.functions";
import { getMarketRow } from "@/lib/markets.functions";
import { getHouseRead, type HouseMode } from "@/lib/house.functions";
import { houseKey } from "@/lib/house-round";

/**
 * Decode the next market's picture WHILE THE CURRENT ONE IS STILL BEING READ.
 *
 * A warm cache paints the words instantly and then the image arrives a beat
 * later, which reads as a second, uglier load. The browser will hand back a
 * decoded frame for free if it was asked early enough, so once the neighbour's
 * metadata lands we ask for its media the same way the stage will.
 */
function warmImage(url: string | null | undefined): void {
  if (!url || typeof Image === "undefined") return;
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}


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

export function usePredictivePrefetch(
  ids: number[],
  activeIdx: number,
  viewer?: { wallet?: string | undefined; mode?: HouseMode },
): void {
  const qc = useQueryClient();
  // A stable string key so the effect only re-runs when the neighbor SET changes,
  // not on every feed poll that returns the same neighbors.
  const key = neighborIds(ids, activeIdx).join(",");
  const wallet = viewer?.wallet;
  const mode: HouseMode = viewer?.mode ?? "REAL";

  useEffect(() => {
    if (!key || typeof window === "undefined") return;
    const targets = key.split(",").map(Number);
    let cancelled = false;

    const warm = () => {
      if (cancelled) return;
      targets.forEach((id, i) => {
        // Deck-core for every neighbor; prefetchQuery no-ops when already fresh.
        void qc.prefetchQuery(marketChangeQO(id));
        /**
         * THE ROW ITSELF. The centre will not draw a market until it has the
         * title and side totals, and arriving from Next used to fetch that after
         * the switch — the one request standing between a warm cache and an
         * instant paint. Same key and budget the deck reads, so this is a
         * readiness probe rather than a second request.
         */
        void qc.prefetchQuery({
          queryKey: ["market-row", id],
          queryFn: () => getMarketRow({ data: { id } }),
          staleTime: 15_000,
        });
        // CREATOR + EVIDENCE FOR EVERY NEIGHBOR, not just the likely-next.
        // This lookup decides whether the market has an evidence page at all,
        // so when it lands after paint the stage grows a second page and the
        // whole market appears to slide sideways on arrival. It is one small,
        // five-minute-cached row per market: warming it for all three
        // neighbours means the shape of the next market is known before it is
        // shown, which is the difference between a switch and a lurch.
        void qc
          .fetchQuery({
            queryKey: ["conviction-market", id],
            queryFn: () => getConvictionMarket({ data: { onchainId: id } }),
            staleTime: 5 * 60_000,
          })
          // Only the likely-next market's picture is worth bytes up front.
          .then((res) => {
            if (i === 0 && !cancelled)
              warmImage((res as { market?: { mediaUrl?: string | null } } | null)?.market?.mediaUrl);
          })
          .catch(() => {});
        if (i === 0) {
          // Evidence (the believer roster behind the faces) is the heavy one —
          // still only for the market they are most likely to see next.
          void qc.prefetchQuery(evidenceQO(id));
          /**
           * THE INSIDER READ, warmed in the right ledger. It is the slowest row
           * on the deck and the one that reads as broken when it lags — the
           * reader sees "still learning you" for a beat on a market the House
           * already had an opinion about. Only ever for a connected viewer, and
           * keyed by mode so a Simulation round never warms the real one.
           */
          if (wallet)
            void qc.prefetchQuery({
              queryKey: houseKey(wallet, id, mode),
              queryFn: () => getHouseRead({ data: { wallet, marketId: id, mode } }),
              staleTime: 30_000,
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
  }, [qc, key, wallet, mode]);
}
