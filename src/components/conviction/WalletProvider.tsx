/**
 * Wallet identity for the Conviction shell.
 *
 * There is no separate account system: POV is keyed by on-chain address, so the
 * connected Base address IS the identity and the key into wallet_beliefs.
 * Connecting therefore personalises everything immediately — no linking step.
 *
 * ONE ADDRESS RULE: the address we query is the address we trade from. We read
 * the connected account from wagmi and use that same account for the write, so
 * a conviction graph can never be keyed to a different address than the signer.
 * Base Account (smart account) and EOAs are both supported, but only ever one
 * connected address at a time — we never merge or substitute another address.
 */
import { type ReactNode, createContext, useContext } from "react";
import { WagmiProvider, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, useConnectModal } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "@/lib/wagmi";

const walletQueryClient = new QueryClient();

export function ConvictionWalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={walletQueryClient}>
        <RainbowKitProvider theme={darkTheme()} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

type WalletCtx = { address: string | null; connect: () => void; connecting: boolean };
const Ctx = createContext<WalletCtx>({ address: null, connect: () => {}, connecting: false });

export function WalletBridge({ children }: { children: ReactNode }) {
  const { address, isConnecting } = useAccount();
  const { openConnectModal } = useConnectModal();
  return (
    <Ctx.Provider
      value={{
        address: address ? address.toLowerCase() : null,
        connect: () => openConnectModal?.(),
        connecting: isConnecting,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  return useContext(Ctx);
}
