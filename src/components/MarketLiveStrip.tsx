/**
 * MarketLiveStrip — one line of live activity for the active market.
 *
 * Collapsed: a blinking green dot + the single newest event. No label — the dot
 * is the label. Click to expand into an overlay that floats above the deck.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { listLiveEvents } from "@/lib/live.functions";
import { LiveTape } from "@/components/LiveTape";

export function MarketLiveStrip({
  marketId,
  open,
  onOpenChange,
}: {
  marketId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = useQuery({
    queryKey: ["live-tape", null, [marketId], 1],
    queryFn: () => listLiveEvents({ data: { marketIds: [marketId], limit: 1 } }),
    refetchInterval: 6_000,
    placeholderData: (prev) => prev,
  });
  const latest = data?.rows?.[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-label="Live activity on this market"
        className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-[var(--border)]/25"
        style={{ border: "1px solid var(--border)" }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
          style={{ background: "var(--yes)" }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
          {latest?.text ?? "No trades on this market yet."}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => onOpenChange(false)}
            aria-hidden
          />
          <div
            className="absolute left-0 right-0 top-0 z-50 rounded-[12px] p-2 shadow-2xl"
            style={{ border: "1px solid var(--border)", background: "var(--surface, #0d0d0f)" }}
          >
            <div className="mb-1 flex items-center gap-2 px-1.5">
              <span
                className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
                style={{ background: "var(--yes)" }}
                aria-hidden
              />
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                Close
              </button>
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              <LiveTape
                marketIds={[marketId]}
                limit={20}
                showTitles={false}
                skeletonRows={3}
                emptyText="No trades on this market yet."
                onSelect={() => {}}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
