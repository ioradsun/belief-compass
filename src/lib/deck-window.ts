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

// A single shared cell across module instances: with code-splitting the deck and
// the rails can end up importing separate copies of this module, and two copies
// would mean two timeframes on screen. Pinning it to globalThis keeps ONE.
type Cell = { current: FlowWindow; listeners: Set<() => void> };
const g = globalThis as unknown as { __deckWindow?: Cell };
const cell: Cell = (g.__deckWindow ??= { current: "24h", listeners: new Set() });
const listeners = cell.listeners;

export function setDeckWindow(win: FlowWindow) {
  if (win === cell.current) return;
  cell.current = win;
  for (const l of listeners) l();
}

export function useDeckWindow(): FlowWindow {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cell.current,
    () => cell.current,
  );
}
