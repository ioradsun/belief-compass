import { useEffect } from "react";
import { RainbowKitProvider, darkTheme, useConnectModal } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { CONNECT_EVENT } from "@/lib/connect-bridge";

/**
 * The ONLY place RainbowKit is imported. Loaded lazily (see WalletConnect.tsx)
 * so the modal UI never blocks first paint. It renders no visible chrome — it
 * just listens for the connect-bridge event and opens the modal.
 */
function ModalOpener() {
  const { openConnectModal } = useConnectModal();
  useEffect(() => {
    const onOpen = () => openConnectModal?.();
    window.addEventListener(CONNECT_EVENT, onOpen);
    return () => window.removeEventListener(CONNECT_EVENT, onOpen);
  }, [openConnectModal]);
  return null;
}

export default function WalletModalHost() {
  return (
    <RainbowKitProvider theme={darkTheme()} modalSize="compact">
      <ModalOpener />
    </RainbowKitProvider>
  );
}
