/**
 * THE VIEWER'S NETWORK — one query definition, six call sites.
 *
 * WHAT THIS FIXES. `["network", wallet, "all", "relevant", ""]` was declared
 * independently in six components. Five of them agreed: `staleTime: 60_000`, no
 * interval. The sixth — the left rail's tab strip, which mounts at startup —
 * declared `refetchInterval: 60_000` and NO staleTime, directly under a comment
 * explaining that it shares the panels' cache so React Query can dedupe.
 *
 * It could not. React Query dedupes by KEY, but staleness is per-observer: with
 * no `staleTime` that observer treats the data as stale the instant it arrives,
 * so mounting it right after another component had already fetched triggered a
 * second request for bytes the cache was holding. And because a shared query
 * takes the most aggressive interval any observer asks for, that one
 * declaration also put the whole app's network on a 60-second poll — including
 * for readers who never open the rail.
 *
 * A shared key is a shared CONTRACT. Six copies of it is six chances for one to
 * drift, and the drift is invisible: nothing errors, nothing fails a type check,
 * the app just fetches more than it needs to. So there is now one definition and
 * the call sites import it.
 *
 * WHY NO STANDING INTERVAL. The realtime coordinator already invalidates this on
 * the events that change it. A poll on top of a subscription is the "realtime
 * subscriptions duplicated by polling" case — two mechanisms for one job, and
 * the slower one wins the argument about how fresh the data feels.
 *
 * THE ONE EXCEPTION, and it is not a poll for freshness. `getNetwork` reads a
 * cache a BACKGROUND WORKER fills, and when that cache is missing the read also
 * asks for it to be computed. A first-time reader therefore triggers a
 * computation on load and then has nobody asking again — their network stayed
 * empty until they happened to switch tabs. So this query polls while, and only
 * while, the server says the answer is still being computed. See
 * @/domain/dna-freshness.
 */
import { queryOptions } from "@tanstack/react-query";
import { getNetwork, type NetworkResponse } from "@/lib/dna.functions";
import { dnaPollInterval } from "@/domain/dna-freshness";

/** How long the viewer's network is considered fresh. */
export const NETWORK_STALE_MS = 60_000;

/** People shown. The panels page beyond this; the counts never need more. */
export const NETWORK_LIMIT = 60;

/**
 * The viewer's network, exactly as every surface should ask for it.
 *
 * `query` is only non-empty in the searchable panel — it is part of the key, so
 * a search does not evict the unfiltered list every other surface is reading.
 */
export function networkQO(wallet: string | undefined, query = "") {
  return queryOptions({
    queryKey: ["network", wallet ?? null, "all", "relevant", query],
    queryFn: () =>
      getNetwork({
        data: { wallet, relationship: "all", sort: "relevant", query, limit: NETWORK_LIMIT },
      }),
    enabled: !!wallet,
    staleTime: NETWORK_STALE_MS,
    // A bounded wait on the worker, not a standing poll: `false` the moment the
    // answer is fresh, and after 20 tries either way.
    refetchInterval: (q: { state: { data?: NetworkResponse; dataUpdateCount: number } }) =>
      dnaPollInterval(q.state.data?.freshness, q.state.dataUpdateCount),
    // Never blank a list that is already on screen while a refetch is in flight.
    placeholderData: (prev: NetworkResponse | undefined) => prev,
  });
}
