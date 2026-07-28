import { base } from "wagmi/chains";
import { createConfig, http } from "wagmi";
import { coinbaseWallet, metaMask, walletConnect, injected } from "wagmi/connectors";

const projectId =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ??
  "3fbb6bba6f1de962d911bb5b5c9dd651";

// Perf: connectors come straight from wagmi (not RainbowKit) so the wallet modal
// bundle stays out of the critical path. RainbowKit renders these fine.
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    // Prefer deep-link / extension over the popup-based smart-wallet flow, since
    // popups are blocked inside the Lovable preview iframe (especially on mobile).
    coinbaseWallet({ appName: "Conviction", preference: "all" }),
    metaMask(),
    walletConnect({ projectId, showQrModal: false }),
    injected(),
  ],
  transports: { [base.id]: http() },
  ssr: true,
});
