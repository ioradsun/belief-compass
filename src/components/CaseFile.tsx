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
import { setDeckLens, useDeckLens } from "@/lib/deck-lens";
import { useQuery } from "@tanstack/react-query";
import { getMarketEvidence, type Believer } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { getMarketChange, getMarketBaselines, type VolumeWindow } from "@/lib/markets.functions";
import { windowChange } from "@/domain/window-change";
import { LensChart } from "@/components/LensChart";
import type { MarketRow } from "@/components/MarketCard";
import { useMoney } from "@/lib/display-unit";
import { formatMoney } from "@/domain/money";
import { aliasFor } from "@/lib/wallet-identity";
import { PersonAvatar } from "@/components/PersonAvatar";

import {
  LENS_META,
  lensColdStart,
  lensFacts,
  lensStory,
  type LensMetric,
} from "@/domain/side-lens";
import { FLOW_WINDOW_PHRASE, FLOW_WINDOW_SHORT } from "@/domain/market-flow";
export { WindowFilter } from "@/components/WindowFilter";
import { useDeckWindow } from "@/lib/deck-window";
import { marketBook, type BookMetric } from "@/domain/market-book";
import { rankBelievers, sideCaseSummary, type CaseRelationship } from "@/domain/case-file";

/** Window-relative % for a book metric, or null when the base is too small. */
const metricPct = (m: BookMetric): number | null => (m.base > 0 ? (m.delta / m.base) * 100 : null);

type Side = "YES" | "NO";

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

