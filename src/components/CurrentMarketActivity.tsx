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
import { useState } from "react";
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

  // No count is shown: the raw row count and what the expanded feed renders
  // (grouped beats) are different numbers, and a number that disagrees with the
  // thing it opens is worse than no number at all.
  const toggle = () => setOpen((v) => !v);

  return (
    // NOT `return null` when quiet. The card collapses to zero height instead,
    // so a market with nothing to say gives its space back smoothly and takes
    // it back the same way when the first event lands.
    <Collapsible open={hasActivity} probe="market-activity" className={embedded ? "" : "mb-3"}>
      <div
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
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            In this market
          </span>
          <span
            className="ml-auto text-[11px] text-[var(--text-muted)] transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            aria-hidden
          >
            ▾
          </span>
        </button>

        {/* The latest beat, in a slot that is always two lines tall — so the
          text can change under a reader without the card resizing. */}
        <button type="button" onClick={toggle} className="block w-full px-3 pb-2 pt-0.5 text-left">
          <span
            className="line-clamp-2 break-words text-[13px] leading-snug text-[var(--text-secondary)]"
            style={{ minHeight: BEAT_MIN_H }}
          >
            {latest}
          </span>
        </button>

        {/* EXPANDS DOWNWARD, IN PLACE. Same primitive as the card itself, so
          opening is the same continuous movement as arriving — and the market
          stays readable beside its own activity instead of behind a scrim. */}
        <Collapsible open={open} probe="market-activity-body">
          <div
            className="overflow-y-auto px-3 pb-2"
            style={{ maxHeight: EXPANDED_MAX }}
            // The scroll lives here, so a flick inside the feed never chains up
            // and starts scrolling the rail behind it.
            onWheel={(e) => e.stopPropagation()}
          >
            <LiveTape
              wallet={wallet}
              onSelect={onSelect}
              marketIds={[marketId]}
              showTitles={false}
              limit={200}
              skeletonRows={4}
              emptyText="Quiet for three days."
              scroll={false}
              // The reader opened this deliberately and is looking straight at
              // it; new rows wait rather than rearranging what they are reading.
              holdUpdates
            />
          </div>
        </Collapsible>
      </div>
    </Collapsible>
  );
}
