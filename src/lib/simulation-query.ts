/**
 * SIMULATION — query options, declared once.
 *
 * The same discipline `positions-query.ts` and `network-query.ts` already apply:
 * one declaration per key, so two components mounting the same read cannot
 * disagree about its staleness or its interval.
 *
 * EVERY MODE-SENSITIVE KEY CARRIES THE MODE. That is not tidiness — React Query
 * dedupes by key, so a real position list and a Simulation position list sharing
 * one key would occupy the same cache entry, and exiting Simulation would leave
 * simulated holdings sitting under the real portfolio until something happened
 * to refetch. The keys here are named for the Simulation ledger explicitly,
 * which makes that collision unrepresentable rather than merely avoided.
 */
import { queryOptions } from "@tanstack/react-query";
import {
  getSimulationState,
  getSimulationPositions,
  getSimulationPosition,
} from "@/lib/simulation.functions";

/** Simulation reads are cheap and local — but they still are not free. */
export const SIMULATION_STALE_MS = 30_000;

export const simulationStateKey = (wallet: string | undefined) =>
  ["simulation-state", wallet?.toLowerCase() ?? null] as const;

/**
 * The account, the progress and the mode.
 *
 * ENABLED WITHOUT A WALLET TOO, and that is deliberate: the signed-out answer is
 * the honest empty state rather than a disabled query, so the banner and the
 * entry card can read one source instead of branching on whether the query ran.
 */
export function simulationStateQO(wallet: string | undefined) {
  return queryOptions({
    queryKey: simulationStateKey(wallet),
    queryFn: () => getSimulationState({ data: { wallet: wallet ?? null } }),
    staleTime: SIMULATION_STALE_MS,
  });
}

export const simulationPositionsKey = (wallet: string | undefined) =>
  ["simulation-positions", wallet?.toLowerCase() ?? null] as const;

/**
 * Every Simulation holding, valued against the live real market.
 *
 * `placeholderData` keeps the previous list through a refetch for the same reason
 * the real portfolio does: a list that blanks while re-pricing reads as "your
 * positions are gone", and that sentence is no less alarming for being about CC.
 */
export function simulationPositionsQO(wallet: string | undefined) {
  return queryOptions({
    queryKey: simulationPositionsKey(wallet),
    queryFn: () => getSimulationPositions({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet,
    staleTime: SIMULATION_STALE_MS,
    placeholderData: (prev: Awaited<ReturnType<typeof getSimulationPositions>> | undefined) => prev,
  });
}

export const simulationPositionKey = (wallet: string | undefined, marketId: number) =>
  ["simulation-position", wallet?.toLowerCase() ?? null, marketId] as const;

/**
 * ONE market's Simulation holding.
 *
 * Not bridged across markets, for the same reason `positionSummaryQO` is not:
 * carrying the previous result would show the last market's holding under this
 * market's controls, and "you own 238 YES" on a question somebody has never
 * touched is a wrong answer rather than a stale one.
 */
export function simulationPositionQO(wallet: string | undefined, marketId: number) {
  return queryOptions({
    queryKey: simulationPositionKey(wallet, marketId),
    queryFn: () => getSimulationPosition({ data: { wallet: wallet ?? null, marketId } }),
    enabled: !!wallet,
    staleTime: SIMULATION_STALE_MS,
  });
}
