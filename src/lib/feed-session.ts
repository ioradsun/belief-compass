/**
 * Per-tab feed session state.
 *
 * The server sequences the feed, but it needs to know what this browsing
 * session has already seen. The client's only job is to OBSERVE and report:
 * which markets scrolled by, how many cards were viewed, how long since the
 * last idea. It never uses these numbers to decide anything itself.
 */
import { SUGGESTION } from "@/domain/market-suggestion";

export interface FeedSessionSnapshot {
  seenIds: number[];
  cardsViewed: number;
  cardsSinceIdea: number;
  ideasShownThisSession: number;
}

const MAX_SEEN = 200;

/** The session gate the server applies (SUGGESTION.MIN_SESSION_CARDS_VIEWED). */
const MIN_CARDS_FOR_IDEA = SUGGESTION.MIN_SESSION_CARDS_VIEWED;

/**
 * A BROWSING SESSION SURVIVES A PAGE LOAD.
 *
 * The counters below are what the server's idea gate reads: it will not offer
 * "The House has an idea" until this session has actually watched a few cards.
 * Held only in module memory, every full document load — opening a market from
 * search, a preview reload, a return from an info page — reset the count to
 * zero, so in practice the gate almost never opened and the idea never arrived.
 * sessionStorage is exactly the right lifetime: one tab, one visit.
 */
const KEY = "feed-session:v1";

const state = {
  seen: new Set<number>(),
  cardsViewed: 0,
  cardsSinceIdea: Number.MAX_SAFE_INTEGER,
  ideasShown: 0,
};

let hydrated = false;

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as Partial<FeedSessionSnapshot>;
    state.seen = new Set(Array.isArray(p.seenIds) ? p.seenIds : []);
    state.cardsViewed = Number(p.cardsViewed) || 0;
    state.cardsSinceIdea =
      p.cardsSinceIdea == null || p.cardsSinceIdea >= 10_000
        ? Number.MAX_SAFE_INTEGER
        : Number(p.cardsSinceIdea);
    // `ideasShown` is deliberately NOT restored: an idea that was shown but
    // never acted on is still unanswered, and the cap exists to stop repeats
    // inside one continuous read, not to hide it forever.
  } catch {
    // A corrupt entry must never cost the reader their feed.
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        seenIds: [...state.seen],
        cardsViewed: state.cardsViewed,
        cardsSinceIdea:
          state.cardsSinceIdea === Number.MAX_SAFE_INTEGER ? 10_000 : state.cardsSinceIdea,
        ideasShownThisSession: state.ideasShown,
      }),
    );
  } catch {
    /* storage full or blocked — the counters simply stay in memory */
  }
}

/**
 * Anyone who needs to REACT to the session changing, not just read it.
 *
 * The feed request carries these counters, but React Query keys the request on
 * the reader's choices only — so crossing a threshold (five cards viewed, the
 * gate the House idea waits behind) changed nothing until the next 60s poll,
 * and on a fresh key it re-sent `cardsViewed: 0`. Subscribers let the gate
 * become part of the key.
 */
const listeners = new Set<() => void>();
let version = 0;

function bump(): void {
  version += 1;
  persist();
  for (const l of listeners) l();
}

export function subscribeFeedSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Monotonic counter — a stable snapshot value for useSyncExternalStore. */
export function feedSessionVersion(): number {
  return version;
}

/** Has this session watched enough cards for the House to be allowed an idea? */
export function ideaGateOpen(): boolean {
  hydrate();
  return state.cardsViewed >= MIN_CARDS_FOR_IDEA;
}

/** Count one market card as actually viewed. Idempotent per market. */
export function noteCardViewed(marketId: number): void {
  hydrate();
  if (state.seen.has(marketId)) return;
  state.seen.add(marketId);
  if (state.seen.size > MAX_SEEN) {
    const first = state.seen.values().next().value as number | undefined;
    if (first != null) state.seen.delete(first);
  }
  state.cardsViewed += 1;
  if (state.cardsSinceIdea < Number.MAX_SAFE_INTEGER) state.cardsSinceIdea += 1;
  bump();
}

/** An idea card was actually shown to the viewer. */
export function noteIdeaShown(): void {
  state.ideasShown += 1;
  state.cardsSinceIdea = 0;
  bump();
}

export function feedSession(): FeedSessionSnapshot {
  hydrate();
  return {
    seenIds: [...state.seen],
    cardsViewed: state.cardsViewed,
    cardsSinceIdea:
      state.cardsSinceIdea === Number.MAX_SAFE_INTEGER ? 10_000 : state.cardsSinceIdea,
    ideasShownThisSession: state.ideasShown,
  };
}

/** Test/sign-out helper: forget this session's observations. */
export function resetFeedSession(): void {
  state.seen.clear();
  state.cardsViewed = 0;
  state.cardsSinceIdea = Number.MAX_SAFE_INTEGER;
  state.ideasShown = 0;
  bump();
}
