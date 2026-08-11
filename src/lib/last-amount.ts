/**
 * THE AMOUNT A PERSON ACTUALLY TRADES, remembered.
 *
 * Most people size their bets the same way every time. Opening every ticket at
 * $1 makes them retype that decision on every market, which is a tax on the one
 * action the product exists for. So the last CONFIRMED amount becomes the next
 * default.
 *
 * CONFIRMED, not typed. A number half-entered and abandoned is not a decision;
 * remembering it would carry a mistake forward. Only a settled order writes.
 *
 * PER LEDGER. Simulation is denominated in CC and Real Mode in dollars — one
 * shared memory would put 100 CC into a dollar field. Two keys, no conversion.
 */
import { DEFAULT_ORDER_CC } from "@/domain/simulation";

const KEY = (sim: boolean) => (sim ? "conviction.lastAmount.sim" : "conviction.lastAmount.real");

/** The floor the ticket already enforces; a remembered value must respect it. */
const MIN_REAL = 1;

export function defaultAmount(sim: boolean): number {
  const fallback = sim ? DEFAULT_ORDER_CC : MIN_REAL;
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(KEY(sim));
    const n = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return sim ? n : Math.max(MIN_REAL, n);
  } catch {
    return fallback;
  }
}

export function rememberAmount(sim: boolean, amount: number) {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(amount) || amount <= 0) return;
  try {
    window.localStorage.setItem(KEY(sim), String(amount));
  } catch {
    /* storage unavailable — the default simply stays the default */
  }
}
