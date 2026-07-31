/**
 * MobileCase — the mobile Case File as a three-page horizontal carousel.
 *
 * One full-screen idea at a time, with the next physically waiting beside it:
 *
 *        NO CASE   ←   MARKET   →   YES CASE
 *
 * The market stays the default (center) page; the two competing cases sit just
 * off-screen and are reached by swiping. The spatial model matches the order
 * dock below — NO on the left, YES on the right — so a user never swipes left
 * for YES while tapping left for NO. Not two drawers, not a squeezed desktop.
 *
 * Presentation only: the side pages reuse CaseColumn (same query keys, no new
 * data), and the middle page is the exact neutral market content passed as
 * children. The shared order dock stays pinned below, unchanged.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CaseColumn } from "@/components/CaseFile";
import type { MarketRow } from "@/components/MarketCard";
import type { OrderSide } from "@/domain/order";

type Page = 0 | 1 | 2; // NO · MARKET · YES

export function MobileCaseView({
  title,
  marketId,
  row,
  viewerWallet,
  ethUsd,
  onClose,
  onBackSide,
  children,
}: {
  title: string;
  marketId: number;
  row: MarketRow;
  viewerWallet?: string;
  ethUsd: number;
  /** Close case mode → return to the neutral market page. */
  onClose: () => void;
  /** Pick a side from a case page (the dock below then confirms it). */
  onBackSide: (side: OrderSide) => void;
  /** The neutral market content — the middle page, unchanged. */
  children: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const pages = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState<Page>(1);

  // Start centered on MARKET without animation, before first paint.
  useEffect(() => {
    const el = pages.current[1];
    if (el) el.scrollIntoView({ block: "nearest", inline: "center" });
  }, []);

  const goTo = useCallback((p: Page) => {
    pages.current[p]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, []);

  // Track the nearest page to drive the indicator + edge state.
  const onScroll = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const mid = box.scrollLeft + box.clientWidth / 2;
    let best: Page = active;
    let bestDist = Infinity;
    ([0, 1, 2] as Page[]).forEach((i) => {
      const el = pages.current[i];
      if (!el) return;
      const center = el.offsetLeft + el.offsetWidth / 2;
      const d = Math.abs(center - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best !== active) setActive(best);
  }, [active]);

  // Escape returns to MARKET (or closes when already there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (active === 1) onClose();
      else goTo(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose, goTo]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pinned header: the question stays put; the close control and a tiny
        three-state indicator do the rest. No chunky segmented control. */}
      <div className="shrink-0 pb-2">
        <div className="mb-1.5 flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-[16px] font-semibold leading-tight tracking-tight text-[var(--text)]">
            {title}
          </h1>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-0.5 shrink-0 rounded-full px-2 py-1 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            aria-label="Close case"
          >
            <span aria-hidden>×</span> Case
          </button>
        </div>
        <Indicator active={active} onGo={goTo} />
      </div>

      {/* Horizontal snapping carousel. Pages peek at the edges (~6% each side) so
        the screen reads as navigable with no arrows or tabs. */}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:none]"
        style={{ scrollPaddingInline: "0" }}
      >
        <CasePage
          elRef={(el) => {
            pages.current[0] = el;
          }}
          side="NO"
          edge="left"
          dimmed={active !== 0}
        >
          <CaseColumn
            side="NO"
            marketId={marketId}
            row={row}
            viewerWallet={viewerWallet}
            ethUsd={ethUsd}
          />
          <SideAction side="NO" onBack={() => onBackSide("NO")} />
        </CasePage>

        <div
          ref={(el) => {
            pages.current[1] = el;
          }}
          className="min-h-0 w-[88%] shrink-0 snap-center touch-pan-y overflow-y-auto overscroll-contain pr-0.5"
        >
          {children}
        </div>

        <CasePage
          elRef={(el) => {
            pages.current[2] = el;
          }}
          side="YES"
          edge="right"
          dimmed={active !== 2}
        >
          <CaseColumn
            side="YES"
            marketId={marketId}
            row={row}
            viewerWallet={viewerWallet}
            ethUsd={ethUsd}
          />
          <SideAction side="YES" onBack={() => onBackSide("YES")} />
        </CasePage>
      </div>
    </div>
  );
}

/** A case page: full-height vertical scroll, with a thin side-colored edge. */
const CasePage = ({
  elRef,
  side,
  edge,
  dimmed,
  children,
}: {
  elRef: (el: HTMLDivElement | null) => void;
  side: "YES" | "NO";
  edge: "left" | "right";
  dimmed: boolean;
  children: React.ReactNode;
}) => {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  const border = `2px solid color-mix(in oklab, ${color} 55%, transparent)`;
  const edgeStyle: React.CSSProperties =
    edge === "left"
      ? { borderLeft: border, paddingLeft: "10px" }
      : { borderRight: border, paddingRight: "10px" };
  return (
    <div
      ref={elRef}
      className="flex min-h-0 w-[88%] shrink-0 snap-center touch-pan-y flex-col overflow-y-auto overscroll-contain transition-opacity duration-200 motion-reduce:transition-none"
      style={{ opacity: dimmed ? 0.72 : 1, ...edgeStyle }}
    >
      {children}
    </div>
  );
};

/** The side-specific action, pinned to the bottom of a case page. */
function SideAction({ side, onBack }: { side: "YES" | "NO"; onBack: () => void }) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  return (
    <button
      type="button"
      onClick={onBack}
      className="mt-3 shrink-0 rounded-[12px] py-2.5 text-[14px] font-semibold transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
      style={{ border: `1px solid ${color}`, color }}
    >
      Back {side}
    </button>
  );
}

/** NO CASE · MARKET · YES CASE — labels over three dots; each is tappable. */
function Indicator({ active, onGo }: { active: Page; onGo: (p: Page) => void }) {
  const items: { p: Page; label: string }[] = [
    { p: 0, label: "NO Case" },
    { p: 1, label: "Market" },
    { p: 2, label: "YES Case" },
  ];
  return (
    <div className="flex items-center justify-center gap-6" role="tablist" aria-label="Case pages">
      {items.map(({ p, label }) => {
        const on = active === p;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onGo(p)}
            className="flex flex-col items-center gap-1"
          >
            <span
              className="text-[9px] font-semibold uppercase tracking-[0.1em] transition-colors"
              style={{ color: on ? "var(--text)" : "var(--text-muted)" }}
            >
              {label}
            </span>
            <span
              className="h-1.5 w-1.5 rounded-full transition-colors"
              style={{ background: on ? "var(--text)" : "var(--border)" }}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}
