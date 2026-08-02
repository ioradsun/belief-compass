/**
 * ProfileMenu — the single account affordance, in the global header.
 *
 * Account management is not the product; conviction is. So the whole account
 * lives behind one small profile icon in the top bar and never spends a pixel of
 * the page's vertical space. Tapping it opens a minimal menu that answers "who am
 * I?" — your name, your wallet, the network you're on — plus the few actions you
 * occasionally need: Edit Profile, Import POV Wallet, Settings, Sign Out. No
 * account switcher, no multiple profiles, no advanced wallet management.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { lazyRetry } from "@/lib/lazy-retry";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { lookupPovUser } from "@/lib/pov-user.functions";
import { getPersonProfile } from "@/lib/dna.functions";
import { getProfileOverride } from "@/lib/profile-edit.functions";
// The three account panels only exist behind a menu click, and each drags in
// its own contract/signing code. Keeping them out of the header's chunk keeps
// them off every first paint.
const ProfileEditor = lazyRetry(() =>
  import("@/components/ProfileEditor").then((m) => ({ default: m.ProfileEditor })),
);
const CreatorEarnings = lazyRetry(() =>
  import("@/components/CreatorEarnings").then((m) => ({ default: m.CreatorEarnings })),
);
const WalletIdentity = lazyRetry(() =>
  import("@/components/WalletIdentity").then((m) => ({ default: m.WalletIdentity })),
);
import { aliasFor, hueFor, initialsFor } from "@/lib/wallet-identity";
import { requestDisconnect, requestSwitchAccount } from "@/lib/connect-bridge";
import { useDisplayUnit } from "@/lib/display-unit";
import { formatRate, type DisplayUnit } from "@/domain/money";

/** Base is the one chain this app trades on. */
const NETWORK = "Base";
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

/** Never show a raw 0x address as a name — fall back to the neutral alias. */
function nameOf(candidates: (string | null | undefined)[], wallet: string) {
  for (const c of candidates) {
    const v = c?.trim();
    if (v && !/^0x[a-f0-9]{6,}/i.test(v)) return v;
  }
  return wallet ? aliasFor(wallet) : "";
}

type Panel = null | "edit" | "import" | "settings" | "earnings";

