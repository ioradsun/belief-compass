/**
 * HOW MUCH HAS TO HAPPEN — the reader's own floor, remembered.
 *
 * The value is a row in the one bar table (@/domain/market-change#BARS). This
 * module owns only where it is KEPT and how it is shared; it never defines a
 * threshold, because a second place for those numbers is exactly what the
 * consolidation removed.
 *
 * A two-line external store rather than a context, following `deck-window`: the
 * filter menu publishes, the feed query subscribes, and no provider has to wrap
 * the app. Pinned to `globalThis` for the same reason — with code-splitting the
 * rail and the route can import separate copies of this module, and two copies
 * would mean two floors on one screen.
 *
 * PERSISTED, because a floor is a preference rather than a session state: a
 * reader who said "only the big ones" meant it tomorrow as well. Storage is
 * best-effort — a blocked localStorage costs the preference, never the feed.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_SENSITIVITY, SENSITIVITY_ORDER, type Sensitivity } from "@/domain/market-change";

const KEY = "conviction:feed-sensitivity";

const parse = (v: unknown): Sensitivity =>
  SENSITIVITY_ORDER.includes(v as Sensitivity) ? (v as Sensitivity) : DEFAULT_SENSITIVITY;

function restore(): Sensitivity {
  try {
    return parse(window.localStorage.getItem(KEY));
  } catch {
    return DEFAULT_SENSITIVITY;
  }
}

type Cell = { current: Sensitivity; listeners: Set<() => void>; hydrated: boolean };
const g = globalThis as unknown as { __feedSensitivity?: Cell };
const cell: Cell = (g.__feedSensitivity ??= {
  current: DEFAULT_SENSITIVITY,
  listeners: new Set(),
  hydrated: false,
});

export function setFeedSensitivity(next: Sensitivity) {
  const v = parse(next);
  if (v === cell.current) return;
  cell.current = v;
  try {
    window.localStorage.setItem(KEY, v);
  } catch {
    /* storage unavailable — the choice still holds for this session */
  }
  for (const l of cell.listeners) l();
}

/**
 * The reader's floor.
 *
 * SSR RETURNS THE DEFAULT AND HYDRATION CATCHES UP. The server cannot know a
 * preference held in the browser, and rendering the stored value on the client's
 * first pass would be a hydration mismatch. Reading storage on first subscribe
 * — not during render — keeps the two passes identical and then corrects.
 */
export function useFeedSensitivity(): Sensitivity {
  return useSyncExternalStore(
    (cb) => {
      if (!cell.hydrated) {
        cell.hydrated = true;
        const stored = restore();
        if (stored !== cell.current) {
          cell.current = stored;
          queueMicrotask(() => {
            for (const l of cell.listeners) l();
          });
        }
      }
      cell.listeners.add(cb);
      return () => cell.listeners.delete(cb);
    },
    () => cell.current,
    () => DEFAULT_SENSITIVITY,
  );
}
