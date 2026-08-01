/**
 * Case File — one side's case, told as a single story with no breaks.
 *
 * THE CLAIM (now) → THE MOVEMENT (over the shared window) → THE PEOPLE (who is
 * sustaining the position, the group they belong to, and how long they've held).
 * Both sides read the SAME timeframe (deck-window) so YES and NO are always
 * comparable; a side only detaches its own period inside the full investigation.
 * No conviction index, no duplicate People/Network lists — just the argument.
 *
 * Presentation only: it reuses the exact React Query keys the deck already runs
 * (so opening the Case File adds no requests) and derives the totals, deltas and
 * roster ordering from the pure src/domain/case-file engine.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarketEvidence, type Believer } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { getMarketChange } from "@/lib/markets.functions";
import { ConvictionSpark } from "@/components/ConvictionSpark";
import type { MarketRow } from "@/components/MarketCard";
import { fmtUsd } from "@/domain/order";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { timelineEvents } from "@/domain/conviction-series";
import { FLOW_WINDOW_PHRASE, FLOW_WINDOW_SHORT, type FlowWindow } from "@/domain/market-flow";
import { useDeckWindow, setDeckWindow } from "@/lib/deck-window";
import { marketBook, type BookMetric } from "@/domain/market-book";
import {
  RELATIONSHIP_LABEL,
  STATUS_LABEL,
  heldFor,
  rankBelievers,
  sideCaseSummary,
  type CaseRelationship,
} from "@/domain/case-file";

/** Window-relative % for a book metric, or null when the base is too small. */
const metricPct = (m: BookMetric): number | null => (m.base > 0 ? (m.delta / m.base) * 100 : null);

type Side = "YES" | "NO";

const WINDOWS: FlowWindow[] = ["1h", "24h", "7d", "30d", "all"];

/** The relationship word's colour — the one primary badge. Status stays quiet. */
const REL_TONE: Record<CaseRelationship, string> = {
  twin: "var(--yes)",
  tribe: "var(--yes)",
  rival: "var(--no)",
  inverse: "var(--no)",
  unmapped: "var(--text-muted)",
};

const num = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

