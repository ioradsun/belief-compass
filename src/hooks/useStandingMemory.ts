/**
 * What this reader has already been told.
 *
 * A standing fact does not age, so it has no expiry — the control that keeps a
 * small pool from reading as a loop is a per-reader COOLDOWN, and "per reader"
 * means this has to live in the browser. The server has no idea which facts you
 * personally have already seen, and persisting that server-side would mean a
 * write on every quiet moment for a decoration.
 *
 * Deliberately best-effort: a cleared browser means a reader might hear a true
 * thing again sooner than intended, which is the cheapest possible failure.
 */
import { useCallback, useRef } from "react";
import { isFactFresh } from "@/domain/standing-fact";

const STORE_KEY = "cc:standing-said";
/** Keep the map small; the oldest entries are past their cooldown anyway. */
const MAX_KEYS = 200;

function load(): Map<string, number> {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, number>));
  } catch {
    return new Map();
  }
}

function save(m: Map<string, number>) {
  try {
    const trimmed = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_KEYS);
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // A full or blocked store costs the cooldown, never the feed.
  }
}

export function useStandingMemory() {
  const said = useRef<Map<string, number> | null>(null);
  if (said.current == null) said.current = load();

  const fresh = useCallback(
    (key: string) => isFactFresh(key, said.current ?? new Map(), Date.now()),
    [],
  );
  const remember = useCallback((key: string) => {
    const m = said.current;
    if (!m || m.has(key)) return;
    m.set(key, Date.now());
    save(m);
  }, []);

  return { fresh, remember };
}
