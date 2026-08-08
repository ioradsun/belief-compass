/**
 * The RainbowKit UI layer — provider, connect modal, wallet artwork and its
 * stylesheet. None of it is needed to paint the app, and most visitors never
 * open it, so it lives in its own chunk and mounts just after first paint.
 *
 * It renders no app children: the tree above stays mounted and interactive
 * while this loads. Only the connect/disconnect bridge lives inside it.
 */
import { useEffect } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { RainbowKitProvider, darkTheme, useConnectModal } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

import {
  CONNECT_EVENT,
  DISCONNECT_EVENT,
  SWITCH_ACCOUNT_EVENT,
  clearDisconnectedWalletFromUrl,
  takePendingConnect,
} from "@/lib/connect-bridge";
import { PovOnConnect } from "@/components/wallet/PovOnConnect";

const theme = darkTheme({ accentColor: "#5b8cff", borderRadius: "medium" });

export default function RainbowKitLayer() {
  return (
    <RainbowKitProvider modalSize="compact" theme={theme}>
      <PovOnConnect />
      <RainbowKitBridge />
    </RainbowKitProvider>
  );
}

/**
 * Single owner of session changes for the RainbowKit path: any surface can ask
 * for connect / sign out through the bridge events without importing wallet UI.
 */
function RainbowKitBridge() {
  const { openConnectModal } = useConnectModal();
  const { address, isConnected, connector } = useAccount();
  const { disconnectAsync } = useDisconnect();

  useEffect(() => {
    const onOpen = () => {
      if (isConnected) return;
      openConnectModal?.();
    };
    const onOut = async () => {
      try {
        await disconnectAsync();
      } catch {
        /* already disconnected */
      }
      clearDisconnectedWalletFromUrl(address);
    };
    /**
     * Account switching lives in the wallet, not in us: ask the connected
     * provider to re-prompt for `eth_accounts` permission, which is what opens
     * Coinbase's / MetaMask's own account picker. wagmi then picks up the new
     * active account through `accountsChanged`. Providers that don't implement
     * the permission RPC fall back to a full reconnect.
     */
    const onSwitch = async () => {
      if (!isConnected) {
        openConnectModal?.();
        return;
      }
      try {
        const provider = (await connector?.getProvider?.()) as
          | { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
          | undefined;
        if (!provider?.request) throw new Error("no provider");
        await provider.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch (err) {
        const rejected = /reject|denied|4001/i.test(String((err as Error)?.message ?? err));
        if (rejected) return;
        try {
          await disconnectAsync();
        } catch {
          /* ignore */
        }
        openConnectModal?.();
      }
    };
    window.addEventListener(CONNECT_EVENT, onOpen);
    window.addEventListener(DISCONNECT_EVENT, onOut);
    window.addEventListener(SWITCH_ACCOUNT_EVENT, onSwitch);
    // A click that landed before this layer mounted still opens the modal.
    if (!isConnected && takePendingConnect() && openConnectModal) openConnectModal();
    return () => {
      window.removeEventListener(CONNECT_EVENT, onOpen);
      window.removeEventListener(DISCONNECT_EVENT, onOut);
      window.removeEventListener(SWITCH_ACCOUNT_EVENT, onSwitch);
    };
  }, [openConnectModal, isConnected, address, disconnectAsync, connector]);

  return null;
}
