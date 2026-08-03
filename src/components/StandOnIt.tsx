/**
 * "Stand on it" — the primary growth control on every market.
 *
 * Sharing is not a utility tucked in an overflow menu; it is how a viewer brings
 * their tribe into a market. So this is always visible and confident — a single
 * link icon and one challenge of a label — while staying visually secondary to
 * Back YES / Back NO (a ghost control, never a filled one).
 *
 * Interaction is the platform's own (see useShare): the native sheet on touch, an
 * immediate copy + a subtle confirmation on desktop. No custom sharing modal, no
 * platform icons, no clutter.
 */
import { useShare } from "@/lib/use-share";
import { marketShareUrl, shareMessage, type ShareSide } from "@/domain/share";

type Variant = "primary" | "card" | "inline";

const CONFIRM = "Link copied — stand on business.";

/** The one link glyph — a simple chain link, nothing decorative. */
function LinkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M9 12h6M10.5 8.5H8a3.5 3.5 0 1 0 0 7h2.5M13.5 8.5H16a3.5 3.5 0 1 1 0 7h-2.5"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StandOnIt({
  marketId,
  title,
  side = null,
  hasMedia = false,
  refCode,
  variant = "primary",
  className = "",
  onShared,
}: {
  marketId: number;
  title?: string | null;
  /** The viewer's backed side, so the share message can lead with it. */
  side?: ShareSide;
  hasMedia?: boolean;
  /** Lightweight attribution code carried on the link (?r=). */
  refCode?: string | null;
  variant?: Variant;
  className?: string;
  onShared?: () => void;
}) {
  const { standOnIt, copied } = useShare();

  const go = async (e: React.MouseEvent) => {
    // These controls live inside clickable cards; a share must never also navigate.
    e.stopPropagation();
    e.preventDefault();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = marketShareUrl(origin, marketId, title, refCode ?? null);
    const text = shareMessage({ side, hasMedia });
    const ok = await standOnIt({ url, text });
    if (ok) onShared?.();
  };

  // Icon-only for dense surfaces (market/position cards); labelled everywhere else.
  if (variant === "card") {
    return (
      <button
        type="button"
        onClick={go}
        aria-label="Stand on it — share this market"
        title={copied ? CONFIRM : "Stand on it"}
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:text-[var(--text)] ${className}`}
        style={{ border: "1px solid var(--border)" }}
      >
        <LinkIcon className="h-4 w-4" />
      </button>
    );
  }

  const label = copied ? CONFIRM : "Stand on it";
  const base =
    variant === "primary"
      ? "flex h-[52px] w-full items-center justify-center gap-2 rounded-[12px] text-[14px] font-semibold"
      : "inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-semibold";

  return (
    <button
      type="button"
      onClick={go}
      aria-label="Stand on it — share this market"
      // Ghost, not filled: important but a clear step below Back YES / Back NO.
      className={`${base} text-[var(--text)] transition-colors hover:bg-[var(--surface)] ${className}`}
      style={{ border: "1px solid var(--border-strong,var(--border))" }}
    >
      <LinkIcon className={variant === "primary" ? "h-[18px] w-[18px]" : "h-4 w-4"} />
      <span className={copied ? "text-[var(--text-secondary)]" : ""}>{label}</span>
    </button>
  );
}
