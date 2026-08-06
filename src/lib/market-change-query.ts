/**
 * THE ONE PLACE A SURFACE ASKS "WHAT CHANGED?".
 *
 * Every panel that shows a move — the centre's Total Market, the YES and NO Case
 * File rails, the phone's side metrics, the comparison strip — used to fetch its
 * own history and do its own subtraction. Two of them did it from different
 * sources (a capped trade replay versus the snapshot baselines) and rendered
 * side by side, so the centre and its own two sides could disagree about the
 * same window.
 *
 * This hook is the single answer. It:
 *
 *   • runs the EXACT query key and options the Case File already ran, so every
 *     additional caller is a React Query cache hit and adds no request;
 *   • reads the authoritative current state off the market row;
 *   • hands both to src/domain/market-change, which is where the arithmetic and
 *     the percentage rule live.
 *
 * The options live here rather than at each call site for the reason the startup
 * audit found the hard way: a shared query takes the most aggressive
 * `refetchInterval` any observer asks for, so one call site quietly setting a
 * shorter one re-times the query for everybody.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarketBaselines, type VolumeWindow } from "@/lib/markets.functions";
import { changeFromBaseline, nowFromRow, type MarketChange } from "@/domain/market-change";

export const BASELINES_STALE_MS = 30_000;
export const BASELINES_REFETCH_MS = 60_000;

/** Per-market key: never bridge one market's history into another's panel. */
export function baselinesQO(marketId: number) {
  return {
    queryKey: ["market-baselines", marketId] as const,
    queryFn: () => getMarketBaselines({ data: { id: marketId } }),
    staleTime: BASELINES_STALE_MS,
    refetchInterval: BASELINES_REFETCH_MS,
  };
}

/**
 * The current state, per side, off the market row — defined once in
 * src/domain/market-change and re-exported here for the existing call sites.
 */
export { nowFromRow } from "@/domain/market-change";


/**
 * What moved on this market over the on-screen window.
 *
 * Before the baselines land this returns a change whose every rank is
 * "unknown" — the totals are still true, and no claim about movement is made.
 * That is the honest reading of "we do not have the history yet", and it is why
 * nothing here falls back to zero.
 */
export function useMarketChange(marketId: number, row: unknown, win: VolumeWindow): MarketChange {
  const { data: baselines } = useQuery(baselinesQO(marketId));
  return useMemo(
    () => changeFromBaseline(nowFromRow(row), baselines?.[win], win),
    [row, baselines, win],
  );
}
