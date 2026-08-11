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

/**
 * SIGN OUT DOES NOT DEPEND ON THE WALLET LAYER BEING AWAKE.
 *
 * The RainbowKit layer only mounts once someone has asked to connect in this
 * tab. A reader who arrived with a session already restored (URL wallet or a
 * stored wallet session) has no listener at all, so dispatching the event and
 * hoping was a no-op — Sign Out did nothing. We still fire the event, so a
 * mounted wallet layer can drop the connector properly, and then perform the
 * reset ourselves regardless. Whichever reload lands first wins; the second is
 * discarded by the navigation.
 */
export function requestDisconnect(wallet?: string) {
  if (typeof window === "undefined") return;
  // Signing out withdraws the intent too, or the next connector swap would
  // silently restore the session the reader just ended.
  connectIntended = false;
  window.dispatchEvent(new Event(DISCONNECT_EVENT));
  // A short beat for wagmi's async disconnect; the storage purge below removes
  // its persisted state either way.
  window.setTimeout(() => clearDisconnectedWalletFromUrl(wallet), 150);
}


/**
 * SIGN OUT IS A FULL RESET.
 *
 * Disconnecting the wallet is not enough: the reader's positions, profile,
 * challenge counts and persisted query cache are all keyed to the wallet that
 * just left. We drop every browser-held trace of that identity, strip the
 * identity out of the URL, and reload — so what paints next is genuinely the
 * signed-out app, not a shell still hydrated from the previous session.
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
  // Anything that only makes sense for a signed-in reader.
  for (const k of ["dash", "create"]) url.searchParams.delete(k);

  clearIdentityStorage();
  window.location.replace(url.href);
  return true;
}

/** Forget wallet sessions, wallet links, connector state and cached data. */
function clearIdentityStorage() {
  const doomed = (k: string) =>
    k.startsWith("conviction:wallet-session:") ||
    k.startsWith("conviction:linked-wallet:") ||
    k.startsWith("conviction:qcache") ||
    k.startsWith("wagmi") ||
    k.startsWith("rk-") ||
    k.startsWith("wc@") ||
    k.startsWith("walletconnect") ||
    k.startsWith("-walletlink") ||
    k.startsWith("WALLETCONNECT");
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && doomed(k)) keys.push(k);
      }
      for (const k of keys) store.removeItem(k);
    } catch {
      /* storage unavailable — the reload still clears in-memory state */
    }
  }
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
