/**
 * WARM ON INTENT — make "open this market" feel like it was already open.
 *
 * `usePredictivePrefetch` warms the markets either side of the one being read,
 * because the running order says where the reader is going next. Nothing says
 * that about a Now row: a tape event can point at any market in the system, so
 * a tap from the tape always started from a cold cache and the centre had to
 * hold something — the market they were NOT looking at — while three requests
 * went out.
 *
 * Intent is the fix. A finger that lands on a row (or a cursor that rests on
 * one) is a decision a beat before the tap commits, and that beat is enough to
 * have the row and the deck core in hand by the time the market is on screen.
 *
 * Everything here is idempotent and cheap: `prefetchQuery` no-ops when the data
 * is already fresh, and each id is warmed at most once per session.
 */
import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { marketChangeQO } from "@/lib/market-queries";
import { getConvictionMarket } from "@/lib/market-create.functions";
import { getMarketRow } from "@/lib/markets.functions";

/**
 * Returns `warm(marketId)` — call it from `onPointerDown` / `onPointerEnter`.
 *
 * The trio is exactly what the centre waits for before it will draw a market:
 * the row (title, side totals), the deck core (prices, flows, tape) and the
 * creator lookup (byline + whether there is an evidence page at all).
 */
export function useWarmMarket(): (marketId: number) => void {
  const qc = useQueryClient();
  const done = useRef<Set<number>>(new Set());

  return useCallback(
    (marketId: number) => {
      if (!Number.isFinite(marketId) || marketId <= 0) return;
      if (done.current.has(marketId)) return;
      done.current.add(marketId);
      void qc.prefetchQuery(marketChangeQO(marketId));
      void qc.prefetchQuery({
        // Same key and staleTime the centre uses, so this is a readiness probe
        // rather than a second request.
        queryKey: ["market-row", marketId],
        queryFn: () => getMarketRow({ data: { id: marketId } }),
        staleTime: 15_000,
      });
      void qc.prefetchQuery({
        queryKey: ["conviction-market", marketId],
        queryFn: () => getConvictionMarket({ data: { onchainId: marketId } }),
        staleTime: 5 * 60_000,
      });
    },
    [qc],
  );
}