export function ProfileMenu({
  wallet,
  onViewProfile,
  onOpenTerms,
  onOpenDashboard,
  ethUsd = 0,
}: {
  /** The effective (POV / trading) wallet being represented. */
  wallet: string;
  /** Open the viewer's own profile in the center. */
  onViewProfile: (wallet: string) => void;
  /** Open Terms & risk in the center (the one privacy surface we have). */
  onOpenTerms?: () => void;
  /** Open the Conviction Dashboard in the center panel. */
  onOpenDashboard?: () => void;
  /** Live ETH price, so claimable fees can be shown in dollars too. */
  ethUsd?: number;
}) {
  const me = wallet.toLowerCase();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: pov } = useQuery({
    queryKey: ["pov-user", me],
    queryFn: async () => await lookupPovUser({ data: { wallet: me } }),
    enabled: Boolean(me),
    staleTime: 5 * 60_000,
  });
  const { data: profile } = useQuery({
    queryKey: ["person", me, "self-name"],
    queryFn: async () => await getPersonProfile({ data: { wallet: me } }),
    enabled: Boolean(me),
    staleTime: 5 * 60_000,
  });
  const { data: override } = useQuery({
    queryKey: ["profile-override", me],
    queryFn: async () => await getProfileOverride({ data: { wallet: me } }),
    enabled: Boolean(me),
    staleTime: 60_000,
  });

  const user = pov?.user ?? null;
  const name = nameOf(
    [override?.displayName, user?.username, user?.displayName, profile?.displayName],
    me,
  );
  const avatar = override?.avatarUrl ?? user?.pfpUrl ?? profile?.avatarUrl ?? null;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPanel((p) => (p ? null : p));
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const copyWallet = async () => {
    try {
      await navigator.clipboard.writeText(me);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      {/* The single profile icon. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        className="grid h-8 w-8 place-items-center overflow-hidden rounded-full transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]"
        style={avatar ? undefined : { background: `hsl(${hueFor(me)} 45% 45%)` }}
      >
        {avatar ? (
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[11px] font-semibold text-white" aria-hidden>
            {initialsFor(name)}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-xl"
        >
          {/* Who am I — name, wallet, network. */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onViewProfile(me);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--surface)]"
          >
            {avatar ? (
              <img src={avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : (
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white"
                style={{ background: `hsl(${hueFor(me)} 45% 45%)` }}
                aria-hidden
              >
                {initialsFor(name)}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--text)]">
              {name}
            </span>
          </button>

          {/* Tap the wallet to copy; the ↗ opens BaseScan. */}
          <div className="mx-1 mb-1 flex items-center gap-1 rounded-lg px-1">
            <button
              type="button"
              onClick={copyWallet}
              title="Copy address"
              className="num min-w-0 flex-1 truncate py-1 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
            >
              {copied ? "Copied ✓" : short(me)}
              <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">· {NETWORK}</span>
            </button>
            <a
              href={`https://basescan.org/address/${me}`}
              target="_blank"
              rel="noreferrer noopener"
              title="Open in BaseScan"
              aria-label="Open in BaseScan"
              className="shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>

          <Divider />
          {onOpenDashboard && (
            <Item
              label="Conviction Dashboard"
              onClick={() => {
                onOpenDashboard();
                setOpen(false);
              }}
            />
          )}
          <Item label="Edit Profile" onClick={() => setPanel("edit")} />
          <Item label="Creator Earnings" onClick={() => setPanel("earnings")} />
          <Item label="Import POV Wallet" onClick={() => setPanel("import")} />
          <Divider />
          <Item label="Settings" onClick={() => setPanel("settings")} />
          <Item
            label="Switch Wallet"
            onClick={() => {
              requestSwitchAccount();
              setOpen(false);
            }}
          />
          <Item
            label="Sign Out"
            muted
            onClick={() => {
              requestDisconnect();
              setOpen(false);
            }}
          />
        </div>
      )}

      {panel && (
        <Modal
          title={
            panel === "edit"
              ? "Edit Profile"
              : panel === "earnings"
                ? "Creator Earnings"
                : panel === "import"
                  ? "Import POV Wallet"
                  : "Settings"
          }
          onClose={() => setPanel(null)}
        >
          <Suspense
            fallback={
              <div className="py-6 text-center text-[12px] text-[var(--text-muted)]">…</div>
            }
          >
            {panel === "edit" && <ProfileEditor wallet={me} fallbackName={name} />}
            {panel === "earnings" && <CreatorEarnings ethUsd={ethUsd} />}
            {panel === "import" && (
              <>
                <p className="mb-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
                  Link the wallet you trade from so your conviction history comes with you.
                </p>
                <WalletIdentity viewing={me} compact />
              </>
            )}
          </Suspense>
          {panel === "settings" && (
            <SettingsPanel
              onOpenTerms={onOpenTerms}
              onClose={() => setPanel(null)}
              ethUsd={ethUsd}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function Item({ label, onClick, muted }: { label: string; onClick: () => void; muted?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full rounded-xl px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--surface)] ${
        muted ? "text-[var(--text-muted)] hover:text-[var(--text)]" : "text-[var(--text)]"
      }`}
    >
      {label}
    </button>
  );
}

const Divider = () => <div className="my-1" style={{ borderTop: "1px solid var(--border)" }} />;

/** A quiet centered modal for the occasional deeper action. */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div
        className="relative z-10 max-h-[85vh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[var(--text)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** General preferences — kept short and honest: only what actually works today. */
function SettingsPanel({
  onOpenTerms,
  onClose,
  ethUsd = 0,
}: {
  onOpenTerms?: () => void;
  onClose: () => void;
  ethUsd?: number;
}) {
  return (
    <div className="space-y-1">
      <CurrencySetting ethUsd={ethUsd} />
      <Divider />
      {onOpenTerms && (
        <button
          type="button"
          onClick={() => {
            onOpenTerms();
            onClose();
          }}
          className="block w-full rounded-xl px-1 py-2 text-left text-[13px] text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
        >
          Terms &amp; risk
        </button>
      )}
    </div>
  );
}

/**
 * Display currency — one universal switch. Every money figure in the app (worth,
 * cost, committed capital, volume, fees) reads this and converts through the one
 * live rate, so the viewer can see the whole product in USD or in ETH. The rate
 * in use is shown plainly beneath, so the conversion is never a black box.
 */
function CurrencySetting({ ethUsd }: { ethUsd: number }) {
  const { unit, setUnit } = useDisplayUnit();
  const rate = formatRate(ethUsd);
  const opts: DisplayUnit[] = ["USD", "ETH"];
  return (
    <div className="px-1 py-1.5">
      <div className="mb-1.5 text-[13px] text-[var(--text)]">Display currency</div>
      <div
        className="flex rounded-[10px] p-0.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="radiogroup"
        aria-label="Display currency"
      >
        {opts.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={unit === o}
            onClick={() => setUnit(o)}
            className={`flex-1 rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors ${
              unit === o ? "bg-[var(--bg)] text-[var(--text)]" : "text-[var(--text-muted)]"
            }`}
          >
            {o === "USD" ? "USD ($)" : "ETH (Ξ)"}
          </button>
        ))}
      </div>
      <div className="num mt-1.5 text-[11px] text-[var(--text-muted)]">
        {rate ?? "Live rate unavailable"}
      </div>
    </div>
  );
}
