/**
 * The one lens on screen.
 *
 * Believers / Capital / Price is a single choice for the whole case, not a
 * per-column toggle: clicking a metric in the YES column must move the NO
 * column (headline + chart) at the same time, so the two sides always answer
 * the same question. Same two-line external store as the deck window.
 */
import { useSyncExternalStore } from "react";

export type LensMetric = "believers" | "capital" | "price";

let current: LensMetric = "believers";
const listeners = new Set<() => void>();

export function setDeckLens(metric: LensMetric) {
  if (metric === current) return;
  current = metric;
  for (const l of listeners) l();
}

export function useDeckLens(): LensMetric {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}
