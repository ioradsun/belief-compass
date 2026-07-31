/**
 * The one time window on screen.
 *
 * The deck owns the selector, but the Case File columns live in a different
 * branch of the tree and must never quote a different period than the center.
 * This is a two-line external store rather than a context so no provider has to
 * wrap the whole app: the deck publishes, the case columns subscribe.
 */
import { useSyncExternalStore } from "react";
import type { FlowWindow } from "@/domain/market-flow";

let current: FlowWindow = "24h";
const listeners = new Set<() => void>();

export function setDeckWindow(win: FlowWindow) {
  if (win === current) return;
  current = win;
  for (const l of listeners) l();
}

export function useDeckWindow(): FlowWindow {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}
