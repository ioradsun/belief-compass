/**
 * Perf: RainbowKit (modal UI + styles, ~hundreds of KB) is loaded lazily in ONE
 * island. Anything that wants to open the wallet modal fires this event instead
 * of importing RainbowKit, which keeps it out of the critical bundle.
 */
export const CONNECT_EVENT = "conviction:open-connect";

export function requestConnect() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CONNECT_EVENT));
}
