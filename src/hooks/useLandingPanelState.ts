import { useCallback, useEffect, useState } from "react";

export type LandingPanelState = "expanded" | "collapsed";

const KEY = "conviction.landing-panel";

/**
 * First visit → expanded. Once the user explicitly enters or collapses, that
 * choice persists across visits. Only explicit decisions are stored; nothing
 * responsive or temporary is ever written.
 */
export function useLandingPanelState() {
  // Start collapsed for SSR/hydration parity, then restore on the client.
  const [state, setState] = useState<LandingPanelState>("collapsed");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(KEY);
    } catch {
      saved = null;
    }
    setState(saved === "collapsed" || saved === "expanded" ? saved : "expanded");
    setHydrated(true);
  }, []);

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
