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
  /** When the reader's current pass began, epoch ms. */
  cycleStartedAt: number;
}

/**
 * HOW MUCH OF A PASS THE BROWSER REMEMBERS.
 *
 * A pass can be thousands of markets long, so this is a working set, not the
 * record: for a connected wallet the server ledger is the truth and this only
 * covers sightings it has not stored yet. The cap is generous enough that a
 * signed-out reader browsing hard still never sees a repeat inside a pass.
 */
const MAX_SEEN = 1_000;
/** How many of them travel with a request — the schema's own cap. */
const SEND_SEEN = 500;
/**
 * How many just-seen markets survive a roll.
 *
 * Rolling the pass makes everything eligible again, and the markets nearest the
 * roll are the ones the reader was looking at seconds ago. Carrying a handful
 * across the boundary is what stops the first card of a new pass being the last
 * card of the old one.
 */
const CARRY_ON_ROLL = 12;

/** The server's initial-admission floor (currently immediate for ready ideas). */
const MIN_CARDS_FOR_IDEA = SUGGESTION.MIN_SESSION_CARDS_VIEWED;

/**
 * A BROWSING PASS OUTLIVES THE TAB.
 *
 * The pass is the reader's position in the catalogue, so it belongs in
 * localStorage: closing a tab is not finishing a pass, and a fresh tab that
 * forgot would start handing back the markets the last one just showed.
 */
const KEY = "feed-session:v2";

const state = {
  seen: new Set<number>(),
  cardsViewed: 0,
  cardsSinceIdea: Number.MAX_SAFE_INTEGER,
  ideasShown: 0,
  cycleStartedAt: 0,
};

let hydrated = false;

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) {
      // No record at all = the first pass, and it starts now.
      state.cycleStartedAt = Date.now();
      return;
    }
    const p = JSON.parse(raw) as Partial<FeedSessionSnapshot>;
    state.seen = new Set(Array.isArray(p.seenIds) ? p.seenIds : []);
    state.cardsViewed = Number(p.cardsViewed) || 0;
    state.cycleStartedAt = Number(p.cycleStartedAt) || Date.now();
    state.cardsSinceIdea =
      p.cardsSinceIdea == null || p.cardsSinceIdea >= 10_000
        ? Number.MAX_SAFE_INTEGER
        : Number(p.cardsSinceIdea);
    // `ideasShown` is deliberately NOT restored: an idea that was shown but
    // never acted on is still unanswered, and the cap exists to stop repeats
    // inside one continuous read, not to hide it forever.
  } catch {
    // A corrupt entry must never cost the reader their feed.
    state.cycleStartedAt = Date.now();
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

/**
 * Count one market card as actually viewed.
 *
 * THE SET IS AN LRU, and it has to be. `seenIds` travels to the server in
 * insertion order and the feed reads that order as recency — it is what decides
 * which already-seen market comes back first once the fresh pool is empty (see
 * EligibilityInput.sessionSeenRank), and it is what `MAX_SEEN` evicts against.
 *
 * So a REPEAT VIEW is not a no-op. It used to be — `if (seen.has(id)) return`
 * before anything else — which was harmless while a seen market could never be
 * shown twice, and became a loop the moment it could: the market kept the rank
 * it was first given, stayed the oldest sighting forever, and would be offered
 * back ahead of everything else on every subsequent build. Re-inserting moves it
 * to the end of the order, which is the honest record of when it was last on
 * screen.
 *
 * The COUNTERS stay idempotent. `cardsViewed` and `cardsSinceIdea` pace the
 * House idea against how much NEW material the reader has worked through, and
 * seeing the same market twice is not progress by that measure.
 */
export function noteCardViewed(marketId: number): void {
  hydrate();
  const repeat = state.seen.delete(marketId);
  state.seen.add(marketId);
  if (state.seen.size > MAX_SEEN) {
    const first = state.seen.values().next().value as number | undefined;
    if (first != null) state.seen.delete(first);
  }
  if (repeat) {
    bump();
    return;
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
