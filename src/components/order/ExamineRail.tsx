/**
 * The analysis rail — the market signal on the left, the Case File disclosure
 * below it, as ONE full-width control attached to the top of the action surface.
 *
 * Shared by BOTH surfaces: the desktop deck attaches it to the Total Market
 * instrument, the phone attaches it to the top of the dock, so the order bar
 * reads identically everywhere. No card, no tab: a hairline does the separating.
 */
import { useEffect, useRef, useState } from "react";
import { HouseRead } from "@/components/HouseRead";
import type { HouseReadState } from "@/domain/house-read";

/**
 * The split-panel mark: two halves that part to reveal what sits behind them.
 * Open state draws them closer together — the same gesture, reversed.
 */
export function SplitPanelIcon({ open }: { open: boolean }) {
  const gap = open ? 1.1 : 2.4;
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      className="shrink-0 transition-[transform] duration-200 motion-reduce:transition-none"
    >
      <rect
        x={2.5 - gap / 2}
        y="3.5"
        width="5.5"
        height="11"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <rect
        x={10 + gap / 2}
        y="3.5"
        width="5.5"
        height="11"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

/** The analytical spark — an amber four-point mark, decorative. */
export function SignalSpark({ hot }: { hot: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 12 12"
      aria-hidden
      className="shrink-0 transition-opacity duration-500 motion-reduce:transition-none"
      style={{ color: "var(--signal,#d99a2b)", opacity: hot ? 1 : 0.82 }}
    >
      <path
        d="M6 0.6 L7.05 4.95 L11.4 6 L7.05 7.05 L6 11.4 L4.95 7.05 L0.6 6 L4.95 4.95 Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ExamineCta({
  open,
  onToggle,
  teaser,
  houseRead = null,
  openLabel = "Case File · How the Market Divides (YES vs NO)",
  closeLabel = "Close Case File",
  compact = false,
}: {
  open: boolean;
  onToggle: () => void;
  /** The momentum/pulse read, shown as the market signal. */
  teaser?: string | null;
  /**
   * The House Read — the House's attempt to call the viewer's next move, shown
   * directly beneath the market signal. The SAME state drives desktop and
   * mobile; null only when there is no viewer to read at all.
   */
  houseRead?: HouseReadState | null;
  openLabel?: string;
  closeLabel?: string;
  /** Phone dock: tighter padding, same anatomy. */
  compact?: boolean;
}) {
  const signal = teaser ?? "Market signal forming.";
  // A single, brief attention beat when the READ itself changes — never on
  // mount, never on a rerender that says the same thing.
  const seen = useRef<string | null>(null);
  const [hot, setHot] = useState(false);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = signal;
      return;
    }
    if (seen.current === signal) return;
    seen.current = signal;
    setHot(true);
    const t = setTimeout(() => setHot(false), 450);
    return () => clearTimeout(t);
  }, [signal]);

  return (
    <div>
      {/* The ONE market read: the momentum signal, and — only when the House has
          earned a call — its personal line beneath. No competing card elsewhere. */}
      <div
        className={`transition-[background-color] duration-200 ${
          compact ? "px-3.5 py-2" : "px-4 py-3 sm:px-5"
        }`}
        style={{
          background: hot ? "color-mix(in oklab,#d99a2b 9%,transparent)" : "transparent",
        }}
      >
        <div className="flex min-w-0 items-center gap-2 text-[13px] leading-snug text-[var(--text)]">
          <SignalSpark hot={hot} />
          <span className="min-w-0 truncate">{signal}</span>
        </div>
        {houseRead && <HouseRead state={houseRead} className="mt-1" />}
      </div>
      <div className="border-t border-[var(--hairline)]" aria-hidden />
      {/* Case File disclosure — says plainly what opening it reveals. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? closeLabel : openLabel}
        className={`group flex w-full cursor-pointer items-center justify-center gap-[9px] text-center transition-[background-color,transform] duration-200 active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--text)] motion-reduce:transition-none motion-reduce:active:scale-100 ${
          compact ? "min-h-[40px] px-3.5 py-2" : "min-h-[48px] px-4 py-3 sm:px-5"
        }`}
      >
        <SplitPanelIcon open={open} />
        <span className="min-w-0 truncate text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text)]">
          {open ? closeLabel : openLabel}
        </span>
      </button>
    </div>
  );
}