/** Compact "how long ago" for the activity feed. */
function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

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
  const { format, ethUsd: rateUsd } = useMoney();
  // Trade sizes are ETH-native; without a live rate we still show the ETH figure
  // rather than an empty dash, so activity always carries an amount.
  const tradeAmount = (eth: number) =>
    (rateUsd ?? 0) > 0
      ? format(eth, "ETH")
      : formatMoney(eth, { from: "ETH", to: "ETH", ethUsd: 0 });

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
  // Authoritative window-open baselines (D3): exact even when the tape is capped
  // at 1000 trades. Absent (pre-migration / no old-enough snapshot) → tape fallback.
  const { data: baselines } = useQuery({
    queryKey: ["market-baselines", marketId],
    queryFn: () => getMarketBaselines({ data: { id: marketId } }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  const tape = change?.tape;
  const summary = useMemo(
    () => (tape?.length ? sideCaseSummary(tape, side, win, Date.now()) : null),
    [tape, side, win],
  );

  const believers = (evidence?.believers ?? []).filter((b) => b.side === side);

  // Recent activity — the last few real trades on THIS side: who, and how much.
  // Independent of the selected lens, and never repeats the side (it's the panel).
  const nameOf = useMemo(() => {
    const m = new Map(
      (evidence?.believers ?? []).map((b) => [b.wallet.toLowerCase(), b.name] as const),
    );
    return (w: string) => m.get(w.toLowerCase()) ?? aliasFor(w);
  }, [evidence]);
  const avatarOf = useMemo(() => {
    const m = new Map(
      (evidence?.believers ?? []).map((b) => [b.wallet.toLowerCase(), b.avatarUrl] as const),
    );
    return (w: string) => m.get(w.toLowerCase()) ?? null;
  }, [evidence]);
  const recent = useMemo(() => {
    if (!tape?.length) return [];
    return tape
      .filter((t) => t.side === side && t.eth > 0)
      .slice()
      .sort((a, b) => b.t - a.t || (b.seq ?? 0) - (a.seq ?? 0))
      .slice(0, 5)
      .map((t, i) => ({
        id: `${t.w}-${t.t}-${t.seq ?? i}`,
        wallet: t.w,
        name: nameOf(t.w),
        avatarUrl: avatarOf(t.w),
        eth: t.eth,
        action: t.action,
        t: t.t,
      }));
  }, [tape, side, nameOf, avatarOf]);

  // Headline Believers + Capital come from the CANONICAL reducer (the same one the
  // center uses), so YES + NO always equals the center's Market total. Price is a
  // per-share fact, not a total, so it stays with the side summary.
  const book = useMemo(
    () => (tape?.length ? marketBook(tape, Date.now(), win) : null),
    [tape, win],
  );
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

  // ── The one chart, one lens ─────────────────────────────────────────────────
  // Believers is always the default lens — conviction.company is about people
  // first. The selection is component state, so changing the timeframe never
  // resets which lens you're investigating.
  const metric = useDeckLens();
  const series = useMemo(() => summary?.series ?? [], [summary]);
  // The one shared formatter: capital/proceeds are ETH-native, POV worth is USD —
  // each renders in the viewer's chosen unit through the single global rate.
  const money = useMemo(() => (eth: number) => format(eth, "ETH"), [format]);
  const facts = useMemo(() => lensFacts(series), [series]);
  const coldStart = lensColdStart(metric, series);
  const meta = LENS_META[metric];
  const lensSentence = lensStory(metric, side, facts, FLOW_WINDOW_PHRASE[win], money);

  // Prefer the AUTHORITATIVE current (market_state row) + the snapshot baseline for
  // the selected window: correct even on a >1000-trade market where the tape can't
  // reach the window's opening state. When either is unavailable, fall back to the
  // tape-derived marketBook figures (identical on the ~all non-truncated markets).
  const bl = baselines?.[win as VolumeWindow];
  const authBelievers = num(side === "YES" ? rr.believers_yes : rr.believers_no);
  const authCapitalUsd = num(side === "YES" ? rr.yes_capital_usd : rr.no_capital_usd);
  const belBase = side === "YES" ? bl?.believersYes : bl?.believersNo;
  const capBase = side === "YES" ? bl?.yesCapitalUsd : bl?.noCapitalUsd;
  const belChange =
    authBelievers != null && belBase != null ? windowChange(authBelievers, belBase) : null;
  const capChange =
    authCapitalUsd != null && capBase != null ? windowChange(authCapitalUsd, capBase) : null;

  const metricRows: { metric: LensMetric; label: string; value: string; pct: number | null }[] = [
    {
      metric: "believers",
      label: `${side} Believers`,
      value: (belChange != null ? authBelievers! : believersTotal).toLocaleString("en-US"),
      pct:
        belChange != null
          ? belChange.pct
          : believerMetric
            ? metricPct(believerMetric)
            : (summary?.believersPct ?? null),
    },
    {
      metric: "capital",
      label: `${side} Capital`,
      value:
        capChange != null
          ? format(authCapitalUsd!, "USD")
          : capitalUsd != null
            ? format(capitalUsd, "USD")
            : "—",
      pct:
        capChange != null
          ? capChange.pct
          : capitalMetric
            ? metricPct(capitalMetric)
            : (summary?.capitalPct ?? null),
    },
    {
      metric: "price",
      label: "Price",
      value: priceUsd != null ? format(priceUsd, "USD") : "—",
      pct: summary?.pricePct ?? null,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: the side. The timeframe is chosen once, in the center panel. */}
      <div className="mb-3 shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold" style={{ color }}>
            {side}
          </span>

          <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {FLOW_WINDOW_SHORT[win]}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        {/* ACT 1 — THE LENSES: pick what to investigate. The three metrics ARE the
          navigation — no tabs, no segmented control. Believers → Capital → Price
          mirrors how conviction forms: people, then money, then price. */}
        <div
          className="space-y-0.5"
          role="radiogroup"
          aria-label={`${side} — choose a metric to chart`}
        >
          {metricRows.map((r) => (
            <MetricRow
              key={r.metric}
              icon={LENS_META[r.metric].icon}
              label={r.label}
              value={r.value}
              pct={r.pct}
              active={metric === r.metric}
              color={color}
              onSelect={() => setDeckLens(r.metric)}
            />
          ))}
        </div>

        {/* ACT 2 — THE ONE CHART: titled, single-metric, with a sentence that always
          matches what's drawn. Switching lens crossfades inside LensChart. */}
        <div className="space-y-2">
          <LensChart
            side={side}
            metric={metric}
            kind={meta.kind}
            series={series}
            markers={[]}
            coldStart={coldStart}
          />
          <p
            key={metric}
            className="animate-in fade-in duration-200 text-[12px] leading-snug text-[var(--text-secondary)] motion-reduce:animate-none"
          >
            {lensSentence}
          </p>
        </div>

        {/* ACT 3 — RECENT ACTIVITY: always on, independent of the chosen lens.
          Name + amount only — the side is the panel, so we never repeat it. */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Recent activity
          </span>
          {recent.length === 0 ? (
            <p className="px-0.5 text-[11px] text-[var(--text-muted)]">No activity yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {recent.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-[12px]">
                  <PersonAvatar wallet={e.wallet} name={e.name} avatarUrl={e.avatarUrl} size={22} />
                  <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">
                    <span className="text-[var(--text)]">{e.name}</span>{" "}
                    <span style={{ color: e.action === "BUY" ? color : "var(--text-muted)" }}>
                      {e.action === "BUY" ? "bought" : "sold"}
                    </span>{" "}
                    <span className="num font-semibold text-[var(--text)]">
                      {tradeAmount(e.eth)}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[10px] text-[var(--text-muted)]">
                    {timeAgo(e.t)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ACT 4 — THE PEOPLE: one roster, one relationship badge, one status. */}
        <CaseRoster side={side} believers={believers} people={net?.people} priceUsd={priceUsd} />
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

/** A green/red/quiet % chip — the move over the selected window. Muted chips
 *  (an unselected lens) dim toward neutral while staying readable. */
export function PctChip({ pct, muted = false }: { pct: number | null; muted?: boolean }) {
  if (pct == null) return <span className="num text-[11px] text-[var(--text-muted)]">—</span>;
  const flat = Math.abs(pct) < 0.05;
  const color = flat ? "var(--text-muted)" : pct > 0 ? "var(--yes)" : "var(--no)";
  const arrow = flat ? "•" : pct > 0 ? "▲" : "▼";
  return (
    <span
      className="num shrink-0 text-[12px] font-semibold"
      style={{ color, opacity: muted ? 0.55 : 1 }}
    >
      {arrow} {Math.abs(pct).toFixed(pct !== 0 && Math.abs(pct) < 10 ? 1 : 0)}%
    </span>
  );
}

/**
 * One selectable lens. The whole row is the target (not a tiny icon); the active
 * lens brightens, grows its value, and gains an accent edge, while the others
 * stay muted but clearly tappable. Selection drives the single chart above.
 */
function MetricRow({
  icon,
  label,
  value,
  pct,
  active,
  color,
  onSelect,
}: {
  icon: string;
  label: string;
  value: string;
  pct: number | null;
  active: boolean;
  color: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-[10px] py-1.5 pr-2 text-left transition-colors hover:bg-[var(--surface-2)]"
      style={{
        paddingLeft: "8px",
        borderLeft: `2px solid ${active ? color : "transparent"}`,
        background: active ? `color-mix(in oklab, ${color} 7%, transparent)` : "transparent",
      }}
    >
      <span className="text-[15px]" aria-hidden style={{ opacity: active ? 1 : 0.55 }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="text-[10px] uppercase tracking-[0.1em]"
          style={{ color: active ? "var(--text-secondary)" : "var(--text-muted)" }}
        >
          {label}
        </div>
        <div
          className={`num font-semibold leading-tight tracking-[-0.01em] ${active ? "text-[19px]" : "text-[16px]"}`}
          style={{ color: active ? "var(--text)" : "var(--text-muted)" }}
        >
          {value}
        </div>
      </div>
      <PctChip pct={pct} muted={!active} />
    </button>
  );
}

/** The people, as one ranked roster — name, amount, and shared DNA when there is any. */
export function CaseRoster({
  side,
  believers,
  people,
  priceUsd,
}: {
  side: Side;
  believers: Believer[];
  people?: { wallet: string; relationship: string; agreement?: number; sharedBeliefs?: number }[];
  /** Live price per share on this side — used to value positions the indexer hasn't priced. */
  priceUsd?: number | null;
}) {
  const { format } = useMoney();
  const byWallet = useMemo(
    () => new Map((people ?? []).map((p) => [p.wallet.toLowerCase(), p])),
    [people],
  );
  const relOf = useMemo(() => (w: string) => byWallet.get(w)?.relationship ?? null, [byWallet]);
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
          {roster.map(({ believer: b, relationship }) => {
            const p = byWallet.get(b.wallet.toLowerCase());
            // Only a real overlap earns a DNA line — no "unmapped", no filler.
            const dna =
              p && (p.sharedBeliefs ?? 0) > 0 && Number.isFinite(p.agreement)
                ? `${Math.round(p.agreement as number)}% shared DNA`
                : null;
            // The indexed value can be missing (no valuation pass yet) — fall back
            // to shares × the side's live price so an amount always shows.
            const valueUsd =
              b.valueUsd > 0
                ? b.valueUsd
                : priceUsd != null && b.shares > 0
                  ? b.shares * priceUsd
                  : 0;
            const amount = valueUsd > 0 ? (valueUsd >= 1 ? format(valueUsd, "USD") : "<$1") : null;
            return (
              <li key={b.wallet} className="flex items-center gap-2 rounded-[8px] px-1 py-1">
                <PersonAvatar wallet={b.wallet} name={b.name} avatarUrl={b.avatarUrl} size={28} />

                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-[var(--text)]">{b.name}</div>
                  {dna && (
                    <div
                      className="num text-[10px] font-medium"
                      style={{ color: REL_TONE[relationship] }}
                    >
                      {dna}
                    </div>
                  )}
                </div>
                {amount && (
                  <span className="num shrink-0 text-[12px] font-semibold text-[var(--text)]">
                    {amount}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
