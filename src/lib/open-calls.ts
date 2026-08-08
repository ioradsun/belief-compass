/**
 * THE OPEN CALLS — one source, read by everything that shows a count.
 *
 * Two surfaces need to know how many people are waiting on this reader: the
 * Challenge rail itself, and the mobile menu item that leads to it. If each
 * derived its own number they would drift the moment a card is dismissed — the
 * menu would say 3 while the rail shows 2, and the badge would stop being worth
 * believing.
 *
 * So the filtering lives here, once. The query is keyed identically in both
 * places (React Query dedupes it into a single request), and the dismissed set is
 * a real subscribable store rather than component state, so a dismissal on the
 * card updates the menu in the same commit.
 *
 * WHY THE DISMISSED SET IS STILL LOCAL, NOW THAT A PASS IS ALSO DURABLE.
 *
 * This comment used to say a pass must NEVER become a record, and that was right
 * while nobody was owed an answer. It changed when the creator started seeing what
 * became of the thing they put up: "1 passed" cannot be honest if a pass exists
 * only in one browser. The reversal is deliberate and bounded — see `hideCall`.
 *
 * The local set survives the change and earns its place twice over: the card
 * leaves INSTANTLY rather than after a round trip, and a failed write can never
 * mean it comes back. The server write is the durable fact; this is the responsive
 * one, and neither is waiting on the other.
 */
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { networkQO } from "@/lib/network-query";
import { getChallenges } from "@/lib/challenge.functions";
import { challengeLock, type Challenge } from "@/domain/challenge";

const HIDDEN_KEY = "conviction:calls-hidden";

/** Stable across reads: `useSyncExternalStore` tears if the snapshot is fresh. */
let cache: Set<string> | null = null;
const EMPTY: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function read(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function snapshot(): ReadonlySet<string> {
  if (cache == null) cache = read();
  return cache;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * WAVE ONE CALL OFF — locally, and now also durably.
 *
 * The local set stays, because it is what makes the card leave INSTANTLY without
 * waiting on a round trip, and because a failed write must never mean the card
 * comes back. What changed is that the server learns too: a creator is now shown
 * "1 passed", and that sentence cannot be honest if a pass only ever existed in
 * one browser's localStorage.
 *
 * The limits from the original decision are intact. It is Challenge lifecycle
 * only — Conviction Match cannot see it and Showing Up cannot see it — and the
 * creator is told a COUNT, never a name. Nobody is ever told that a particular
 * person passed on them, because a pass is a choice about a question rather than
 * a verdict on a person.
 */
export function hideCall(marketId: number) {
  const next = new Set(snapshot());
  next.add(String(marketId));
  // Bounded: a preference list, not a history. Oldest fall off, and the worst
  // consequence of that is a card dismissed months ago coming back.
  cache = new Set([...next].slice(-200));
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...cache]));
  } catch {
    /* storage unavailable — the card simply stays, which is harmless */
  }
  for (const fn of listeners) fn();
}

export function useHiddenCalls(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export interface OpenCalls {
  lock: ReturnType<typeof challengeLock>;
  /** The queue minus anything this reader has waved off. */
  open: Challenge[];
  /**
   * THE READ FAILED — which is NOT the same as nobody waiting.
   *
   * `buildChallenges` opens with an unguarded `serviceClient()`, and
   * `createClient` throws SYNCHRONOUSLY on a missing key. So a deployment
   * without SUPABASE_SERVICE_ROLE_KEY makes `getChallenges` throw on every
   * call — and without this flag the rail read `data` as undefined, computed an
   * empty queue, and rendered "Nobody is waiting on you right now."
   *
   * A calm, honest-sounding sentence, produced by a request that never
   * completed. That is this codebase's signature failure — a blocked read
   * destructured as `{ data }` becoming "nothing happened" — and it is the
   * leading explanation for `market_calls` holding zero rows while supply
   * exists, because the surface would look completely healthy the whole time.
   */
  failed: boolean;
}

/**
 * The open queue for a wallet.
 *
 * The count follows the LIST rather than the payload, so a badge always equals
 * what is on screen — three means three people are actually waiting.
 */
export function useOpenCalls(wallet?: string): OpenCalls {
  // The same cached observer DnaFirstReveal uses — the lock costs no round trip.
  const { data: net } = useQuery({ ...networkQO(wallet), enabled: !!wallet });
  const lock = challengeLock(net?.summary.expressedBeliefs ?? 0, (net?.summary.twinCount ?? 0) > 0);

  const { data: challenges, isError } = useQuery({
    queryKey: ["challenges", wallet ?? null],
    queryFn: () => getChallenges({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet && lock.unlocked,
    staleTime: 60_000,
  });

  const dismissed = useHiddenCalls();
  return {
    lock,
    open: (challenges ?? []).filter((c) => !dismissed.has(String(c.marketId))),
    failed: isError,
  };
}
