/**
 * WHAT THE VIEWER OWNS, AND WHAT IT IS WORTH — one definition, no timer.
 *
 * `["my-convictions", wallet, window]` was declared twice (MyConvictions and
 * MyWorld) and `["position-summary", wallet, marketId]` once, each with its own
 * interval: 30s, 30s and 20s. Same drift as `network-query.ts` and
 * `market-queries.ts` — React Query dedupes the key, never the options.
 *
 * `getWallet` is not a cheap read. Besides the `wallet_beliefs` and market
 * stitching, it calls OUT to pov.co on every request (4s timeout) to price the
 * wallet's tokens live. Two mounted components at 30s meant that external call
 * ran twice a minute for as long as the tab was open.
 *
 * WHAT ACTUALLY MOVES THESE NUMBERS — and what now watches for it:
 *
 *   the viewer trades              usePositionStream (their `wallet_beliefs`)
 *   someone else trades a market
 *     the viewer holds             coordinator → affectedViewerValuationKeys
 *   tab regains focus              refetchOnWindowFocus (global default)
 *   back online / socket recovery  refetchOnReconnect + the coordinator
 *
 * The second row is the one the polls existed for, and it is now driven by the
 * trade itself rather than by a clock — matched against the viewer's actual
 * holdings, so a reader holding none of the traded markets refetches nothing.
 * Platform-wide there are ~151 trades a day; the 30s timer was firing 120 times
 * an hour to catch them.
 *
 * The staleTimes stay: they are what makes switching tabs or reopening a panel
 * reuse the cache instead of paying for pov.co again.
 */
import { queryOptions } from "@tanstack/react-query";
import { getWallet, getPositionSummary, type VolumeWindow } from "@/lib/markets.functions";

export const POSITIONS_STALE_MS = 60_000;

/**
 * Every position the wallet holds, valued for the on-screen window.
 *
 * `placeholderData` keeps the previous list on screen through a refetch — a
 * portfolio that blanks while re-pricing reads as "your money is gone".
 */
export function myConvictionsQO(wallet: string | undefined, win: VolumeWindow) {
  return queryOptions({
    queryKey: ["my-convictions", wallet ?? null, win] as const,
    queryFn: () => getWallet({ data: { wallet: wallet as string, window: win } }),
    enabled: !!wallet,
    staleTime: POSITIONS_STALE_MS,
    placeholderData: (prev: Awaited<ReturnType<typeof getWallet>> | undefined) => prev,
  });
}

/**
 * The viewer's holding on ONE market — cost basis and current worth.
 *
 * NOT bridged across markets: the id is in the key, so carrying the previous
 * result would show the last market's holding under this market's controls —
 * "You own $234 YES" on a market they have never touched.
 */
export function positionSummaryQO(wallet: string | undefined, marketId: number) {
  return queryOptions({
    queryKey: ["position-summary", wallet ?? null, marketId] as const,
    queryFn: () => getPositionSummary({ data: { wallet: wallet as string, marketId } }),
    enabled: !!wallet,
    staleTime: POSITIONS_STALE_MS,
  });
}
