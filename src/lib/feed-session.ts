/**
 * Per-tab feed session state.
 *
 * The server sequences the feed, but it needs to know what this browsing
 * session has already seen. The client's only job is to OBSERVE and report:
 * which markets scrolled by, how many cards were viewed, how long since the
 * last idea. It never uses these numbers to decide anything itself.
 */
export interface FeedSessionSnapshot {
  seenIds: number[];
  cardsViewed: number;
  cardsSinceIdea: number;
  ideasShownThisSession: number;
}

const MAX_SEEN = 200;

const state = {
  seen: new Set<number>(),
  cardsViewed: 0,
  cardsSinceIdea: Number.MAX_SAFE_INTEGER,
  ideasShown: 0,
};

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
  return state.cardsViewed >= MIN_CARDS_FOR_IDEA;
}

/** Count one market card as actually viewed. Idempotent per market. */
export function noteCardViewed(marketId: number): void {
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
