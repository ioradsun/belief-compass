/**
 * ONE SENT CHALLENGE, ANNOUNCED ONCE — the seam between three surfaces that
 * never touch each other.
 *
 * Pressing send in the market column has to (a) confirm, (b) move the reader
 * on, and (c) leave the thing they just made VISIBLE somewhere they can find
 * it. The rail and the chain card are siblings of the panel, not children, so
 * the announcement is a tiny store rather than a prop path: the panel says
 * "this market went up, now", the rail turns to Challenge, and the card for
 * that market lights up for a few seconds and then stops. Nothing persists —
 * a highlight is a moment, not state.
 */
import { useSyncExternalStore } from "react";

export interface ChallengeSent {
  marketId: number;
  at: number;
}

/** How long a freshly sent Challenge stays lit in the rail. */
export const SENT_HIGHLIGHT_MS = 5000;

let current: ChallengeSent | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

const emit = () => listeners.forEach((l) => l());

export function announceChallengeSent(marketId: number) {
  current = { marketId, at: Date.now() };
  emit();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    timer = null;
    emit();
  }, SENT_HIGHLIGHT_MS);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The live announcement, or null. Server render always sees null. */
export function useChallengeSent(): ChallengeSent | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/**
 * TURN THE RAIL TO WHERE THE RESULT WILL LAND, THE MOMENT THE TASK STARTS.
 *
 * Pressing Challenge opens the panel over the market; what comes out of it is
 * an OUTGOING row. Pointing the rail there on the press — not on the send —
 * means the reader can already see the column their new question joins, so the
 * send has somewhere visible to land instead of appearing from nowhere.
 */
export interface ChallengeFocus {
  view: "mine" | "theirs";
  at: number;
}

let focus: ChallengeFocus | null = null;
const focusListeners = new Set<() => void>();

export function focusChallengeView(view: ChallengeFocus["view"] = "mine") {
  focus = { view, at: Date.now() };
  focusListeners.forEach((l) => l());
}

const subscribeFocus = (l: () => void) => {
  focusListeners.add(l);
  return () => focusListeners.delete(l);
};

/** The live focus request, or null. Server render always sees null. */
export function useChallengeFocus(): ChallengeFocus | null {
  return useSyncExternalStore(
    subscribeFocus,
    () => focus,
    () => null,
  );
}
