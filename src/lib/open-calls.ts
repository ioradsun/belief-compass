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
 * WHY THE DISMISSED SET IS VIEWER-LOCAL, kept from the rail that used to own it:
 * "not for me" is a private preference about one reader's own queue. It grants
 * nothing, it is owed to nobody, and it must NEVER become a record — no caller is
 * told, no relationship number moves, nothing enters Now. Persisting it
 * server-side would be building a ledger of who declined whom, which is precisely
 * what this product decided not to keep score of. localStorage is not a shortcut
 * here, it is the correct home: the storage whose worst failure mode is that a
 * card reappears.
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

/** Wave one call off. Tells nobody, writes nothing to the server. */
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

  const { data: challenges } = useQuery({
    queryKey: ["challenges", wallet ?? null],
    queryFn: () => getChallenges({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet && lock.unlocked,
    staleTime: 60_000,
  });

  const dismissed = useHiddenCalls();
  return {
    lock,
    open: (challenges ?? []).filter((c) => !dismissed.has(String(c.marketId))),
  };
}
