import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
  injectedWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { base } from "wagmi/chains";
import { createConfig, http } from "wagmi";

const projectId =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ??
  "3fbb6bba6f1de962d911bb5b5c9dd651";

// Prefer deep-link / extension over the popup-based smart-wallet flow, since
// popups are blocked inside the Lovable preview iframe (especially on mobile).
coinbaseWallet.preference = "all";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      wallets: [coinbaseWallet, metaMaskWallet, rainbowWallet, walletConnectWallet, injectedWallet],
    },
  ],
  { appName: "Conviction", projectId },
);


export const wagmiConfig = createConfig({
  chains: [base],
  connectors,
  transports: { [base.id]: http() },
  ssr: true,
});
