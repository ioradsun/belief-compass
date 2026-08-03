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
import { getMarketChange } from "@/lib/markets.functions";
import { getHouseRead } from "@/lib/house.functions";
import { houseKey } from "@/lib/house-round";
import { houseNote } from "@/domain/house-note";
import { LiveTape } from "@/components/LiveTape";

/** The relationship accent — the same faint purple personal rows use in the feed. */
const RAIL = "var(--rel,#9b87f5)";

export function CurrentMarketActivity({
  marketId,
  wallet,
  onSelect,
}: {
  marketId: number;
  wallet?: string;
  onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);

  // Both reads share the deck's query keys, so opening a market never double-fetches.
  const { data: change } = useQuery({
    queryKey: ["market-change", marketId],
    queryFn: () => getMarketChange({ data: { id: marketId } }),
    staleTime: 10_000,
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
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

  // The tape is the market's whole life, but the list below only ever shows the
  // last 72 hours — so count the same window, or a quiet market promises
  // "12 updates" and then opens on nothing.
  const WINDOW_MS = 72 * 3_600_000;
  const cutoff = Date.now() - WINDOW_MS;
  const recent = (change?.tape ?? []).filter((t) => t.t >= cutoff);
  const count = recent.length;


  // The House line is the always-on lead; only the count changes. Unread = events
  // that arrived since the viewer last opened this section, so the words stay put
  // while the number quietly climbs. Opening marks everything seen.
  const [seenCount, setSeenCount] = useState<number | null>(null);
  useEffect(() => {
    if (seenCount == null && change) setSeenCount(count);
  }, [change, count, seenCount]);
  const unread = seenCount == null ? 0 : Math.max(0, count - seenCount);
  const toggle = () =>
    setOpen((v) => {
      if (!v) setSeenCount(count);
      return !v;
    });

  return (
    <div
      className="mb-3 shrink-0 overflow-hidden rounded-[12px]"
      style={{
        borderLeft: `2px solid ${RAIL}`,
        background: `color-mix(in oklab, ${RAIL} 7%, transparent)`,
      }}
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
            list grows and the section can't scroll on touch. */}
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
