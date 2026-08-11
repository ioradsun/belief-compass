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
 *
 * THE PRIVATE READS CARRY A SESSION. The account and the positions are the
 * private ledger, so the server proves the wallet before returning either — see
 * `simulation.functions`. `signedRead` is how a query supplies that proof without
 * ever opening a wallet: it uses a session the reader already minted (activation
 * needs one), and resolves to the empty answer when there is none. A read must
 * never be the thing that pops a signature request.
 */
import { queryOptions } from "@tanstack/react-query";
import {
  getSimulationAccount,
  getSimulationPositions,
  getSimulationPosition,
} from "@/lib/simulation.functions";
import { getProfileProgress } from "@/lib/beliefs.functions";
import { profileProgressFor } from "@/domain/beliefs";

/** Simulation reads are cheap and local — but they still are not free. */
export const SIMULATION_STALE_MS = 30_000;

/**
 * Run a private read with whatever session already exists, or return `empty`.
 *
 * `getSession` is the provider's non-interactive `ensureSession`. It throws
 * `SignatureRequired` when there is no cached session, and that is not an error
 * condition — it is a reader who has not started, or whose session has aged out.
 * Either way the honest answer is "no Simulation state", and the entry card
 * re-mints a session the moment they act.
 */
async function signedRead<T>(
  getSession: () => Promise<string>,
  run: (session: string) => Promise<T>,
  empty: T,
): Promise<T> {
  let session: string;
  try {
    session = await getSession();
  } catch {
    return empty;
  }
  return run(session);
}

/* ── Public: the conviction count ────────────────────────────────────────── */

export const profileProgressKey = (wallet: string | undefined) =>
  ["profile-progress", wallet?.toLowerCase() ?? null] as const;

/**
 * HOW FAR THROUGH THE FIRST TEN — unsigned, because it is an aggregate.
 *
 * It is a count over belief data the product already treats as viewer-readable,
 * and it is the number the entry card must print BEFORE anybody has signed
 * anything. Requiring proof here would mean a wallet that has never minted a
 * session is told it has zero convictions when it has eight.
 */
export function profileProgressQO(wallet: string | undefined) {
  return queryOptions({
    queryKey: profileProgressKey(wallet),
    queryFn: () => getProfileProgress({ data: { wallet: wallet ?? null } }),
    staleTime: SIMULATION_STALE_MS,
    initialData: () => profileProgressFor(0),
    initialDataUpdatedAt: 0,
  });
}

/* ── Private: the ledger ─────────────────────────────────────────────────── */

export const simulationAccountKey = (wallet: string | undefined) =>
  ["simulation-account", wallet?.toLowerCase() ?? null] as const;

/** The account: CC balance and lifecycle state. Null without a session. */
export function simulationAccountQO(wallet: string | undefined, getSession: () => Promise<string>) {
  return queryOptions({
    queryKey: simulationAccountKey(wallet),
    queryFn: () =>
      signedRead(
        getSession,
        (session) => getSimulationAccount({ data: { wallet: wallet as string, session } }),
        null,
      ),
    enabled: !!wallet,
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
export function simulationPositionsQO(
  wallet: string | undefined,
  getSession: () => Promise<string>,
) {
  return queryOptions({
    queryKey: simulationPositionsKey(wallet),
    queryFn: () =>
      signedRead(
        getSession,
        (session) => getSimulationPositions({ data: { wallet: wallet as string, session } }),
        [],
      ),
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
export function simulationPositionQO(
  wallet: string | undefined,
  marketId: number,
  getSession: () => Promise<string>,
) {
  return queryOptions({
    queryKey: simulationPositionKey(wallet, marketId),
    queryFn: () =>
      signedRead(
        getSession,
        (session) =>
          getSimulationPosition({ data: { wallet: wallet as string, session, marketId } }),
        null,
      ),
    enabled: !!wallet,
    staleTime: SIMULATION_STALE_MS,
  });
}