export function CaseColumn({
  side,
  marketId,
  row,
  viewerWallet,
  ethUsd = 0,
  onInvestigate,
  investigating = false,
}: {
  side: Side;
  marketId: number;
  row: MarketRow;
  viewerWallet?: string;
  /** Live ETH/USD, so money reads in dollars like the rest of the app. */
  ethUsd?: number;
  /** Optional deep-dive into the center timeline (desktop). */
  onInvestigate?: (s: Side) => void;
  investigating?: boolean;
}) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  // The shared timeframe: YES and NO always quote the same period so they compare.
  const win = useDeckWindow();

  // Same query keys the deck already runs → React Query dedupes, no new requests.
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
  const { data: change } = useQuery({
    queryKey: ["market-change", marketId],
    queryFn: () => getMarketChange({ data: { id: marketId } }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const tape = change?.tape;
  const { summary, events } = useMemo(() => {
    if (!tape?.length) return { summary: null, events: [] };
    const now = Date.now();
    return {
      summary: sideCaseSummary(tape, side, win, now),
      events: timelineEvents(tape, side, win, now, 3),
    };
  }, [tape, side, win]);

  const believers = (evidence?.believers ?? []).filter((b) => b.side === side);

  // Headline Believers + Capital come from the CANONICAL reducer (the same one the
  // center uses), so YES + NO always equals the center's Market total. Price is a
  // per-share fact, not a total, so it stays with the side summary.
  const book = useMemo(() => (tape?.length ? marketBook(tape, Date.now()) : null), [tape]);
  const sideKey = side === "YES" ? "yes" : "no";
  const believerMetric = book?.believers[sideKey] ?? null;
  const capitalMetric = book?.capitalEth[sideKey] ?? null;

  // Fall back to the market row before the tape has loaded, so the panel never
  // opens blank. The row totals are period-less; the deltas need the tape.
  const rr = row as Record<string, unknown>;
  const believersTotal =
    believerMetric?.current ?? num(side === "YES" ? rr.believers_yes : rr.believers_no) ?? 0;
  const capitalUsd =
    capitalMetric != null
      ? capitalMetric.current * (ethUsd || 0)
      : num(side === "YES" ? rr.yes_capital_usd : rr.no_capital_usd);
  const priceUsd =
    summary?.priceEth != null
      ? summary.priceEth * (ethUsd || 0)
      : num(side === "YES" ? rr.yes_price_usd : rr.no_price_usd);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: the side, and the one shared time filter. */}
      <div className="mb-3 shrink-0">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-[13px] font-semibold" style={{ color }}>
            {side}
          </span>
          <span className="text-[13px] font-semibold text-[var(--text)]">Case</span>
        </div>
        <WindowFilter win={win} onWin={setDeckWindow} />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        {/* ACT 1 — THE CLAIM: three totals, each with its move over the window. */}
        <div className="space-y-2">
          <StatRow
            icon="👥"
            label={`${side} Believers`}
            value={believersTotal.toLocaleString("en-US")}
            pct={believerMetric ? metricPct(believerMetric) : (summary?.believersPct ?? null)}
          />
          <StatRow
            icon="💰"
            label={`${side} Capital`}
            value={capitalUsd != null ? fmtUsd(capitalUsd) : "—"}
            pct={capitalMetric ? metricPct(capitalMetric) : (summary?.capitalPct ?? null)}
          />
          <StatRow
            icon="📈"
            label="Price"
            value={priceUsd != null ? `$${priceUsd.toFixed(2)}` : "—"}
            pct={summary?.pricePct ?? null}
          />
        </div>

        {/* ACT 2 — THE MOVEMENT: the shape, one honest sentence, the latest beats. */}
        <div className="space-y-2">
          {summary && summary.series.length > 1 && (
            <ConvictionSpark side={side} points={summary.series} events={events} />
          )}
          <p className="text-[12px] leading-snug text-[var(--text-secondary)]">
            {summary?.headline
              ? `${summary.headline} ${FLOW_WINDOW_PHRASE[win]}.`
              : `${side} has been quiet ${FLOW_WINDOW_PHRASE[win]}.`}
          </p>
          {events.length > 0 && (
            <ul className="space-y-1">
              {events.map((e) => (
                <li key={e.id} className="flex items-baseline gap-1.5 text-[11px]">
                  <span aria-hidden>{e.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
                    {e.eth != null ? `${fmtUsd(e.eth * (ethUsd || 0))} ${e.text}` : e.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ACT 3 — THE PEOPLE: one roster, one relationship badge, one status. */}
        <CaseRoster side={side} believers={believers} people={net?.people} />
      </div>

      {/* Optional deep-dive into the full center timeline (desktop investigation). */}
      {onInvestigate && (
        <button
          type="button"
          onClick={() => onInvestigate(side)}
          aria-pressed={investigating}
          className="mt-2 shrink-0 text-left text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors"
          style={{ color }}
        >
          {investigating ? "Reading the full timeline ↗" : "Open the full timeline ↗"}
        </button>
      )}
    </div>
  );
}

/** The shared time filter: 1H · 1D · 1W · 1M · All. */
export function WindowFilter({ win, onWin }: { win: FlowWindow; onWin: (w: FlowWindow) => void }) {
  return (
    <div
      className="flex rounded-[9px] p-0.5"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      role="tablist"
      aria-label="Timeframe"
    >
      {WINDOWS.map((w) => {
        const on = w === win;
        return (
          <button
            key={w}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onWin(w)}
            className={`flex-1 rounded-[7px] px-1.5 py-1 text-[11px] font-semibold transition-colors ${
              on ? "bg-[var(--bg)] text-[var(--text)]" : "text-[var(--text-muted)]"
            }`}
          >
            {FLOW_WINDOW_SHORT[w]}
          </button>
        );
      })}
    </div>
  );
}

/** One headline total with its window-relative % change. */
export function StatRow({
  icon,
  label,
  value,
  pct,
}: {
  icon: string;
  label: string;
  value: string;
  pct: number | null;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[15px]" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
          {label}
        </div>
        <div className="num text-[18px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">
          {value}
        </div>
      </div>
      <PctChip pct={pct} />
    </div>
  );
}

/** A green/red/quiet % chip — the move over the selected window. */
export function PctChip({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="num text-[11px] text-[var(--text-muted)]">—</span>;
  const flat = Math.abs(pct) < 0.05;
  const color = flat ? "var(--text-muted)" : pct > 0 ? "var(--yes)" : "var(--no)";
  const arrow = flat ? "•" : pct > 0 ? "▲" : "▼";
  return (
    <span className="num shrink-0 text-[12px] font-semibold" style={{ color }}>
      {arrow} {Math.abs(pct).toFixed(pct !== 0 && Math.abs(pct) < 10 ? 1 : 0)}%
    </span>
  );
}

/** The people, as one ranked roster — People and Network merged, no duplicates. */
export function CaseRoster({
  side,
  believers,
  people,
}: {
  side: Side;
  believers: Believer[];
  people?: { wallet: string; relationship: string }[];
}) {
  const relOf = useMemo(() => {
    const m = new Map((people ?? []).map((p) => [p.wallet.toLowerCase(), p.relationship]));
    return (w: string) => m.get(w) ?? null;
  }, [people]);
  const roster = useMemo(() => rankBelievers(believers, relOf), [believers, relOf]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Who backs {side}
        </span>
        {roster.length > 0 && (
          <span className="num text-[10px] text-[var(--text-muted)]">{roster.length}</span>
        )}
      </div>
      {roster.length === 0 ? (
        <p className="px-0.5 text-[11px] text-[var(--text-muted)]">No one on this side yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {roster.map(({ believer: b, relationship, status }) => (
            <li key={b.wallet} className="flex items-center gap-2 rounded-[8px] px-1 py-1">
              {b.avatarUrl ? (
                <img
                  src={b.avatarUrl}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                  style={{ background: `hsl(${hueFor(b.wallet)} 45% 45%)` }}
                  aria-hidden
                >
                  {initialsFor(b.name)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-[var(--text)]">{b.name}</div>
                <div className="text-[11px]">
                  <span className="font-medium" style={{ color: REL_TONE[relationship] }}>
                    {RELATIONSHIP_LABEL[relationship]}
                  </span>
                  {status && (
                    <span className="text-[var(--text-muted)]"> · {STATUS_LABEL[status]}</span>
                  )}
                </div>
                <div className="num text-[10px] text-[var(--text-muted)]">
                  {heldFor(b.daysHeld)}
                  {b.valueUsd >= 1 ? ` · ${fmtUsd(b.valueUsd)} backed` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
