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

const connectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      wallets: [
        // preference "all" lets Coinbase deep-link to the mobile app / extension
        // instead of only opening a popup (popups are blocked inside the
        // Lovable preview iframe on mobile).
        (opts) => coinbaseWallet({ ...opts, preference: "all" }),
        metaMaskWallet,
        rainbowWallet,
        walletConnectWallet,
        injectedWallet,
      ],
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
