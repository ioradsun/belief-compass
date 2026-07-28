import { base } from "wagmi/chains";
import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { injected } from "wagmi/connectors";

const projectId =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ??
  "3fbb6bba6f1de962d911bb5b5c9dd651";

/**
 * First-load perf: only `injected()` is eager. It carries no SDK weight and, with
 * wagmi's EIP-6963 discovery (default on), surfaces EVERY installed browser-extension
 * wallet (MetaMask, Coinbase extension, Rabby, Brave, …). The heavy Coinbase (~720KB)
 * and WalletConnect (~360KB) SDKs are imported ON DEMAND — only when the viewer picks
 * that wallet — via connect({ connector }), which wagmi sets up on the fly. Returning
 * Coinbase/WalletConnect users are reconnected on idle (see WalletProviders).
 */
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [injected()],
  transports: { [base.id]: http() },
  ssr: true,
});

/** wagmi connector ids for the lazily-loaded wallets (stored as recentConnectorId). */
export const LAZY_COINBASE_ID = "coinbaseWalletSDK";
export const LAZY_WALLETCONNECT_ID = "walletConnect";

export type LazyWalletKind = "coinbase" | "walletConnect";

/** Dynamically import a heavy connector's SDK and return its CreateConnectorFn. */
export async function lazyConnector(kind: LazyWalletKind): Promise<CreateConnectorFn> {
  const { coinbaseWallet, walletConnect } = await import("wagmi/connectors");
  return kind === "coinbase"
    ? coinbaseWallet({ appName: "Conviction", preference: "all" })
    : walletConnect({ projectId, showQrModal: false });
}
