/**
 * Where the pending record is kept. The POLICY is in @/domain/pending-trade —
 * this is only storage, and it is best-effort: a blocked localStorage costs the
 * protection, never the trade.
 */
import { parsePending, type PendingTrade } from "@/domain/pending-trade";

const KEY = "conviction:pending-trade";

export function writePending(t: PendingTrade) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* storage unavailable */
  }
}

export function readPending(): PendingTrade | null {
  try {
    return parsePending(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/**
 * Cleared only on a RESOLVED outcome — a receipt, or a reader who has checked
 * their wallet and dismissed an unresolved record. Never on unmount, never on a
 * timer: a record that vanishes on its own re-creates the duplicate-submission
 * window it exists to close.
 */
export function clearPending() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
