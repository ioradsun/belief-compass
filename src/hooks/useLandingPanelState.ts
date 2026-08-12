import { useCallback, useEffect, useState } from "react";

export type LandingPanelState = "expanded" | "collapsed";

const KEY = "conviction.landing-panel";

/**
 * First visit → expanded. Once the user explicitly enters or collapses, that
 * choice persists across visits. Only explicit decisions are stored; nothing
 * responsive or temporary is ever written.
 *
 * `allowCollapsed` lets the caller decide whether a persisted "collapsed"
 * state is allowed to restore. When no wallet is connected in cache the panel
 * should stay open as an invitation to connect, so callers can pass `false` and
 * any saved collapsed state is ignored until a wallet is present.
 */
export function useLandingPanelState(allowCollapsed = true) {
  // Default to the FIRST-VISIT state ("expanded") for SSR/hydration parity, so the
  // first paint already matches what a first-time visitor should see — no
  // collapsed→expanded flip on load. The effect below only ever *collapses*, and
  // only for a returning user who explicitly collapsed (localStorage), which is a
  // smooth shrink rather than a blink.
  const [state, setState] = useState<LandingPanelState>("expanded");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(KEY);
    } catch {
      saved = null;
    }
    const restored =
      saved === "collapsed" || saved === "expanded" ? saved : "expanded";
    setState(allowCollapsed ? restored : "expanded");
    setHydrated(true);
  }, [allowCollapsed]);

  const persist = useCallback((next: LandingPanelState) => {
    setState(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable — session-only is fine */
    }
  }, []);

  const collapse = useCallback(() => persist("collapsed"), [persist]);
  const expand = useCallback(() => persist("expanded"), [persist]);

  return { state, hydrated, collapse, expand };
}
