import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  WagmiProvider,
  useAccount,
  useConfig,
  useConnect,
  useDisconnect,
  useReconnect,
} from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { base } from "wagmi/chains";
import {
  wagmiConfig,
  lazyConnector,
  prefetchWalletSdks,
  ensureInjectedConnector,
  LAZY_COINBASE_ID,
  LAZY_WALLETCONNECT_ID,
  type LazyWalletKind,
} from "@/lib/wagmi";

import { WalletLogo, brandFor } from "@/components/WalletLogos";
import { CONNECT_EVENT, requestConnect } from "@/lib/connect-bridge";
import { lookupPovUser } from "@/lib/pov-user.functions";
import { getWalletLink } from "@/lib/wallet-link.functions";
import { readLocalLink } from "@/lib/wallet-link";


// Isolated query client for wagmi to avoid interfering with the app's router-level client.
const wagmiQueryClient = new QueryClient();

export function WalletProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={wagmiQueryClient}>
        {children}
        <PovOnConnect />
        <WalletModalHost />
        <LazyReconnect />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/**
 * Returning Coinbase / WalletConnect users: their connector isn't in the eager
 * config (kept light for first load), so wagmi's own reconnectOnMount can't restore
 * them. On idle, if the last session used one of those, lazily load it and reconnect
 * — no auto-reconnect regression, and the SDK still stays off the first-paint path.
 * Injected wallets reconnect through wagmi's built-in path with no help needed.
 */
function LazyReconnect() {
  const config = useConfig();
  const { reconnect } = useReconnect();
  useEffect(() => {
    let cancelled = false;
    // Register the injected connector right away (it's kept out of the SSR graph,
    // so wagmi's own reconnectOnMount can't see it at provider mount).
    void ensureInjectedConnector().then(() => {
      if (!cancelled) reconnect();
    });
    const run = async () => {
      try {
        const recent = (await config.storage?.getItem("recentConnectorId")) as string | undefined;
        if (cancelled || !recent) return;
        const kind: LazyWalletKind | null =
          recent === LAZY_COINBASE_ID
            ? "coinbase"
            : recent === LAZY_WALLETCONNECT_ID
              ? "walletConnect"
              : null;
        if (!kind) return;
        const connector = await lazyConnector(kind);
        if (!cancelled) reconnect({ connectors: [connector] });
      } catch {
        /* best effort */
      }
    };
    const ric =
      (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
        .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 400));
    ric(() => void run());
    return () => {
      cancelled = true;
    };
  }, [config, reconnect]);

  return null;
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

/** A connect option whose wallet SDK is imported on click, not on first load. */
function LazyWalletButton({
  label,
  note,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  note: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[58px] items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
    >
      <WalletLogo brand={brandFor(label)} alt="" />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {loading ? "Loading…" : note}
        </span>
      </span>
    </button>
  );
}

function walletName(name: string, id: string) {
  const v = `${id} ${name}`.toLowerCase();
  if (v.includes("coinbase")) return "Coinbase Wallet";
  if (v.includes("meta")) return "MetaMask";
  if (v.includes("walletconnect")) return "WalletConnect";
  if (v.includes("injected")) return "Browser wallet";
  return name;
}

function walletNote(id: string, name: string) {
  const v = `${id} ${name}`.toLowerCase();
  if (v.includes("coinbase")) return "Smart Wallet or Coinbase app";
  if (v.includes("walletconnect")) return "Scan or open any supported wallet";
  if (v.includes("injected") || v.includes("meta")) return "Use your installed browser wallet";
  return "Connect this wallet";
}

