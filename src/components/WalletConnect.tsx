import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { WagmiProvider, useAccount, useDisconnect } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { wagmiConfig } from "@/lib/wagmi";
import { requestConnect } from "@/lib/connect-bridge";
import { lookupPovUser } from "@/lib/pov-user.functions";
import { getWalletLink } from "@/lib/wallet-link.functions";
import { readLocalLink } from "@/lib/wallet-link";

// Isolated query client for wagmi to avoid interfering with the app's router-level client.
const wagmiQueryClient = new QueryClient();

// Perf: RainbowKit's modal + stylesheet are a separate chunk, fetched only after
// the app is interactive (or immediately when the user asks to connect).
const WalletModalHost = lazy(() => import("./WalletModalHost"));

function LazyModalHost() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const idle =
      (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
        .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    const id = idle(() => setArmed(true));
    return () => {
      if (typeof id === "number") window.clearTimeout(id);
    };
  }, []);
  if (!armed) return null;
  return (
    <Suspense fallback={null}>
      <WalletModalHost />
    </Suspense>
  );
}

export function WalletProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={wagmiQueryClient}>
        {children}
        <PovOnConnect />
        <LazyModalHost />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/**
 * When a wallet connects, look up the POV profile and focus the home feed on
 * that wallet (the "You" panel). Runs once per new address per session.
 */
function PovOnConnect() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) return;
    if (handled.current === address) return;
    handled.current = address;
    // Redirect at most once per address per tab. Without this, pressing Back
    // remounts this component and immediately re-navigates forward again,
    // trapping the user on the wallet page.
    const key = `conviction:auto-nav:${address.toLowerCase()}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      /* storage unavailable — fall through and navigate once */
    }
    // Fire-and-forget lookup (cached by browser); focus the feed on this wallet.
    void lookupPovUser({ data: { wallet: address } }).catch(() => null);
    // If this login wallet is linked to a POV trading wallet, focus that instead.
    void (async () => {
      const local = readLocalLink(address);
      const linked =
        local ??
        (await getWalletLink({ data: { wallet: address.toLowerCase() } })
          .then((r) => r.linked)
          .catch(() => null));
      // The wallet view is the home "You" panel — point the feed at this wallet.
      // `replace` so the connect hop doesn't trap the back button in a loop.
      void navigate({
        to: "/",
        search: (prev: { wallet?: string; m?: number; p?: string; dna?: boolean }) => ({
          ...prev,
          wallet: linked ?? address,
        }),
        replace: true,
      });
    })();
  }, [address, isConnected, navigate]);

  return null;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Client-only, dependency-light connect control. Opening the wallet modal goes
 * through the connect bridge so RainbowKit stays in its lazy chunk.
 */
export function WalletConnectButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const cls =
    "rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent";

  if (!mounted) {
    return (
      <button type="button" disabled className={`${cls} text-muted-foreground`}>
        Connect wallet
      </button>
    );
  }
  if (isConnected && address) {
    return (
      <button type="button" className={cls} onClick={() => disconnect()} title="Disconnect">
        {short(address)}
      </button>
    );
  }
  return (
    <button type="button" className={cls} onClick={() => requestConnect()}>
      Connect wallet
    </button>
  );
}
