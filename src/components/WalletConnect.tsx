import { useEffect, useRef, useState, type ReactNode } from "react";
import { WagmiProvider, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, ConnectButton, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { useNavigate } from "@tanstack/react-router";
import { wagmiConfig } from "@/lib/wagmi";
import { lookupPovUser } from "@/lib/pov-user.functions";
import { getWalletLink } from "@/lib/wallet-link.functions";
import { readLocalLink } from "@/lib/wallet-link";


// Isolated query client for wagmi to avoid interfering with the app's router-level client.
const wagmiQueryClient = new QueryClient();

export function WalletProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={wagmiQueryClient}>
        <RainbowKitProvider theme={darkTheme()} modalSize="compact">
          {children}
          <PovOnConnect />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/**
 * When a wallet connects, look up the POV profile and navigate to
 * /wallet/{addr}. Runs once per new address per session.
 */
function PovOnConnect() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) return;
    if (handled.current === address) return;
    handled.current = address;
    // Fire-and-forget lookup (cached by browser); jump to wallet page regardless.
    void lookupPovUser({ data: { wallet: address } }).catch(() => null);
    // If this login wallet is linked to a POV trading wallet, land there instead.
    void (async () => {
      const local = readLocalLink(address);
      const linked =
        local ??
        (await getWalletLink({ data: { wallet: address.toLowerCase() } })
          .then((r) => r.linked)
          .catch(() => null));
      // `replace` so the connect hop doesn't trap the back button in a loop.
      void navigate({
        to: "/wallet/$addr",
        params: { addr: linked ?? address },
        replace: true,
      });
    })();
  }, [address, isConnected, navigate]);


  return null;
}

/** Client-only mount wrapper — avoids SSR mismatch from wallet-injected state. */
export function WalletConnectButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground"
      >
        Connect wallet
      </button>
    );
  }
  return <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />;
}
