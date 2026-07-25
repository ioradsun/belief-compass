import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base } from "wagmi/chains";
import { http } from "wagmi";

// RainbowKit + wagmi config, Base only. Browser-only usage.
export const wagmiConfig = getDefaultConfig({
  appName: "Conviction",
  // Public demo project id; users can swap by setting VITE_WALLETCONNECT_PROJECT_ID.
  projectId:
    (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ??
    "3fbb6bba6f1de962d911bb5b5c9dd651",
  chains: [base],
  transports: {
    [base.id]: http(),
  },
  ssr: true,
});
