/**
 * Wallet session bridge — any surface can ask for connect / sign out without
 * importing the wallet SDK. The single Privy-aware island in WalletConnect.tsx
 * listens for these events and owns the actual session change.
 */
export const CONNECT_EVENT = "conviction:open-connect";
export const DISCONNECT_EVENT = "conviction:sign-out";

export function requestConnect() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CONNECT_EVENT));
}

export function requestDisconnect() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DISCONNECT_EVENT));
}
