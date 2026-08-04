/**
 * "This market" — the pinned scope of the Live feed.
 *
 * The current market's story, gently elevated above the global feed: a thin accent
 * rail, a faint tint, a tiny uppercase label. The House Call always leads — it is
 * the one voice that talks about YOU, so it's the hook on every market — with a
 * quiet "+N new" count of the activity that has arrived since you last looked.
 * Tapping expands it in place: the House's interpretation as one row, then the
 * market-scoped Live feed, bounded and internally scrolled. Nothing navigates.
 *
 * No new infrastructure: getMarketChange and getHouseRead are the SAME reads the
 * deck already runs (React Query dedupes them), House copy is the existing houseNote,
 * and the expanded list is the existing <LiveTape> filtered by market. One feed, two
 * scopes.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHouseRead } from "@/lib/house.functions";
import { listLiveEvents } from "@/lib/live.functions";
import { houseKey } from "@/lib/house-round";
import { houseNote } from "@/domain/house-note";
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

  // Reads share the deck's query keys, so opening a market never double-fetches.
  const { data: house } = useQuery({
    queryKey: houseKey(wallet, marketId),
    queryFn: () => getHouseRead({ data: { wallet: wallet ?? null, marketId } }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  // Wallet is restored client-side, so gate the copy until after hydration to
  // keep SSR and first client render identical.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const houseText = houseNote(hydrated ? wallet : undefined, hydrated ? house : undefined, marketId).text;

  // Count exactly what the list below will show — the SAME scoped live query
  // LiveTape runs (React Query dedupes it), not the market's whole-life tape.
  // Otherwise a quiet market promises "12 updates" and then opens on nothing.
  const { data: live } = useQuery({
    queryKey: ["live-tape", wallet ?? null, [marketId], 200],
    queryFn: () => listLiveEvents({ data: { wallet, marketIds: [marketId], limit: 200 } }),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const count = live?.rows?.length ?? 0;



  // The House line is the always-on lead; only the count changes. Unread = events
  // that arrived since the viewer last opened this section, so the words stay put
  // while the number quietly climbs. Opening marks everything seen.
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
          This market
        </span>
        <span className="ml-auto text-[11px] text-[var(--text-muted)]" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div className="flex flex-col px-1 pb-1">
          {houseText && (
            <div
              className="sticky top-0 z-10 flex shrink-0 items-start gap-2 px-2 py-2"
              style={{ background: "color-mix(in oklab, var(--bg,#0b0b0f) 92%, transparent)" }}
            >
              <span aria-hidden>🏠</span>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--text)]">
                  House
                </div>
                <div className="text-[13px] leading-snug text-[var(--text-secondary)]">
                  {houseText}
                </div>
              </div>
            </div>
          )}
          {/* An explicit height gives the tape a real scroll box — without it the
            list grows and the section can't scroll on touch. When the window is
            empty there is nothing to scroll, so the box collapses to its one
            line instead of leaving a tall blank panel. */}
          <div className={count > 0 ? "h-[300px] min-h-0" : "min-h-0"}>

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
          {/* The House Call — always the lead. Wraps freely so it is never cut off. */}
          <span className="block text-[13px] leading-snug text-[var(--text-secondary)]">
            <span aria-hidden>🏠</span>{" "}
            <span className="font-medium text-[var(--text)]">House</span> · {houseText}
          </span>
          {count > 0 && (
            <span className="num mt-1 block text-right text-[12px] font-semibold text-[var(--text-muted)]">
              {unread > 0 ? `+${unread} new` : `${count} update${count === 1 ? "" : "s"}`} ›
            </span>
          )}
        </button>
      )}
    </div>
  );
}
