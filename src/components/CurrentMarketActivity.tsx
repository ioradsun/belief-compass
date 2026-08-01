/**
 * "This market" — the pinned scope of the Live feed.
 *
 * The current market's story, gently elevated above the global feed: a thin accent
 * rail, a faint tint, a tiny uppercase label. Collapsed it shows ONE preview row —
 * the market's top recent event (reusing latestMaterialEvent / liveNowLine), or the
 * House's read when the market is quiet — plus an "N updates" affordance. Tapping
 * expands it in place: the House's interpretation as one row, then the market-scoped
 * Live feed, bounded and internally scrolled. Nothing navigates.
 *
 * No new infrastructure: getMarketChange and getHouseRead are the SAME reads the
 * deck already runs (React Query dedupes them), House copy is the existing houseNote,
 * and the expanded list is the existing <LiveTape> filtered by market. One feed, two
 * scopes.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarketChange } from "@/lib/markets.functions";
import { getHouseRead } from "@/lib/house.functions";
import { houseKey } from "@/lib/house-round";
import { houseNote } from "@/domain/house-note";
import { marketBook } from "@/domain/market-book";
import { latestMaterialEvent, liveNowLine } from "@/domain/live-now";
import { LiveTape } from "@/components/LiveTape";

const fmtMoney = (usd: number) =>
  usd >= 1000 ? `$${Math.round(usd).toLocaleString("en-US")}` : `$${usd.toFixed(usd < 10 ? 2 : 0)}`;

/** The relationship accent — the same faint purple personal rows use in the feed. */
const RAIL = "var(--rel,#9b87f5)";

export function CurrentMarketActivity({
  marketId,
  wallet,
  ethUsd,
  onSelect,
}: {
  marketId: number;
  wallet?: string;
  ethUsd: number;
  onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);

  // Both reads share the deck's query keys, so opening a market never double-fetches.
  const { data: change } = useQuery({
    queryKey: ["market-change", marketId],
    queryFn: () => getMarketChange({ data: { id: marketId } }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const { data: house } = useQuery({
    queryKey: houseKey(wallet, marketId),
    queryFn: () => getHouseRead({ data: { wallet: wallet ?? null, marketId } }),
    staleTime: 30_000,
  });
  const houseText = houseNote(wallet, house, marketId).text;

  // Preview = the single highest-value recent event, via the existing ranking.
  const preview = useMemo(() => {
    const t = change?.tape ?? [];
    if (!t.length) return null;
    const book = marketBook(t, Date.now());
    const capUsd = book.capitalEth.market.current * (ethUsd > 0 ? ethUsd : 0);
    const minCapEth = ethUsd > 0 ? Math.max(5, capUsd * 0.005) / ethUsd : 0;
    const e = latestMaterialEvent(t, Date.now(), minCapEth);
    return e ? liveNowLine(e, (eth) => fmtMoney(eth * (ethUsd > 0 ? ethUsd : 0))) : null;
  }, [change, ethUsd]);

  const count = change?.tape?.length ?? 0;

  // Collapsed, the preview does NOT keep swapping on every poll. It holds the last
  // line the viewer saw and instead counts how many events arrived since — the
  // number is calmer than a line that flickers. Opening the section marks all seen
  // and refreshes the held line.
  const [held, setHeld] = useState<{ emoji: string; text: string } | null>(null);
  const [seenCount, setSeenCount] = useState(0);
  useEffect(() => {
    if (held == null && preview != null) {
      setHeld(preview);
      setSeenCount(count);
    }
  }, [preview, held, count]);
  const unread = Math.max(0, count - seenCount);

  const markSeen = () => {
    setSeenCount(count);
    if (preview) setHeld(preview);
  };
  const toggle = () =>
    setOpen((v) => {
      if (!v) markSeen();
      return !v;
    });
  const line = held ?? preview;

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
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center gap-2 px-3 pb-2 pt-0.5 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-secondary)]">
            {line ? (
              <>
                <span aria-hidden>{line.emoji}</span> {line.text}
              </>
            ) : (
              <>
                <span aria-hidden>🏠</span>{" "}
                <span className="font-medium text-[var(--text)]">House</span> · {houseText}
              </>
            )}
          </span>
          {count > 0 && (
            <span className="num shrink-0 text-[12px] font-semibold text-[var(--text-muted)]">
              {unread > 0 ? `+${unread} new` : `${count} update${count === 1 ? "" : "s"}`} ›
            </span>
          )}
        </button>
      )}
    </div>
  );
}
