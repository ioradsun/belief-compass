/**
 * Universal "open this person" bridge.
 *
 * Any avatar, anywhere in the app, can open a profile in the center panel
 * without prop-drilling a callback through every intermediate component. The
 * page shell registers the one real handler (which sets ?p= and focuses the
 * center column); everything else just calls focusPerson().
 */

type Handler = (wallet: string) => void;

let handler: Handler | null = null;

/** The page shell registers the single selection handler. Returns an unsubscribe. */
export function registerPersonFocus(fn: Handler): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

/** Open a wallet's profile in the center panel. No-op when nothing is registered. */
export function focusPerson(wallet: string | null | undefined): void {
  if (!wallet || !handler) return;
  handler(wallet);
}

/** Whether a profile can currently be opened (used to keep avatars inert if not). */
export function canFocusPerson(): boolean {
  return handler != null;
}
