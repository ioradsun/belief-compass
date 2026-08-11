/**
 * THE OPEN CALLS — one source, read by everything that shows a count.
 *
 * Two surfaces need to know how many questions are waiting on this reader: the
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
import { passedNow } from "@/domain/dependability";

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
  /** The queue: questions still waiting on this reader, and nothing else. */
  open: Challenge[];
  /**
   * WHAT RECENTLY BECAME OF THE ONES THAT WERE WAITING.
   *
   * Somebody showed up, or this reader passed. Kept apart from `open` rather than
   * mixed into it because the count on the tab and the badge in the mobile menu
   * must keep meaning "something is waiting on you" — an outcome asks for
   * nothing, and badging it would turn the payoff into another chore.
   */
  recent: Challenge[];
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
  /**
   * THE READ BEHIND THE LOCK FAILED — which is not the same as an unstarted
   * reader, and telling them apart matters more than the queue itself.
   *
   * `lock` is computed from `expressedBeliefs`, and an unread payload makes that
   * `0` via `?? 0`. Zero is not a missing number here, it is a MEANING: it renders
   * "Take 5 sides and we'll work out who your people are" — the first-run
   * onboarding sentence — to somebody who took forty. `Number(null) === 0` turned
   * an outage into a confident, welcoming, completely wrong claim about the
   * reader's own history.
   *
   * The server now throws instead of counting a failed read as no beliefs; this
   * carries that distinction the last step, to the only place that can say it.
   */
  lockUnknown: boolean;
}

/**
 * The open queue for a wallet.
 *
 * The count follows the LIST rather than the payload, so a badge always equals
 * what is on screen — three rows, three on the badge, no drift between them.
 *
 * IT COUNTS CHALLENGES, NOT PEOPLE, AND THIS COMMENT USED TO SAY OTHERWISE. It
 * claimed "three means three people are actually waiting", which
 * `composeChallenges` cannot deliver: it keeps ONE card per market
 * (`new Map<number, Challenge>()` keyed by marketId), so one person calling you
 * into two markets is two rows and one human, and two people calling you into
 * one market is one row and two humans. Measured against production the two
 * numbers diverged for EVERY responder with an open call — 14 open markets
 * across 7 open callers.
 *
 * The distinction matters because it is the number a sentence gets built from.
 * "3 people are waiting on you" is a claim about three humans; "3 open
 * Challenges" is a claim about the queue, and only the second one is true.
 */
export function useOpenCalls(wallet?: string): OpenCalls {
  // The same cached observer DnaFirstReveal uses — the lock costs no round trip.
  const { data: net, isError: netError } = useQuery({ ...networkQO(wallet), enabled: !!wallet });
  const lock = challengeLock(net?.summary.expressedBeliefs ?? 0, (net?.summary.twinCount ?? 0) > 0);
  // `placeholderData` keeps the last good payload on screen through a refetch, so
  // a failure only makes the lock UNKNOWN when there is nothing behind it.
  const lockUnknown = netError && !net;

  const { data: challenges, isError } = useQuery({
    queryKey: ["challenges", wallet ?? null],
    queryFn: () => getChallenges({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet && lock.unlocked,
    staleTime: 60_000,
  });

  /**
   * THE LOCAL SET NO LONGER DELETES A CARD — IT PASSES ON IT.
   *
   * It used to remove the row from the payload entirely, which was right while a
   * pass was a private preference owed to nobody. It stopped being right the day
   * the server started recording the pass and the card started surviving its own
   * ending: a row filtered out here would vanish on the tap, then reappear as an
   * outcome on the next refetch. A card that disappears and comes back looks like
   * a bug, and this store is the only thing that knows the difference.
   *
   * So a locally-passed row is RESTATED, not removed. `passedNow` produces exactly
   * what the server will produce once the write lands — the run ends, it does not
   * silently shrink — which is what makes the optimistic render and the eventual
   * truth the same sentence rather than two.
   */
  const dismissed = useHiddenCalls();
  const now = Date.now();
  const all = (challenges ?? []).map(
    (c): Challenge =>
      c.state === "waiting" && dismissed.has(String(c.marketId))
        ? {
            ...c,
            state: "passed",
            stateAtMs: now,
            reciprocity: c.reciprocity ? passedNow(c.reciprocity) : null,
          }
        : // ALREADY TERMINAL ON THE SERVER, so the local set has nothing to say. A
          // market waved off last month and then answered anyway reads as the
          // answer: taking a side outranks a pass everywhere else in this system,
          // and a stale local preference must not be the one place it does not.
          c,
  );
  return {
    lock,
    open: all.filter((c) => c.state === "waiting"),
    recent: all
      .filter((c) => c.state !== "waiting")
      .sort((a, b) => b.stateAtMs - a.stateAtMs || a.marketId - b.marketId),
    failed: isError,
    lockUnknown,
  };
}
