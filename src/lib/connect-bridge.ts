/**
 * Wallet session bridge — any surface can ask for connect / sign out without
 * importing the wallet SDK. The wallet layer mounted by WalletConnect.tsx
 * listens for these events and owns the actual session change.
 */
export const CONNECT_EVENT = "conviction:open-connect";
export const DISCONNECT_EVENT = "conviction:sign-out";

// The wallet UI layer mounts just after first paint, so a very early click can
// fire before anyone is listening. Remember that intent and let the listener
// claim it the moment it mounts.
let pendingConnect = false;

/**
 * A WALLET SESSION IS NEVER RESTORED WITHOUT INTENT.
 *
 * wagmi's `reconnect()` used to run unconditionally once the real connectors
 * loaded, so every visitor's wallet was woken on every page load — before they
 * had chosen a market, entered an amount, or asked for anything. That is a
 * silent session restore, and on some wallets it surfaces a prompt, for a
 * reader who came to look at questions.
 *
 * The rule is now: the wallet is touched only when the reader is doing
 * something that needs it. This flag is the gate, and it is set only by
 * `requestConnect` — which is called from the trade confirm, the create flow,
 * and an explicit tap on a Connect control. Never on load.
 *
 * A returning reader therefore taps once before their positions appear. That is
 * the intended cost: browsing is anonymous, and the wallet is a thing you reach
 * for when you are about to commit, not a toll on arrival.
 */
let connectIntended = false;

export function hasConnectIntent(): boolean {
  return connectIntended;
}

export function requestConnect() {
  if (typeof window === "undefined") return;
  pendingConnect = true;
  connectIntended = true;
  window.dispatchEvent(new Event(CONNECT_EVENT));
}

/** Consume a connect intent that was requested before the listener existed. */
export function takePendingConnect(): boolean {
  const p = pendingConnect;
  pendingConnect = false;
  return p;
}

/** Clear the intent once it has been handled by a mounted listener. */
export function clearPendingConnect() {
  pendingConnect = false;
}

export function requestDisconnect() {
  if (typeof window === "undefined") return;
  // Signing out withdraws the intent too, or the next connector swap would
  // silently restore the session the reader just ended.
  connectIntended = false;
  window.dispatchEvent(new Event(DISCONNECT_EVENT));
}

/**
 * Remove the URL identity that can otherwise keep the account rail rendered
 * after wagmi has disconnected. Returns true when navigation started.
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

/**
 * Ask the connected provider (Coinbase, MetaMask, …) to reopen its own account
 * picker so the user can choose which of their wallets/accounts this app uses.
 */
export const SWITCH_ACCOUNT_EVENT = "conviction:switch-account";

export function requestSwitchAccount() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SWITCH_ACCOUNT_EVENT));
}
