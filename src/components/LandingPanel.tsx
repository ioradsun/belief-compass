import { useState, type ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { LandingExampleCard } from "@/components/LandingExample";
import { HowItWorksSheet } from "@/components/HowItWorksSheet";
import type { LandingPanelState } from "@/hooks/useLandingPanelState";

/**
 * One continuous brand component that changes shape between two states.
 *
 * The identity row (mark + wordmark + "Conviction needs company." + control) is
 * always mounted — expanding and collapsing only re-scales it and opens/closes
 * the region beneath, so the header is never swapped for a different component.
 * The live product stays mounted and interactive underneath at all times.
 *
 * When collapsed it also hosts the global search slot: search spans the whole
 * catalog, so it belongs in the app frame rather than inside the center column.
 */
export function LandingPanel({
  state,
  onEnter,
  onCollapse,
  onExpand,
  onCreate,
  search,
  profile,
}: {
  state: LandingPanelState;
  onEnter: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  /** Opens the market-creation flow in the center column. */
  onCreate?: () => void;
  /** Global search slot, shown only in the collapsed bar. */
  search?: ReactNode;
  /** The single account affordance — a profile icon, far right of the bar. */
  profile?: ReactNode;
}) {
  const expanded = state === "expanded";
  const [howOpen, setHowOpen] = useState(false);

  return (
    <header
      className="relative z-30 shrink-0 bg-[var(--panel)] transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      style={{ borderBottom: "1px solid var(--hairline)" }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse introduction" : "Expand introduction"}
        onClick={expanded ? onCollapse : onExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (expanded) onCollapse();
            else onExpand();
          }
        }}
        className={`mx-auto w-full max-w-[1180px] cursor-pointer px-4 transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none motion-reduce:transition-none lg:px-8 ${
          expanded ? "py-8 lg:py-12" : "py-2.5"
        }`}
      >
        {/* identity row — persists across both states */}
        <div className="flex items-center gap-4">
          <div
            className={`flex min-w-0 flex-1 items-center transition-[gap] duration-500 motion-reduce:transition-none ${
              expanded ? "gap-3" : "gap-2.5"
            }`}
          >
            <BrandMark
              size={expanded ? 40 : 22}
              className={`shrink-0 text-[var(--text)] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                expanded ? "" : "hidden lg:block"
              }`}
            />
            {!expanded && (
              <span className="hidden shrink-0 truncate text-[12px] text-[var(--text-secondary)] md:block">
                Conviction needs company.
              </span>
            )}

            {!expanded && search && (
              <div
                className="ml-auto flex min-w-0 flex-1 items-center lg:w-[344px] lg:max-w-[344px] lg:flex-none"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="presentation"
              >
                {search}
              </div>
            )}

            {!expanded && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreate?.();
                }}
                className="ml-auto hidden shrink-0 items-center gap-1 rounded-full bg-[var(--text)] px-3 py-1.5 text-[12px] font-medium text-[var(--bg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] motion-reduce:transition-none lg:inline-flex"
              >
                <span aria-hidden="true">+</span> Conviction Market
              </button>
            )}

            {!expanded && profile && (
              <div
                className={`shrink-0 ${onCreate ? "lg:ml-2" : "ml-auto"}`}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="presentation"
              >
                {profile}
              </div>
            )}
          </div>
        </div>

        {/* expanding region — same component, changing shape */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
            expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
          aria-hidden={!expanded}
        >
          <div className="overflow-hidden">
            <div className="pt-5 lg:pt-7">
              {/* hero — 55 / 45 on desktop, stacked on mobile */}
              <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] lg:gap-12">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                    Live belief markets
                  </div>

                  <h1 className="mt-3 max-w-[14ch] text-[38px] font-semibold leading-[1.02] tracking-[-0.03em] text-[var(--text)] sm:text-[52px] lg:text-[62px]">
                    Conviction needs company.
                  </h1>

                  <p className="mt-3 text-[19px] leading-snug text-[var(--text)] sm:text-[23px]">
                    Find your people. Back what you believe.
                  </p>

                  <p className="mt-3 max-w-[46ch] text-[15px] leading-relaxed text-[var(--text-secondary)] sm:text-[17px]">
                    Back YES or NO. When more capital backs your side, your position can grow.
                  </p>

                  <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
                    No expiry. No resolution. Sell whenever you choose.
                  </p>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEnter();
                      }}
                      tabIndex={expanded ? 0 : -1}
                      className="h-11 rounded-full bg-[var(--text)] px-6 text-[14px] font-medium text-[var(--bg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] motion-reduce:transition-none"
                    >
                      Enter Conviction
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHowOpen(true);
                      }}
                      tabIndex={expanded ? 0 : -1}
                      className="h-11 rounded-full px-5 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
                      style={{ border: "1px solid var(--hairline)" }}
                    >
                      See how it works
                    </button>
                  </div>
                </div>

                <div
                  className="flex min-w-0 justify-start lg:justify-end"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="presentation"
                >
                  <LandingExampleCard onEnter={onEnter} />
                </div>
              </div>

              {/* three-part explanation — text, not feature cards */}
              <div
                className="mt-6 grid gap-4 pt-5 sm:grid-cols-3 lg:mt-8"
                style={{ borderTop: "1px solid var(--hairline)" }}
              >
                {[
                  {
                    k: "Find your people",
                    v: "See who repeatedly backs the same beliefs you do.",
                  },
                  {
                    k: "Back your side",
                    v: "Choose YES or NO and take a position behind your conviction.",
                  },
                  {
                    k: "Benefit if it grows",
                    v: "Your position can grow when more capital backs your side.",
                  },
                ].map((b) => (
                  <div key={b.k} className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]">
                      {b.k}
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                      {b.v}
                    </p>
                  </div>
                ))}
              </div>

              {/* trust strip */}
              <div
                className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 pt-4 text-[12px] text-[var(--text-muted)] sm:flex sm:flex-wrap sm:items-center sm:gap-x-8"
                style={{ borderTop: "1px solid var(--hairline)" }}
              >
                <span>Built on Base</span>
                <span>Powered by POV</span>
                <span>Trades and pricing are onchain</span>
                <span>Fees shown before every trade</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {howOpen && <HowItWorksSheet onClose={() => setHowOpen(false)} />}
    </header>
  );
}