function WalletModalHost() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<LazyWalletKind | null>(null);
  const [lazyError, setLazyError] = useState<string | null>(null);
  const { isConnected } = useAccount();
  const { connectors, connectAsync, isPending, error } = useConnect();

  // Coinbase / WalletConnect load their SDK only on click, then connect on the fly.
  const lazyConnect = async (kind: LazyWalletKind) => {
    setPending(kind);
    setLazyError(null);
    try {
      if (kind === "coinbase" && isMobileWeb()) {
        // Mobile web: pair over WalletConnect and hand the URI to the Coinbase app,
        // so it comes back with a live session instead of just opening.
        const fn = await coinbaseMobileConnector();
        const connector = wagmiConfig._internal.connectors.setup(fn);
        const onMessage = ({ type, data }: { type: string; data?: unknown }) => {
          if (type === "display_uri" && typeof data === "string") {
            window.location.href = coinbaseDeepLink(data);
          }
        };
        connector.emitter.on("message", onMessage);
        try {
          await connectAsync({ connector, chainId: base.id });
        } finally {
          connector.emitter.off("message", onMessage);
        }
        setOpen(false);
        return;
      }
      const connector = await lazyConnector(kind);
      await connectAsync({ connector, chainId: base.id });
      setOpen(false);
    } catch (e) {
      setLazyError(e instanceof Error ? e.message : "Could not connect that wallet.");
    } finally {
      setPending(null);
    }
  };


  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      // Warm the wallet SDKs while the viewer reads the list, so the later tap
      // opens Coinbase/WalletConnect inside the gesture instead of after an await.
      prefetchWalletSdks();
    };
    window.addEventListener(CONNECT_EVENT, onOpen);
    return () => window.removeEventListener(CONNECT_EVENT, onOpen);
  }, []);


  useEffect(() => {
    if (isConnected) setOpen(false);
  }, [isConnected]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const visible = connectors.filter((connector, index, all) => {
    const name = walletName(connector.name, connector.id);
    return all.findIndex((other) => walletName(other.name, other.id) === name) === index;
  });
  // Only offer the lazy Coinbase button when an installed Coinbase extension
  // (discovered via EIP-6963) isn't already covering it.
  const hasInjectedCoinbase = visible.some((c) => walletName(c.name, c.id) === "Coinbase Wallet");
  const busy = isPending || pending != null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/70 px-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-connect-title"
        className="w-full max-w-[390px] overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <h2 id="wallet-connect-title" className="flex-1 text-center text-base font-semibold">
            Connect a Wallet
          </h2>
          <button
            type="button"
            aria-label="Close wallet connect"
            onClick={() => setOpen(false)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-2 p-3">
          {visible.map((connector) => (
            <button
              key={connector.uid}
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  await connectAsync({ connector, chainId: base.id });
                  setOpen(false);
                } catch {
                  /* wagmi exposes the error below */
                }
              }}
              className="flex min-h-[58px] items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
            >
              <WalletLogo
                brand={brandFor(connector.name, connector.id)}
                icon={typeof connector.icon === "string" ? connector.icon : undefined}
                alt=""
              />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {walletName(connector.name, connector.id)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {walletNote(connector.id, connector.name)}
                </span>
              </span>
            </button>
          ))}

          {/* Lazy wallets — their SDK loads only on click. */}
          {!hasInjectedCoinbase && (
            <LazyWalletButton
              label="Coinbase Wallet"
              note="Smart Wallet or Coinbase app"
              loading={pending === "coinbase"}
              disabled={busy}
              onClick={() => lazyConnect("coinbase")}
            />
          )}
          <LazyWalletButton
            label="WalletConnect"
            note="Scan or open any supported wallet"
            loading={pending === "walletConnect"}
            disabled={busy}
            onClick={() => lazyConnect("walletConnect")}
          />
        </div>

        <div className="border-t border-border px-5 py-3">
          {error || lazyError ? (
            <p className="text-xs leading-relaxed text-destructive">
              {lazyError ?? error?.message}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Choose the wallet you use to sign in. You can link a separate POV trading wallet
              after.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Client-only, dependency-light connect control. Opening the wallet modal goes
 * through the connect bridge so every account surface opens the same wallet picker.
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
