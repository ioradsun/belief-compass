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

/**
 * Remove the URL identity that can otherwise keep the account rail rendered
 * after wagmi/Privy has disconnected. Returns true when navigation started.
 */
export function clearDisconnectedWalletFromUrl(wallet?: string): boolean {
  if (typeof window === "undefined") return false;

  const url = new URL(window.location.href);
  const selectedWallet = url.searchParams.get("wallet");
  const selectedPerson = url.searchParams.get("p");
  const normalizedWallet = wallet?.toLowerCase();

  url.searchParams.delete("wallet");
  if (
    selectedPerson &&
    (selectedPerson.toLowerCase() === selectedWallet?.toLowerCase() ||
      selectedPerson.toLowerCase() === normalizedWallet)
  ) {
    url.searchParams.delete("p");
  }

  if (url.href === window.location.href) return false;
  window.location.replace(url.href);
  return true;
}
