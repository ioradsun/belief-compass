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
import { useMoney } from "@/lib/display-unit";
import { formatUsdPrice } from "@/domain/money";
import { setTheme, useTheme } from "@/lib/theme";
import { useFeedSensitivity, setFeedSensitivity } from "@/lib/feed-sensitivity";
import { SENSITIVITY_ORDER, type Sensitivity } from "@/domain/market-change";

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
              <div className="grid min-h-[180px] place-items-center text-[12px] text-[var(--text-muted)]">
                …
              </div>
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
            <SettingsPanel onOpenTerms={onOpenTerms} onClose={() => setPanel(null)} />
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

const Divider = () => <div className="my-1" style={{ borderTop: "1px solid var(--hairline)" }} />;

/**
 * A quiet centered modal for the occasional deeper action.
 *
 * It is PORTALLED to <body>. Rendered in place it lived inside the header's
 * z-30 stacking context, so app surfaces painted over it and the lazy panels
 * appeared to flash and jump as they resolved. At the body it has one stacking
 * context, one position, and a reserved minimum height so a panel arriving from
 * its lazy chunk grows into space that was already there instead of re-centering
 * the dialog mid-open.
 */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Portals need a DOM target, which SSR doesn't have — mount after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div
        className="relative z-10 flex max-h-[85vh] min-h-[260px] w-full max-w-[420px] flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-2xl"
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
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
}


/** General preferences — kept short and honest: only what actually works today. */
function SettingsPanel({
  onOpenTerms,
  onClose,
}: {
  onOpenTerms?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-1">
      <ThemeSetting />
      <Divider />
      <CurrencySetting />
      <Divider />
      <SensitivitySetting />
      <Divider />

      <a
        href="/how"
        onClick={onClose}
        className="block w-full rounded-xl px-1 py-2 text-left text-[13px] text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
      >
        How Conviction Company works
      </a>
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
 * Currency toggle — one horizontal control that IS the rate: `1 ETH ↔ $3,421.18
 * USD`. ETH on the left, the live USD equivalent on the right, a quiet
 * bidirectional arrow between. Picking a side sets the app-wide display currency
 * (everything re-renders instantly). The USD figure is the ONE shared live rate
 * from the money context — never hardcoded — and a delayed rate shows a subtle
 * marker so a conversion is never silently made against a stale price.
 */
function CurrencySetting() {
  const { unit, setUnit, ethUsd, rateStale } = useMoney();
  const price = ethUsd != null ? formatUsdPrice(ethUsd) : null;
  const seg = (active: boolean) =>
    `flex-1 rounded-[8px] px-3 py-1.5 text-center text-[12px] font-semibold transition-colors ${
      active ? "bg-[var(--panel)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"
    }`;
  return (
    <div className="px-1 py-1.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[13px] text-[var(--text)]">Display currency</span>
        {rateStale && (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]"
            title="Live rate is delayed — showing the last known price"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--text-muted)" }}
              aria-hidden
            />
            rate delayed
          </span>
        )}
      </div>
      <div
        className="flex items-center rounded-[10px] p-0.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="radiogroup"
        aria-label="Display currency"
      >
        <button
          type="button"
          role="radio"
          aria-checked={unit === "ETH"}
          onClick={() => setUnit("ETH")}
          className={seg(unit === "ETH")}
        >
          1 ETH
        </button>
        <span className="num shrink-0 px-1.5 text-[13px] text-[var(--text-muted)]" aria-hidden>
          ↔
        </span>
        <button
          type="button"
          role="radio"
          aria-checked={unit === "USD"}
          onClick={() => setUnit("USD")}
          className={`num ${seg(unit === "USD")}`}
        >
          {price ? `${price} USD` : "USD"}
        </button>
      </div>
    </div>
  );
}

/**
 * HOW MUCH HAS TO HAPPEN before a market is worth putting in front of you.
 *
 * IT USED TO LIVE IN EXPLORE, at the top of the filter menu, beside topics and
 * network groups. It does not belong there: those say WHAT to discover and this
 * says how much movement counts as movement — a standing preference about the
 * engine, not a decision anyone makes while browsing. Explore now asks one
 * question and this sits with the other things you set once, next to currency
 * and theme.
 *
 * THE SAME STORE, NOT A COPY. `useFeedSensitivity` / `setFeedSensitivity` is a
 * persisted external store pinned to `globalThis` (see @/lib/feed-sensitivity);
 * this is a second READER of it, never a second source. Changing it here changes
 * the feed's query key, so the running order re-ranks exactly as it did when the
 * control was inside Explore.
 *
 * NO NUMBERS, deliberately — the same rule the old menu followed. A row in the
 * bar table sets a percentage, a dollar floor and a believer count at once, each
 * scaled again by the reader's window, so printing "5%" would be true of one of
 * them and misleading about the rest.
 */
function SensitivitySetting() {
  const current = useFeedSensitivity();
  return (
    <div className="px-1 py-1.5">
      <div className="mb-1.5 text-[13px] text-[var(--text)]">How much matters</div>
      <div
        className="flex items-center rounded-[10px] p-0.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="radiogroup"
        aria-label="How much matters"
      >
        {SENSITIVITY_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={current === s}
            onClick={() => setFeedSensitivity(s)}
            title={SENSITIVITY_HINT[s]}
            className={`flex-1 rounded-[8px] px-2 py-1.5 text-center text-[12px] font-semibold transition-colors ${
              current === s
                ? "bg-[var(--panel)] text-[var(--text)] shadow-sm"
                : "text-[var(--text-muted)]"
            }`}
          >
            {SENSITIVITY_LABEL[s]}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-muted)]">
        {SENSITIVITY_HINT[current]}
      </p>
    </div>
  );
}

/** The reader's words for each floor — never the engine's thresholds. */
const SENSITIVITY_LABEL: Record<Sensitivity, string> = {
  everything: "Everything",
  notable: "Notable",
  major: "Major only",
};
const SENSITIVITY_HINT: Record<Sensitivity, string> = {
  everything: "Every move, however small.",
  notable: "Skip the small stuff.",
  major: "Just the big moves.",
};

/**
 * Appearance — one segmented control, same shape as the currency toggle. Dark is
 * the product's default; Light is a bright, high-contrast reading surface. The
 * choice applies instantly (a class on <html>) and is remembered next visit.
 */
function ThemeSetting() {
  const theme = useTheme();
  const seg = (active: boolean) =>
    `flex-1 rounded-[8px] px-3 py-1.5 text-center text-[12px] font-semibold transition-colors ${
      active ? "bg-[var(--panel)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"
    }`;
  return (
    <div className="px-1 py-1.5">
      <div className="mb-1.5 text-[13px] text-[var(--text)]">Appearance</div>
      <div
        className="flex items-center rounded-[10px] p-0.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="radiogroup"
        aria-label="Appearance"
      >
        <button
          type="button"
          role="radio"
          aria-checked={theme === "dark"}
          onClick={() => setTheme("dark")}
          className={seg(theme === "dark")}
        >
          Dark
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={theme === "light"}
          onClick={() => setTheme("light")}
          className={seg(theme === "light")}
        >
          Light
        </button>
      </div>
    </div>
  );
}
