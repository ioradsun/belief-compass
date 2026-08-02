/**
 * Currency — the ONE global money context: the viewer's unit preference, the ONE
 * shared live ETH/USD rate, and the ONE centralized formatter every surface uses.
 *
 *   • preference — USD or ETH, persisted; server + first client paint default to
 *     USD so the hydrated HTML matches, a stored ETH choice applies on the next
 *     frame (an effect), never during render.
 *   • rate — polled once here from calc_cache (getEthUsd), so no component fetches
 *     or hardcodes a rate; it auto-updates and carries its own freshness.
 *   • format(value, from) — closes over the unit + the shared rate, delegating to
 *     the pure `@/domain/money`. Stored values and calculations are untouched;
 *     this only decides how a number is shown.
 *
 * A missing rate never yields a silent conversion — ETH↔USD then renders "—" — and
 * an outdated rate is surfaced via `rateStale`.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatMoney, isRateStale, type DisplayUnit } from "@/domain/money";
import { getEthUsd } from "@/lib/markets.functions";

const KEY = "conviction:display-unit";

/** Format a value given its native unit, into the viewer's chosen display unit. */
export type MoneyFormat = (value: number, from: DisplayUnit, opts?: { signed?: boolean }) => string;

interface MoneyCtx {
  unit: DisplayUnit;
  setUnit: (u: DisplayUnit) => void;
  toggle: () => void;
  /** The one shared live rate, or null when unknown. */
  ethUsd: number | null;
  /** Epoch ms the rate was last refreshed, or null. */
  rateUpdatedAt: number | null;
  /** The rate is missing or too old to convert against silently. */
  rateStale: boolean;
  /** The one centralized formatter — unit + shared rate already applied. */
  format: MoneyFormat;
}

const Ctx = createContext<MoneyCtx>({
  unit: "USD",
  setUnit: () => {},
  toggle: () => {},
  ethUsd: null,
  rateUpdatedAt: null,
  rateStale: true,
  format: (v) => formatMoney(v, { from: "USD", to: "USD", ethUsd: 0 }),
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

  // The one shared rate — polled here so nothing downstream fetches or hardcodes it.
  const { data: rate } = useQuery({
    queryKey: ["eth-usd-rate"],
    queryFn: () => getEthUsd(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const ethUsd = rate?.rate ?? null;
  const rateUpdatedAt = rate?.updatedAt ? new Date(rate.updatedAt).getTime() : null;
  const rateStale = ethUsd == null || isRateStale(rateUpdatedAt, Date.now());

  const value = useMemo<MoneyCtx>(() => {
    const format: MoneyFormat = (v, from, opts) =>
      formatMoney(v, { from, to: unit, ethUsd: ethUsd ?? 0, signed: opts?.signed });
    return { unit, setUnit, toggle, ethUsd, rateUpdatedAt, rateStale, format };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, ethUsd, rateUpdatedAt, rateStale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The full money context: unit, shared rate, staleness, and the formatter. */
export function useMoney(): MoneyCtx {
  return useContext(Ctx);
}

/** The unit preference + setters (back-compat). Prefer useMoney() for formatting. */
export function useDisplayUnit(): Pick<MoneyCtx, "unit" | "setUnit" | "toggle"> {
  const { unit, setUnit, toggle } = useContext(Ctx);
  return { unit, setUnit, toggle };
}
