import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
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
  search,
}: {
  state: LandingPanelState;
  onEnter: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  /** Global search slot, shown only in the collapsed bar. */
  search?: ReactNode;
}) {
  const expanded = state === "expanded";


  return (
    <header
      className="relative z-30 shrink-0 bg-[var(--panel)] transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      style={{ borderBottom: "1px solid var(--border)" }}
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
            expanded ? onCollapse() : onExpand();
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
              className="shrink-0 text-[var(--text)] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
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
              <span className="ml-auto hidden shrink-0 text-[11px] text-[var(--text-muted)] xl:block">
                Powered by pov.co and $DEGEN
              </span>
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
            <div className="pt-6 lg:pt-10">
              <h1 className="max-w-[18ch] text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--text)] sm:text-[46px] lg:text-[60px]">
                Conviction needs company.
              </h1>

              <div className="mt-5 space-y-1.5 text-[15px] leading-relaxed text-[var(--text-secondary)] sm:text-[17px]">
                <p>Put your money where your mouth is.</p>
                <p>Find your tribe. Beat your opps.</p>
              </div>

              <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEnter();
                  }}
                  tabIndex={expanded ? 0 : -1}
                  className="rounded-full bg-[var(--text)] px-6 py-3 text-[14px] font-medium text-[var(--bg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] motion-reduce:transition-none"
                >
                  Enter Conviction
                </button>
                <span className="text-[12px] text-[var(--text-muted)]">
                  Powered by pov.co and $DEGEN
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
