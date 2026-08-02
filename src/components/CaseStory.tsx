/**
 * The Story of YES / NO — Investigation Mode (full timeline).
 *
 * Discovery is comparative and shares one timeframe; investigation is singular:
 * one side's case takes the center, full width, and DETACHES its own window so
 * you can scrub this side's history without disturbing the comparison.
 *
 *   headline → what happened in words → the three real signals over time
 *   (believers, capital, price — never a synthetic index) → the events that
 *   caused it → who is sustaining it → the action it argues for.
 *
 * It fetches nothing new: the same React Query keys the deck and the Case File
 * columns already run supply the tape, the believers and the network.
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarketChange } from "@/lib/markets.functions";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { ConvictionSpark } from "@/components/ConvictionSpark";
import { CaseRoster, StatRow } from "@/components/CaseFile";
import { WindowFilter } from "@/components/WindowFilter";
import { useDeckWindow, setDeckWindow } from "@/lib/deck-window";


import { convictionStory, narrateStory, timelineEvents } from "@/domain/conviction-series";
import { FLOW_WINDOW_PHRASE } from "@/domain/market-flow";
import { sideCaseSummary } from "@/domain/case-file";
import { fmtUsd } from "@/domain/order";

export function CaseStory({
  side,
  marketId,
  ethUsd,
  viewerWallet,
  onClose,
}: {
  side: "YES" | "NO";
  marketId: number;
  ethUsd: number;
  viewerWallet?: string;
  /** Return to Discovery (both sides side-by-side). */
  onClose: () => void;
}) {

  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  // One timeframe everywhere: investigation reads (and can change) the same
  // selection the center panel owns, so no two surfaces quote different periods.
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
  const { data: net } = useQuery({
    queryKey: ["network", viewerWallet ?? null, "all", "relevant", ""],
    queryFn: () => getNetwork({ data: { wallet: viewerWallet, limit: 60 } }),
    enabled: !!viewerWallet,
    staleTime: 60_000,
  });

  const tape = change?.tape;
  const { summary, events, story } = useMemo(() => {
    if (!tape?.length) return { summary: null, events: [], story: null };
    const now = Date.now();
    const s = sideCaseSummary(tape, side, win, now);
    return {
      summary: s,
      events: timelineEvents(tape, side, win, now, 8),
      story: s ? convictionStory(side, s.series) : null,
    };
  }, [tape, side, win]);

  const believers = (evidence?.believers ?? []).filter((b) => b.side === side);
  const narrative = story
    ? narrateStory(story, side, FLOW_WINDOW_PHRASE[win], (eth) => fmtUsd(eth * (ethUsd || 0)))
    : null;

  const capitalUsd = summary ? summary.capitalEth * (ethUsd || 0) : null;
  const priceUsd = summary?.priceEth != null ? summary.priceEth * (ethUsd || 0) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {/* THE ONE TIMEFRAME — same control, same position as when the timeline is
        closed, so opening a story never moves or hides it. */}
        <div className="mb-3 max-w-[300px]">
          <WindowFilter win={win} onWin={setDeckWindow} />
        </div>

        {/* Headline — the story's one sentence. Side colour is an accent only. */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: color }}
                aria-hidden
              />
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



        {/* The three real signals over time — believers, capital, price. */}
        <div className="mt-4 space-y-3">
          <SignalOverTime
            side={side}
            icon="👥"
            label="Believers"
            value={summary ? summary.believers.toLocaleString("en-US") : "—"}
            pct={summary?.believersPct ?? null}
            points={summary?.series ?? []}
            metric="believers"
          />
          <SignalOverTime
            side={side}
            icon="💰"
            label="Capital"
            value={capitalUsd != null ? fmtUsd(capitalUsd) : "—"}
            pct={summary?.capitalPct ?? null}
            points={summary?.series ?? []}
            metric="capital"
          />
          <SignalOverTime
            side={side}
            icon="📈"
            label="Price"
            value={priceUsd != null ? `$${priceUsd.toFixed(2)}` : "—"}
            pct={summary?.pricePct ?? null}
            points={summary?.series ?? []}
            metric="price"
          />
        </div>

        {/* The events that caused it. */}
        {events.length > 0 && (
          <section className="mt-4">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              What happened {FLOW_WINDOW_PHRASE[win]}
            </div>
            <ul className="space-y-1">
              {events.map((e) => (
                <li key={e.id} className="flex items-baseline gap-1.5 text-[12px]">
                  <span aria-hidden>{e.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">
                    {e.eth != null ? `${fmtUsd(e.eth * (ethUsd || 0))} ${e.text}` : e.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Who is sustaining it — the same roster, one relationship badge each. */}
        <section className="mt-4">
          <CaseRoster side={side} believers={believers} people={net?.people} />
        </section>
      </div>

      {/* No side action here — the decision dock below already owns Back YES/NO. */}

    </div>
  );
}

/** One signal (believers / capital / price): its total, its move, its shape. */
function SignalOverTime({
  side,
  icon,
  label,
  value,
  pct,
  points,
  metric,
}: {
  side: "YES" | "NO";
  icon: string;
  label: string;
  value: string;
  pct: number | null;
  points: import("@/domain/conviction-series").SeriesPoint[];
  metric: "believers" | "capital" | "price";
}) {
  return (
    <div className="rounded-[12px] p-2.5" style={{ border: "1px solid var(--border)" }}>
      <StatRow icon={icon} label={label} value={value} pct={pct} />
      {points.length > 1 && (
        <div className="mt-1.5">
          <ConvictionSpark side={side} points={points} metric={metric} />
        </div>
      )}
    </div>
  );
}
