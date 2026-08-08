import { useState, type ReactNode } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { BrandMark } from "@/components/BrandMark";
import { OmniHeader } from "@/components/OmniHeader";
import { ProfileMenu } from "@/components/ProfileMenu";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { requestConnect } from "@/lib/connect-bridge";
import { walletIntent } from "@/lib/wagmi";

/** The standing pages, same list and order as the phone menu on the feed. */
const PAGES: { to: string; label: string; sub: string }[] = [
  { to: "/how", label: "How it works", sub: "the idea, in plain language" },
  { to: "/value", label: "Why it matters", sub: "what this adds to the ecosystem" },
  { to: "/terms", label: "Terms & risk", sub: "what you're agreeing to" },
];

/**
 * ONE HEADER EVERYWHERE. The standing reading pages (How it works, Why it
 * matters, Terms & risk) wear the same top bar as the app: menu icon on the
 * left, global search, the primary action and the account affordance. No
 * page-specific "✕ Close" pill — leaving is the menu's job, exactly as it is
 * on the feed.
 */
export function InfoPageHeader({ label, children }: { label: string; children?: ReactNode }) {
  const router = useRouter();
  const navigate = useNavigate();
  const wallet = useEffectiveWallet(undefined);
  const [menuOpen, setMenuOpen] = useState(false);

  const here = router.state.location.pathname;

  const goHome = (search?: Record<string, unknown>) => {
    setMenuOpen(false);
    navigate({ to: "/", search: (search ?? {}) as never });
  };

  return (
    <>
      <header
        className="sticky top-0 z-30 w-full bg-[var(--panel)]/95 backdrop-blur"
        style={{ borderBottom: "1px solid var(--hairline)" }}
      >
        <div className="mx-auto flex w-full max-w-[1180px] items-center gap-2.5 px-4 py-2.5 lg:px-8">
          <button
            type="button"
            aria-label="Expand introduction"
            onClick={() => goHome()}
            className="-ml-1 hidden shrink-0 items-center rounded-full p-1 text-[var(--text)] transition-opacity hover:opacity-80 lg:flex"
          >
            <BrandMark size={22} className="shrink-0" />
          </button>
          <span className="hidden shrink-0 truncate text-[12px] text-[var(--text-secondary)] md:block">
            · {label}
          </span>

          <div className="ml-auto flex min-w-0 flex-1 items-center lg:w-[344px] lg:max-w-[344px] lg:flex-none">
            <OmniHeader
              wallet={wallet}
              onSelectMarket={(id) => goHome({ m: id })}
              onSelectPerson={(w) => goHome({ p: w })}
              onOpenMenu={() => setMenuOpen(true)}
              center={
                wallet ? (
                  <button
                    type="button"
                    onClick={() => goHome({ create: true })}
                    className="inline-flex h-9 max-w-full items-center gap-1 truncate rounded-full border border-[var(--border-strong)] px-4 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
                  >
                    <span aria-hidden="true">+</span> Conviction
                  </button>
                ) : (
                  <button
                    type="button"
                    {...walletIntent}
                    onClick={() => requestConnect()}
                    className="inline-flex h-9 max-w-full items-center gap-1 truncate rounded-full border border-[var(--border-strong)] px-4 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
                  >
                    Connect wallet
                  </button>
                )
              }
            />
          </div>

          {/* Desktop primary action, same place and shape as the feed's bar. */}
          <button
            type="button"
            {...(wallet ? {} : walletIntent)}
            onClick={() => (wallet ? goHome({ create: true }) : requestConnect())}
            className="ml-auto hidden shrink-0 items-center gap-1 rounded-full bg-[var(--text)] px-3 py-1.5 text-[12px] font-medium text-[var(--bg)] transition-opacity hover:opacity-90 lg:inline-flex"
          >
            {wallet && <span aria-hidden="true">+</span>}{" "}
            {wallet ? "Conviction Market" : "Connect wallet"}
          </button>

          {wallet ? (
            <div className="shrink-0 lg:ml-2">
              <ProfileMenu
                wallet={wallet}
                onViewProfile={(w) => goHome({ p: w })}
                onOpenTerms={() => {
                  setMenuOpen(false);
                  navigate({ to: "/terms" });
                }}
                onOpenDashboard={() => goHome({ dash: true })}
                ethUsd={0}
              />
            </div>
          ) : null}
        </div>
        {children}
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div
            className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-[var(--panel)] p-4"
            style={{ borderRight: "1px solid var(--hairline)" }}
          >
            <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Menu
            </div>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => goHome()}
                className="flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--text)]">
                    Back to Conviction
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                    the live feed
                  </span>
                </span>
              </button>

              {PAGES.map((p) => {
                const current = here === p.to;
                return (
                  <a
                    key={p.to}
                    href={p.to}
                    onClick={() => setMenuOpen(false)}
                    aria-current={current ? "page" : undefined}
                    className={`flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left ${
                      current ? "bg-[var(--surface)]" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm font-medium ${current ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}
                      >
                        {p.label}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                        {p.sub}
                      </span>
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
