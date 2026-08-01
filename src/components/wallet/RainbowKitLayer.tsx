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
  const { address, isConnected } = useAccount();
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
    window.addEventListener(CONNECT_EVENT, onOpen);
    window.addEventListener(DISCONNECT_EVENT, onOut);
    // A click that landed before this layer mounted still opens the modal.
    if (!isConnected && takePendingConnect() && openConnectModal) openConnectModal();
    return () => {
      window.removeEventListener(CONNECT_EVENT, onOpen);
      window.removeEventListener(DISCONNECT_EVENT, onOut);
    };
  }, [openConnectModal, isConnected, address, disconnectAsync]);

  return null;
}
