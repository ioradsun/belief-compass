/**
 * Browser wallet connectors, built once, in the browser only.
 *
 * RainbowKit is the primary connect experience (best-in-class Coinbase and
 * MetaMask support, including mobile deep-links). Its wallet factories pull in
 * `wagmi/connectors`, which is stubbed outside the client build — so this module
 * must never construct anything during SSR.
 */
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import type { CreateConnectorFn } from "wagmi";

/** Optional — enables the WalletConnect-backed wallets (mobile MetaMask, QR). */
export const WALLETCONNECT_PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? "";

export function browserConnectors(): CreateConnectorFn[] {
  const wallets = [coinbaseWallet, metaMaskWallet, injectedWallet];
  if (WALLETCONNECT_PROJECT_ID) wallets.push(rainbowWallet, walletConnectWallet);

  return connectorsForWallets([{ groupName: "Connect", wallets }], {
    appName: "Conviction",
    appDescription: "Trade your convictions",
    appUrl: "https://conviction.company",
    // RainbowKit types require a string; WalletConnect-backed wallets are only
    // offered when a real id is configured.
    projectId: WALLETCONNECT_PROJECT_ID || "conviction",
  });
}
