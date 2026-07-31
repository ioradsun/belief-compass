/**
 * The Story of YES / NO — Investigation Mode.
 *
 * Discovery is comparative: two side cards flank the House Read and the eye moves
 * across. Investigation is singular: one side's case takes the center, full
 * width, and reads top-to-bottom as a story —
 *
 *   headline → what happened in words → the full Conviction Timeline
 *   → the events that caused it → who is behind it → the action it argues for.
 *
 * It fetches nothing new: the same React Query keys the deck and the Case File
 * columns already run supply the tape, the believers and the defense.
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarketChange } from "@/lib/markets.functions";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { ConvictionIndexChart } from "@/components/ConvictionIndexChart";
import { convictionIndexSeries, indexTrendCaption } from "@/domain/conviction-index";
import { SideColumn, DefenseColumn } from "@/components/MarketEvidence";
import {
  convictionSeries,
  timelineEvents,
  leadStory,
  convictionStory,
  narrateStory,
} from "@/domain/conviction-series";
import { FLOW_WINDOW_SHORT, FLOW_WINDOW_PHRASE } from "@/domain/market-flow";
import { useDeckWindow } from "@/lib/deck-window";
import { fmtUsd } from "@/domain/order";

export function CaseStory({
  side,
  marketId,
  ethUsd,
  onClose,
  onBack,
  backed,
}: {
  side: "YES" | "NO";
  marketId: number;
  ethUsd: number;
  /** Return to Discovery (both sides side-by-side). */
  onClose: () => void;
  /** The one action this story argues for — selects the side in the dock. */
  onBack: () => void;
  /** True when the dock is already open on this side. */
  backed: boolean;
}) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  const win = useDeckWindow();

  // Escape always returns to comparison — investigation is a temporary lens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data: change } = useQuery({
    queryKey: ["market-change", marketId],
    queryFn: () => getMarketChange({ data: { id: marketId } }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const { data: evidence } = useQuery({
    queryKey: ["evidence", marketId],
    queryFn: () => getMarketEvidence({ data: { marketId } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const tape = change?.tape;
  const { idx, caption, story } = useMemo(() => {
    if (!tape?.length)
      return { idx: { opening: null, steps: [] }, caption: null, story: null };
    const now = Date.now();
    const s = convictionSeries(tape, side, win, now);
    const i = convictionIndexSeries(tape, side, win, now);
    return {
      idx: i,
      caption: indexTrendCaption(i.opening, i.steps),
      story: convictionStory(side, s),
    };
  }, [tape, side, win]);


  const believers = (evidence?.believers ?? []).filter((b) => b.side === side);
  const defense = (evidence?.defense ?? []).filter((o) => o.vote === side);

  const narrative = story
    ? narrateStory(story, side, FLOW_WINDOW_PHRASE[win], (eth) => fmtUsd(eth * (ethUsd || 0)))
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {/* Headline — the story's one sentence. Side colour is an accent only. */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={{ color }}
              >
                The story of {side}
              </span>
            </div>
            <h2 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">
              {story ? story.headline : `${side} has no story yet`}
            </h2>
            <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-[var(--text-secondary)]">
              {narrative ?? `Not enough activity on ${side} in this window to tell a story.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to comparison"
            className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
            style={{ border: "1px solid var(--border)" }}
          >
            ✕ Compare
          </button>
        </div>

        {/* The full timeline + its synchronized event rail. */}
        <div className="mt-4">
          <ConvictionTimeline
            side={side}
            points={series}
            events={events}
            ethUsd={ethUsd}
            windowLabel={FLOW_WINDOW_SHORT[win]}
            caption={caption}
          />
        </div>

        {/* Who is behind it — the people the numbers stand for. */}
        <section className="mt-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Who backs {side}
          </div>
          {believers.length === 0 ? (
            <p className="text-[11px] text-[var(--text-muted)]">No one on this side yet.</p>
          ) : (
            <SideColumn side={side} people={believers} networkWallets={new Set()} />
          )}
        </section>

        {/* Supporting evidence — the case people actually argued. */}
        <section className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Evidence for {side}
          </div>
          {defense.length === 0 ? (
            <p className="text-[11px] text-[var(--text-muted)]">No case made for {side} yet.</p>
          ) : (
            <DefenseColumn side={side} opinions={defense} />
          )}
        </section>
      </div>

      {/* The one action this story argues for. */}
      <div className="shrink-0 pt-3">
        <button
          type="button"
          onClick={onBack}
          className="w-full rounded-[12px] py-3 text-[14px] font-semibold transition-colors"
          style={{
            border: `1.5px solid ${color}`,
            background: backed ? `color-mix(in oklab, ${color} 16%, transparent)` : "transparent",
            color: "var(--text)",
          }}
        >
          Back {side}
        </button>
      </div>
    </div>
  );
}
