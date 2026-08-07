/**
 * "In this market" — the pinned scope of the Live feed.
 *
 * This market's own activity, gently elevated above the global feed: a thin
 * accent rail, a faint tint, a tiny uppercase label. It does exactly ONE job —
 * WHO and WHAT is happening on this market. The market's READ (the momentum
 * signal + the House's call) lives in the docked read on the order bar, so this
 * panel never competes with it.
 *
 * It reuses the exact market-scoped Live query the deck already runs (React
 * Query dedupes it). Collapsed, it leads with the latest beat; tapping expands
 * the feed DOWNWARD, in place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE WAYS THIS USED TO MOVE THE COLUMN, and what replaced each.
 *
 * 1. `if (count === 0) return null`. The rail is a flex column and the live tape
 *    below is `flex-1`, so this card's height is subtracted from the tape's.
 *    Returning null removed ~60px in a single frame: the "Now" heading jumped
 *    up, the tape's viewport grew, and every row moved. It fired on the most
 *    common interaction there is — changing markets — and then fired again in
 *    reverse the moment the first event landed. The old comment here claimed
 *    "nothing below it depends on its height", which the markup contradicts.
 *    Now the card stays mounted and COLLAPSES, so the same 60px is given back
 *    over 200ms and the eye follows it.
 *
 * 2. The latest beat was `line-clamp-2` with no reserved height, so it stood one
 *    line tall or two depending on the sentence. Every arriving event could
 *    therefore resize the card by ~18px — this is the jitter you feel while
 *    watching an active market, because the text changes on its own without
 *    anyone touching anything. The beat now always occupies two lines.
 *
 * 3. Expanding opened a `position: fixed` sheet over the whole column with a
 *    backdrop blur. That is not an expansion, it is a replacement: the rail's
 *    content disappeared behind a scrim and came back on dismiss. It also meant
 *    "what just happened here" could not be read ALONGSIDE the market it is
 *    about. It now grows downward from where it sits, bounded and internally
 *    scrolled, and the tape below keeps whatever height is left.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { listLiveEvents } from "@/lib/live.functions";
import { LiveTape } from "@/components/LiveTape";
import { Collapsible } from "@/components/Collapsible";

/** The relationship accent — the same faint purple personal rows use in the feed. */
const RAIL = "var(--rel,#9b87f5)";

/**
 * Two lines of the beat, always.
 *
 * `text-[13px] leading-snug` is ~17.9px a line, so two lines is ~36px. Reserving
 * it means a one-line beat leaves a little air and a two-line beat fits — and
 * neither changes the card's height when the next event replaces the text.
 *
 * The reserve only holds if the CLAMP holds. `line-clamp-2` sets
 * `display: -webkit-box`, and this element also carried `block` — the two
 * compete for `display` and `block` won, so a long beat ran to a third line and
 * grew the card by 18px straight through the reservation. The probe caught it;
 * reading the class list did not.
 */
const BEAT_MIN_H = 36;

/**
 * How far the expanded feed may push down.
 *
 * Bounded so the tape underneath never collapses to nothing: the panel scrolls
 * internally past this, rather than growing without limit and pushing "Now" off
 * the bottom of a short rail.
 */
const EXPANDED_MAX = "min(46vh, 340px)";

