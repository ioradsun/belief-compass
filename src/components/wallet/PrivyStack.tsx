/**
 * SECONDARY connect provider — Privy.
 *
 * Lazy-loaded (never part of the eager bundle) and only mounted when this
 * browser opted into it. Privy owns its own session, so it must wrap the app's
 * wagmi provider; that is why the two providers are alternatives, not layers.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { WagmiProvider, useSetActiveWallet } from "@privy-io/wagmi";
import { useDisconnect } from "wagmi";
import { base } from "wagmi/chains";
import { wagmiConfig, PRIVY_APP_ID } from "@/lib/wagmi";
import { CONNECT_EVENT, DISCONNECT_EVENT } from "@/lib/connect-bridge";
import { PovOnConnect } from "@/components/wallet/PovOnConnect";

export default function PrivyStack({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#5b8cff",
          walletList: [
            "coinbase_wallet",
            "metamask",
            "rainbow",
            "wallet_connect",
            "detected_wallets",
          ],
          walletChainType: "ethereum-only",
        },
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        {children}
        <ActiveWalletSync />
        <PovOnConnect />
        <PrivyBridge />
      </WagmiProvider>
    </PrivyProvider>
  );
}

/**
 * Single owner of session changes for the Privy path: connect and sign out both
 * go through here so Privy (which holds the real session) and wagmi never drift.
 */
function PrivyBridge() {
  const { ready, authenticated, login, logout, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const { disconnect } = useDisconnect();
  const hasWallet = wallets.length > 0;
  const wanted = useRef(false);
  const exiting = useRef(false);

  useEffect(() => {
    const onOpen = () => {
      if (exiting.current) return;
      if (!ready) {
        wanted.current = true; // retry as soon as Privy finishes booting
        return;
      }
      if (!authenticated) return void login();
      if (!hasWallet) return void connectWallet();
    };
    const onOut = async () => {
      wanted.current = false;
      if (exiting.current) return;
      exiting.current = true;
      try {
        await logout();
      } finally {
        try {
          disconnect();
        } catch {
          /* wagmi may already be disconnected */
        }
        exiting.current = false;
      }
    };
    window.addEventListener(CONNECT_EVENT, onOpen);
    window.addEventListener(DISCONNECT_EVENT, onOut);
    return () => {
      window.removeEventListener(CONNECT_EVENT, onOpen);
      window.removeEventListener(DISCONNECT_EVENT, onOut);
    };
  }, [ready, authenticated, hasWallet, login, logout, connectWallet, disconnect]);

  // A click that landed before Privy was ready still opens the modal.
  useEffect(() => {
    if (!ready || !wanted.current) return;
    wanted.current = false;
    if (!authenticated) void login();
    else if (!hasWallet) void connectWallet();
  }, [ready, authenticated, hasWallet, login, connectWallet]);

  return null;
}

/** Mirror Privy's connected wallet into wagmi so hooks see an account. */
function ActiveWalletSync() {
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const first = wallets[0];
  useEffect(() => {
    if (first) void setActiveWallet(first).catch(() => null);
  }, [first, setActiveWallet]);
  return null;
}
