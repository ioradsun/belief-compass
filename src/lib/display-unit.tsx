/**
 * Display-unit preference — the viewer's choice of USD or ETH, app-wide.
 *
 * A single, session-persistent preference read by every money surface. The
 * conversion math lives in the pure `@/domain/money`; this is just the client
 * state + persistence. Server render and first client paint both default to USD
 * so the hydrated HTML matches; a stored ETH preference is applied on the next
 * frame (an effect), never during render — no hydration mismatch.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { DisplayUnit } from "@/domain/money";

const KEY = "conviction:display-unit";

interface DisplayUnitCtx {
  unit: DisplayUnit;
  setUnit: (u: DisplayUnit) => void;
  toggle: () => void;
}

const Ctx = createContext<DisplayUnitCtx>({
  unit: "USD",
  setUnit: () => {},
  toggle: () => {},
});

export function DisplayUnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnitState] = useState<DisplayUnit>("USD");

  // Hydrate the stored preference after mount (never during render).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "ETH" || saved === "USD") setUnitState(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setUnit = (u: DisplayUnit) => {
    setUnitState(u);
    try {
      window.localStorage.setItem(KEY, u);
    } catch {
      /* storage unavailable */
    }
  };

  const toggle = () => setUnit(unit === "USD" ? "ETH" : "USD");

  return <Ctx.Provider value={{ unit, setUnit, toggle }}>{children}</Ctx.Provider>;
}

/** The viewer's chosen display unit + setters. Defaults to USD outside a provider. */
export function useDisplayUnit(): DisplayUnitCtx {
  return useContext(Ctx);
}
