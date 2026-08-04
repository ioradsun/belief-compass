/**
 * "Live activity" — the pinned scope of the Live feed.
 *
 * This market's own activity feed, gently elevated above the global feed: a thin
 * accent rail, a faint tint, a tiny uppercase label. It does exactly ONE job —
 * WHO and WHAT is happening on this market. The market's READ (the momentum
 * signal + the House's call) now lives in the one docked read on the order bar,
 * so this panel never competes with it and never repeats a cold-start prompt: it
 * simply HIDES until there is real activity to show.
 *
 * No new infrastructure: it reuses the exact market-scoped Live query the deck
 * already runs (React Query dedupes it). Collapsed, it leads with the latest beat
 * and a quiet unread count; tapping expands the bounded, internally-scrolled feed.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listLiveEvents } from "@/lib/live.functions";
import { LiveTape } from "@/components/LiveTape";

/** The relationship accent — the same faint purple personal rows use in the feed. */
const RAIL = "var(--rel,#9b87f5)";

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

  // The SAME scoped live query LiveTape runs, so the count matches what opens and
  // React Query never double-fetches.
  const { data: live } = useQuery({
    queryKey: ["live-tape", wallet ?? null, [marketId], 200],
    queryFn: () => listLiveEvents({ data: { wallet, marketIds: [marketId], limit: 200 } }),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const rows = live?.rows ?? [];
  const count = rows.length;
  const latest = rows[0]?.text ?? "";

  // Unread = beats that arrived since the viewer last opened this section, so the
  // lead line stays put while the number quietly climbs. Opening marks all seen.
  const [seenCount, setSeenCount] = useState<number | null>(null);
  useEffect(() => {
    if (seenCount == null && live) setSeenCount(count);
  }, [live, count, seenCount]);
  const unread = seenCount == null ? 0 : Math.max(0, count - seenCount);
  const toggle = () =>
    setOpen((v) => {
      if (!v) setSeenCount(count);
      return !v;
    });

  // Nothing has happened yet → show nothing. The cold-start read lives on the
  // order bar; a "no activity" placeholder here would just repeat it.
  if (count === 0) return null;

  return (
    <div
      className={embedded ? "shrink-0 overflow-hidden" : "mb-3 shrink-0 overflow-hidden rounded-[12px]"}
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
          Live activity
        </span>
        <span className="ml-auto text-[11px] text-[var(--text-muted)]" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div className="flex flex-col px-1 pb-1">
          <div className="h-[300px] min-h-0">
            <LiveTape
              wallet={wallet}
              onSelect={onSelect}
              marketIds={[marketId]}
              showTitles={false}
              limit={200}
              skeletonRows={4}
              emptyText="No activity in the last 72 hours."
            />
          </div>
        </div>
      ) : (
        <button type="button" onClick={toggle} className="block w-full px-3 pb-2 pt-0.5 text-left">
          {/* The latest beat leads; the count trails, quiet. */}
          <span className="block truncate text-[13px] leading-snug text-[var(--text-secondary)]">
            {latest}
          </span>
          <span className="num mt-1 block text-right text-[12px] font-semibold text-[var(--text-muted)]">
            {unread > 0 ? `+${unread} new` : `${count} update${count === 1 ? "" : "s"}`} ›
          </span>
        </button>
      )}
    </div>
  );
}
