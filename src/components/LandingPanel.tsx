import { BrandMark } from "@/components/BrandMark";
import type { LandingPanelState } from "@/hooks/useLandingPanelState";

/**
 * One continuous brand component that changes shape between two states.
 *
 * The identity row (mark + wordmark + "Conviction needs company." + control) is
 * always mounted — expanding and collapsing only re-scales it and opens/closes
 * the region beneath, so the header is never swapped for a different component.
 * The live product stays mounted and interactive underneath at all times.
 */
export function LandingPanel({
  state,
  onEnter,
  onCollapse,
  onExpand,
}: {
  state: LandingPanelState;
  onEnter: () => void;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  const expanded = state === "expanded";

  return (
    <header
      className="relative z-30 shrink-0 bg-[var(--panel)] transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <div
        className={`mx-auto w-full max-w-[1180px] px-4 transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:px-8 ${
          expanded ? "py-8 lg:py-12" : "py-2.5"
        }`}
      >
        {/* identity row — persists across both states */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <div
            className={`flex min-w-0 items-center transition-[gap] duration-500 motion-reduce:transition-none ${
              expanded ? "gap-3" : "gap-2.5"
            }`}
          >
            <BrandMark
              size={expanded ? 40 : 22}
              className="shrink-0 text-[var(--text)] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            />
            <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
              <span
                className={`truncate font-medium tracking-tight text-[var(--text)] transition-all duration-500 motion-reduce:transition-none ${
                  expanded ? "text-[15px]" : "text-[13px]"
                }`}
              >
                conviction.company
              </span>
              {!expanded && (
                <span className="truncate text-[12px] text-[var(--text-secondary)]">
                  Conviction needs company.
                </span>
              )}
            </div>
            {!expanded && (
              <span className="ml-auto hidden shrink-0 pr-3 text-[11px] text-[var(--text-muted)] xl:block">
                Powered by pov.co and $DEGEN
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={expanded ? onCollapse : onExpand}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse introduction" : "Expand introduction"}
            className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className={`transition-transform duration-500 motion-reduce:transition-none ${
                expanded ? "rotate-180" : ""
              }`}
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
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
                  onClick={onEnter}
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
