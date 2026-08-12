import { useState, type ReactNode } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { AppMenu, type AppTab } from "@/components/AppMenu";
import { BrandMark } from "@/components/BrandMark";
import { OmniHeader } from "@/components/OmniHeader";
import { ProfileMenu } from "@/components/ProfileMenu";
import { ShieldMark } from "@/components/ShieldMark";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { requestConnect } from "@/lib/connect-bridge";
import { walletIntent } from "@/lib/wagmi";

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
                <>
                  <ShieldMark onClick={() => navigate({ to: "/trust" })} />
                  {wallet ? (
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
                  )}
                </>
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
                onOpenTrust={() => {
                  setMenuOpen(false);
                  navigate({ to: "/trust" });
                }}
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

      <AppMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onHome={() => goHome()}
        onSelectTab={(t: AppTab) => goHome({ tab: t })}
        currentPath={here}
      />
    </>
  );
}