export function CurrentMarketActivity({
  marketId,
  wallet,
  onSelect,
  embedded,
}: {
  marketId: number;
  wallet?: string;
  onSelect: (id: number) => void;
  /** Rendered inside another instrument: drop the card chrome and outer margin. */
  embedded?: boolean;
  /**
   * NO `reason` PROP. This card is about WHAT IS HAPPENING in the market, and
   * the reason the market is in front of the reader belongs to the centre panel,
   * which says it once above the question.
   *
   * It briefly lived here as well, and the duplicate was the problem: the same
   * sentence in two columns, neither looking authoritative. The prop outlived
   * the render by a few commits — declared, documented as though it appeared,
   * and passed a value the caller computed with a per-render scan of the feed
   * entries. A prop that is accepted and ignored is worse than no prop: it reads
   * like a feature to everyone who arrives later.
   */
}) {
  const [open, setOpen] = useState(false);

  // The SAME scoped live query LiveTape runs, so what the header says and what
  // opens beneath it are the same rows, and React Query never double-fetches.
  const { data: live } = useQuery({
    queryKey: ["live-tape", wallet ?? null, [marketId], 200],
    queryFn: () => listLiveEvents({ data: { wallet, marketIds: [marketId], limit: 200 } }),
    // Same family, same reason: the coordinator invalidates `["live-tape"]` on
    // every trade, so this poll was slower than the socket and redundant with
    // it. See LiveTape for the full note.
    staleTime: 60_000,
    // Per-market key: the previous market's activity is not a placeholder for
    // this one's.
    placeholderData: (prev) => prev,
  });
  const rows = live?.rows ?? [];
  const hasActivity = rows.length > 0;
  const latest = rows[0]?.text ?? "";
  // A FIXED FRAME. The card used to mount/unmount (and animate open/closed)
  // with the data, so every market change jumped the rail: the frame vanished,
  // then reappeared a fetch later. The frame is now permanent and only its
  // CONTENT is swapped — quiet, loading and busy all occupy the same height.
  const beat = hasActivity ? latest : live ? "Quiet here for now." : "Loading activity…";

  // OPENS OVER EVERYTHING. The expanded feed used to grow inside the rail,
  // where ancestor `overflow` and stacking contexts clipped it — so the panel
  // was only ever half visible. It now mounts to <body> as a fixed dropdown
  // anchored to this card's column, above all app chrome.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; width: number; top: number } | null>(null);

  const measure = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({ left: r.left, width: r.width, top: r.bottom });
  }, []);

  useEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  // A market change must not leave a dropdown hanging over the next one.
  useEffect(() => {
    setOpen(false);
  }, [marketId]);

  // No count is shown: the raw row count and what the expanded feed renders
  // (grouped beats) are different numbers, and a number that disagrees with the
  // thing it opens is worse than no number at all.
  const toggle = () => {
    if (hasActivity) setOpen((v) => !v);
  };

  return (
    // Always open: the frame is fixed and only the text inside changes.
    <Collapsible open probe="market-activity" className={embedded ? "" : "mb-3"}>
      <div
        ref={cardRef}
        className={embedded ? "overflow-hidden" : "overflow-hidden rounded-[12px]"}
        style={
          embedded
            ? undefined
            : {
                borderLeft: `2px solid ${RAIL}`,
                background: `color-mix(in oklab, ${RAIL} 7%, transparent)`,
              }
        }
      >
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center gap-2 px-3 pb-1 pt-2 text-left"
          aria-expanded={open}
        >
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: RAIL }}
          >
            In this market
          </span>
          {hasActivity && (
            <span
              className="ml-auto text-[11px] text-[var(--text-muted)] transition-transform duration-200 ease-out motion-reduce:transition-none"
              style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
              aria-hidden
            >
              ▾
            </span>
          )}
        </button>

        {/* WHAT is happening in this market, and nothing else. The discovery
          reason is told once by the centre panel; repeating it here put the
          same sentence on screen twice. */}
        <div className="px-3 pb-2 pt-0.5">
          {/* The latest beat, in a slot that is always two lines tall — so the
            text can change under a reader without the card resizing. Only
            reserved always, so the frame never resizes as the text changes. */}
          <button
            type="button"
            onClick={toggle}
            className="block w-full text-left"
            disabled={!hasActivity}
          >
            <span
              className="line-clamp-2 break-words text-[13px] leading-snug text-[var(--text-secondary)]"
              style={{ minHeight: BEAT_MIN_H, opacity: hasActivity ? 1 : 0.6 }}
            >
              {beat}
            </span>
          </button>
        </div>
      </div>

      {/* DROPS DOWN OVER EVERYTHING. Portalled to <body> and fixed to this
        card's column, so no ancestor overflow or stacking context can clip it
        and the whole panel is visible. A transparent catcher behind it closes
        on an outside tap. */}
      {open && typeof document !== "undefined"
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[1200]" onClick={() => setOpen(false)} aria-hidden />
              <div
                className="fixed z-[1201] overflow-hidden rounded-[12px] border border-[var(--hairline)] shadow-2xl"
                style={{
                  left: anchor?.left ?? 0,
                  width: anchor?.width ?? "100%",
                  top: (anchor?.top ?? 0) + 4,
                  background: "var(--surface-raised, var(--surface, #101014))",
                }}
                role="dialog"
                aria-label="Activity in this market"
              >
                <div
                  className="overflow-y-auto px-3 py-2"
                  style={{
                    maxHeight: `min(${EXPANDED_MAX}, calc(100vh - ${(anchor?.top ?? 0) + 20}px))`,
                  }}
                  onWheel={(e) => e.stopPropagation()}
                >
                  <LiveTape
                    wallet={wallet}
                    onSelect={(id) => {
                      setOpen(false);
                      onSelect(id);
                    }}
                    marketIds={[marketId]}
                    showTitles={false}
                    limit={200}
                    skeletonRows={4}
                    emptyText="Quiet for three days."
                    scroll={false}
                    // The reader opened this deliberately and is looking straight
                    // at it; new rows wait rather than rearranging it.
                    holdUpdates
                  />
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </Collapsible>
  );
}
