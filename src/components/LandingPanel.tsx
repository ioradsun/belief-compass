import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  createLabel = "Conviction Market",
  showCreatePlus = true,
  search,
  profile,
}: {
  state: LandingPanelState;
  onEnter: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  /** Opens the market-creation flow in the center column. */
  onCreate?: () => void;
  /** Label for the bar's primary action (e.g. "Connect wallet" when signed out). */
  createLabel?: string;
  /** Hide the leading "+" when the action is not a create action. */
  showCreatePlus?: boolean;
  /** Global search slot, shown only in the collapsed bar. */
  search?: ReactNode;
  /** The single account affordance — a profile icon, far right of the bar. */
  profile?: ReactNode;
}) {
  const expanded = state === "expanded";
  const [howOpen, setHowOpen] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);


  return (
    <header
      className={`relative z-30 shrink-0 bg-[var(--panel)] transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        expanded ? "max-h-[100svh] overflow-y-auto overscroll-contain" : ""
      }`}
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
          expanded ? "py-4 lg:py-5" : "py-2.5"
        }`}
      >
        {/* identity row — persists across both states */}
        <div className="flex items-center gap-4">
          <div
            className={`flex min-w-0 flex-1 items-center transition-[gap] duration-500 motion-reduce:transition-none ${
              expanded ? "gap-3" : "gap-2.5"
            }`}
          >
            {expanded ? (
              <BrandMark
                size={40}
                className="shrink-0 text-[var(--text)] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              />
            ) : (
              <button
                type="button"
                aria-label="Expand introduction"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpand();
                }}
                className="-ml-1 hidden shrink-0 items-center rounded-full p-1 text-[var(--text)] transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] lg:flex"
              >
                <BrandMark size={22} className="shrink-0" />
              </button>
            )}
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
                {showCreatePlus && <span aria-hidden="true">+</span>} {createLabel}
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
            <div className="pt-4 lg:pt-7">
              {/* hero — 55 / 45 on desktop; on mobile one screen, no scroll */}
              <div className="grid min-h-[calc(100svh-190px)] content-center items-center gap-8 lg:min-h-0 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] lg:gap-12">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                    Live conviction markets
                  </div>

                  <h1 className="mt-3 max-w-[14ch] text-[40px] font-semibold leading-[1.02] tracking-[-0.03em] text-[var(--text)] sm:text-[52px] lg:text-[62px]">
                    Conviction needs company.
                  </h1>

                  <p className="mt-4 text-[19px] leading-snug text-[var(--text)] sm:text-[23px]">
                    Back what you believe.
                    <br />
                    Find your tribe.
                  </p>

                  <p className="mt-3 text-[15px] leading-snug text-[var(--text-secondary)] sm:text-[17px]">
                    Traders make money.
                    <br />
                    Conviction builds wealth.
                  </p>

                  <div className="mt-6 flex flex-col items-stretch gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEnter();
                      }}
                      tabIndex={expanded ? 0 : -1}
                      className="h-12 rounded-full bg-[var(--text)] px-6 text-[15px] font-medium text-[var(--bg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] motion-reduce:transition-none sm:h-11 sm:text-[14px]"
                    >
                      Enter Conviction Market
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExampleOpen(true);
                      }}
                      tabIndex={expanded ? 0 : -1}
                      className="h-12 rounded-full px-6 text-[15px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text)] lg:hidden"
                      style={{ border: "1px solid var(--hairline)" }}
                    >
                      See an example
                    </button>
                  </div>
                </div>

                <div
                  className="hidden min-w-0 justify-start lg:flex lg:justify-end"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="presentation"
                >
                  <LandingExampleCard onEnter={onEnter} />
                </div>
              </div>


              {/* trust strip — single tidy row on mobile, never overflowing */}
              <div
                className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-4 text-[11px] text-[var(--text-muted)] sm:text-[12px] lg:mt-8 lg:justify-start lg:gap-x-8 lg:gap-y-3"
                style={{ borderTop: "1px solid var(--hairline)" }}
              >

                <span className="inline-flex items-center gap-2">
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    aria-hidden="true"
                    className="shrink-0 opacity-80"
                    fill="currentColor"
                  >
                    <path d="M12 24c6.63 0 12-5.37 12-12S18.63 0 12 0C5.7 0 .54 4.86 0 11.04h15.88v1.92H0C.54 19.14 5.7 24 12 24z" />
                  </svg>
                  Built on Base
                </span>
                <span className="inline-flex items-center gap-2">
                  <img
                    src="/pov-mark.png"
                    alt=""
                    aria-hidden="true"
                    width={16}
                    height={16}
                    className="h-4 w-4 shrink-0 object-contain opacity-80 [.light_&]:invert"
                  />
                  Powered by POV and $degen
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHowOpen(true);
                  }}
                  tabIndex={expanded ? 0 : -1}
                  className="ml-auto hidden items-center gap-2 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] lg:inline-flex"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    aria-hidden="true"
                    className="shrink-0 opacity-80"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path
                      d="M9.6 9.2a2.5 2.5 0 1 1 3.2 2.4c-.6.2-.8.7-.8 1.3v.4"
                      strokeLinecap="round"
                    />
                    <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
                  </svg>
                  How it works
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {howOpen && <HowItWorksSheet onClose={() => setHowOpen(false)} />}
    </header>
  );
}
