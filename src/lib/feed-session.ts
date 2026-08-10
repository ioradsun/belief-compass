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

/** The server's initial-admission floor (currently immediate for ready ideas). */
const MIN_CARDS_FOR_IDEA = SUGGESTION.MIN_SESSION_CARDS_VIEWED;

/**
 * A BROWSING SESSION SURVIVES A PAGE LOAD.
 *
 * The counters below let the server enforce repeat cadence consistently across
 * a full document load, a market opened from search, or a return from an info
 * page. sessionStorage is exactly the right lifetime: one tab, one visit.
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
 * The feed request carries these counters. Subscribers keep cadence changes
 * observable without coupling them to a particular navigation path.
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

/** Is this session past the initial admission floor for a ready House idea? */
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
