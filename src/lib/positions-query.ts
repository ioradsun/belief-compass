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
import { queryOptions, useQuery } from "@tanstack/react-query";
import { getWallet, getPositionSummary, type VolumeWindow } from "@/lib/markets.functions";
import { simulationPositionsQO } from "@/lib/simulation-query";
import { useSimulationMode } from "@/lib/simulation-mode";

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

/* ── The mode-aware layer ────────────────────────────────────────────────────
 *
 * ABOVE the two query families, never inside them. The real queries are
 * untouched — a Simulation branch inside `myConvictionsQO` would put a mode check
 * on the path of every real portfolio read, and the first one anybody forgot
 * would show simulated holdings as money.
 *
 * THERE IS NO COMBINED PORTFOLIO. This selects, it does not merge: while
 * Simulation is active the real positions are not read into the panel at all, and
 * the moment it ends they return whole. A reader is always looking at exactly one
 * ledger, which is the only way the totals on screen mean anything.
 */

/**
 * A held position in the shape the portfolio surfaces already read.
 *
 * The Simulation holdings are mapped INTO this shape rather than the panel
 * learning a second one, and they can be because CC uses the same numeric
 * convention a USD-marked position does — so `positionValueUsd`, `positionPnl`,
 * the return maths and the story all work unchanged. ONLY THE FORMATTER differs,
 * which is exactly the amount of difference there actually is.
 */
export interface ViewerPosition {
  onchain_id: number;
  yes_shares: number | null;
  no_shares: number | null;
  yes_cost?: number | null;
  no_cost?: number | null;
  markets?: { title?: string | null } | null;
  state?: { yes_price_usd: number | null; no_price_usd: number | null } | null;
  yes_value_usd?: number | null;
  no_value_usd?: number | null;
}

export interface ViewerPositions {
  /** The active ledger's holdings. Never a union of both. */
  positions: ViewerPosition[];
  /** These are CC-denominated Simulation holdings. */
  simulated: boolean;
}

/** What the viewer holds, in whichever ledger they are currently in. */
export function useViewerPositions(
  wallet: string | undefined,
  win: VolumeWindow,
): ViewerPositions & { raw: unknown } {
  const { active } = useSimulationMode();

  const real = useQuery({ ...myConvictionsQO(wallet, win), enabled: !!wallet && !active });
  const sim = useQuery({ ...simulationPositionsQO(wallet), enabled: !!wallet && active });

  if (active) {
    const positions: ViewerPosition[] = (sim.data ?? []).map((h) => ({
      onchain_id: h.onchainId,
      yes_shares: h.yesShares,
      no_shares: h.noShares,
      yes_cost: h.yesCostCc,
      no_cost: h.noCostCc,
      markets: { title: h.title },
      state: { yes_price_usd: h.yesPriceUsd, no_price_usd: h.noPriceUsd },
      yes_value_usd: h.yesValueCc,
      no_value_usd: h.noValueCc,
    }));
    return { positions, simulated: true, raw: sim.data };
  }
  return {
    positions: ((real.data?.positions ?? []) as ViewerPosition[]) ?? [],
    simulated: false,
    raw: real.data,
  };
}
