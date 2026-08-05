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
import { useEffect, useMemo, useRef, useState } from "react";
import { setDeckLens, useDeckLens } from "@/lib/deck-lens";
import { useQuery } from "@tanstack/react-query";
import { getMarketEvidence, type Believer } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { getMarketChange, getMarketBaselines, type VolumeWindow } from "@/lib/markets.functions";
import { windowChange } from "@/domain/window-change";
import { LiveTape } from "@/components/LiveTape";
import { LensChart } from "@/components/LensChart";
import type { MarketRow } from "@/components/MarketCard";
import { useAnchorRect, anchorStyle, type AnchorBox } from "@/hooks/useAnchorRect";
import { useMoney } from "@/lib/display-unit";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Clock, DollarSign } from "lucide-react";

import {
  LENS_META,
  lensColdStart,
  type LensMetric,
} from "@/domain/side-lens";
import { FLOW_WINDOW_PHRASE, FLOW_WINDOW_SHORT } from "@/domain/market-flow";
export { WindowFilter } from "@/components/WindowFilter";
import { useDeckWindow } from "@/lib/deck-window";
import { marketBook, type BookMetric } from "@/domain/market-book";
import { seededBelievers } from "@/lib/market-state/read-model";
import { rankBelievers, sideCaseSummary, type CaseRelationship } from "@/domain/case-file";
import { sideChangeLine, sideStateLine } from "@/domain/side-summary";
import { convictionStory, narrateStory } from "@/domain/conviction-series";

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

/** Neutral sentence where only the words YES / NO carry a side colour. */
function SideWords({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\bYES\b|\bNO\b)/g).map((part, i) =>
        part === "YES" || part === "NO" ? (
          <span key={i} style={{ color: part === "YES" ? "var(--yes)" : "var(--no)" }}>
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

const num = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);


export function CaseColumn({
  side,
  marketId,
  row,
  viewerWallet,
  ethUsd = 0,
  compactRoster = false,
}: {
  side: Side;
  marketId: number;
  row: MarketRow;
  viewerWallet?: string;
  /** Live ETH/USD, so money reads in dollars like the rest of the app. */
  ethUsd?: number;
  /** Mobile: collapse the roster into an Instagram-style face pile. */
  compactRoster?: boolean;
}) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  // The shared timeframe: YES and NO always quote the same period so they compare.
  const win = useDeckWindow();
  const { format } = useMoney();

  // A different market's case starts at the top — but WITHOUT a remount. The
  // route used to force one with `key={onchain_id}` purely to reset this
  // scroll, which threw away both rails' DOM and every query observer on every
  // market change just to set one number back to zero. Setting it directly is
  // the whole job.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [marketId]);

  // Same query keys the deck already runs → React Query dedupes, no new requests.
  const { data: evidence } = useQuery({
    queryKey: ["evidence", marketId],
    queryFn: () => getMarketEvidence({ data: { marketId } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    // Per-market key: never bridge the previous market's believers into this one.
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
    // Per-market key: see above.
  });

  const tape = change?.tape;
  const summary = useMemo(
    () => (tape?.length ? sideCaseSummary(tape, side, win, Date.now()) : null),
    [tape, side, win],
  );

  const believers = (evidence?.believers ?? []).filter((b) => b.side === side);

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
  const rawBelievers =
    believerMetric?.current ?? num(side === "YES" ? rr.believers_yes : rr.believers_no) ?? 0;
  const capitalUsd =
    capitalMetric != null
      ? capitalMetric.current * (ethUsd || 0)
      : num(side === "YES" ? rr.yes_capital_usd : rr.no_capital_usd);
  // Capital on this side means someone stands behind it — the market's initial
  // investment isn't an indexed position, so never show "0 believers, $13".
  const believersTotal = seededBelievers(rawBelievers, capitalUsd);
  // PRICE IS AUTHORITATIVE, NOT TAPE-DERIVED. The tape carries each trade's
  // post-trade `newPrice`, which spikes and collapses inside a single whale
  // round-trip; reading it as "the price" makes a market that has been flat for
  // hours report a huge fall. The market_state row (and its snapshots) is the
  // price people actually see and trade at, so the panel reads that first.
  const authPriceUsd = num(side === "YES" ? rr.yes_price_usd : rr.no_price_usd);
  const priceUsd =
    authPriceUsd ?? (summary?.priceEth != null ? summary.priceEth * (ethUsd || 0) : null);

  // ── The one chart, one lens ─────────────────────────────────────────────────
  // Believers is always the default lens — conviction.company is about people
  // first. The selection is component state, so changing the timeframe never
  // resets which lens you're investigating.
  const metric = useDeckLens();
  const series = useMemo(() => summary?.series ?? [], [summary]);
  // The one shared formatter: capital/proceeds are ETH-native, POV worth is USD —
  // each renders in the viewer's chosen unit through the single global rate.
  const money = useMemo(() => (eth: number) => format(eth, "ETH"), [format]);
  const coldStart = lensColdStart(metric, series);
  const meta = LENS_META[metric];






  // Prefer the AUTHORITATIVE current (market_state row) + the snapshot baseline for
  // the selected window: correct even on a >1000-trade market where the tape can't
  // reach the window's opening state. When either is unavailable, fall back to the
  // tape-derived marketBook figures (identical on the ~all non-truncated markets).
  const bl = baselines?.[win as VolumeWindow];
  const authBelievers = num(side === "YES" ? rr.believers_yes : rr.believers_no);
  const authCapitalUsd = num(side === "YES" ? rr.yes_capital_usd : rr.no_capital_usd);
  const belBase = side === "YES" ? bl?.believersYes : bl?.believersNo;
  const capBase = side === "YES" ? bl?.yesCapitalUsd : bl?.noCapitalUsd;
  const priceBaseUsd = side === "YES" ? bl?.yesPriceUsd : bl?.noPriceUsd;
  const belChange =
    authBelievers != null && belBase != null ? windowChange(authBelievers, belBase) : null;
  const capChange =
    authCapitalUsd != null && capBase != null ? windowChange(authCapitalUsd, capBase) : null;
  // Same rule for price: measure the snapshot at the window's open against the
  // price now, never the tape's transient post-trade marks.
  const priceChange =
    authPriceUsd != null && priceBaseUsd != null && priceBaseUsd > 0
      ? windowChange(authPriceUsd, priceBaseUsd)
      : null;

  // The exact move, in the metric's own unit — never a percentage alone. This
  // mirrors the Total Market instrument: the total leads, the % is the big
  // right-hand figure, and the absolute change states what actually happened.
  const phrase = FLOW_WINDOW_PHRASE[win];
  const belDelta = belChange?.delta ?? believerMetric?.delta ?? null;
  const capDelta =
    capChange?.delta ?? (capitalMetric != null ? capitalMetric.delta * (ethUsd || 0) : null);
  const pricePct =
    priceChange != null ? priceChange.pct : authPriceUsd != null ? null : (summary?.pricePct ?? null);
  const priceDelta =
    priceChange != null
      ? priceChange.delta
      : priceUsd != null && pricePct != null && Number.isFinite(priceUsd)
        ? priceUsd - priceUsd / (1 + pricePct / 100)
        : null;

  // THE PULSE — one headline for the window plus the sentence that explains it.
  // It reads the same authoritative price move the metric row shows, so the
  // summary can never contradict the numbers under it.
  const pulse = useMemo(() => {
    // Half a cent, expressed in ETH: anything smaller renders as $0.00, so it
    // must not generate a capital story.
    const capitalDust = ethUsd > 0 ? 0.005 / ethUsd : 1e-9;
    const st = summary
      ? convictionStory(side, summary.series, { capitalDust, pricePct })
      : null;
    if (!st) return null;
    return { headline: st.headline, narrative: narrateStory(st, side, FLOW_WINDOW_PHRASE[win], money) };
  }, [summary, side, win, money, ethUsd, pricePct]);


  // Supporting copy only when something actually moved. "No change today" /
  // "Flat today" is filler — whitespace says it better.
  const believerAbs =
    belDelta == null || belDelta === 0
      ? null
      : `${belDelta > 0 ? "+" : "−"}${Math.abs(belDelta)} believer${Math.abs(belDelta) === 1 ? "" : "s"} ${phrase}`;
  const capitalAbs =
    capDelta == null || Math.abs(capDelta) < 0.005
      ? null
      : `${format(capDelta, "USD", { signed: true })} ${capDelta > 0 ? "committed" : "left"} ${phrase}`;
  const priceAbs =
    priceDelta == null || Math.abs(priceDelta) < 0.005
      ? null
      : `${format(priceDelta, "USD", { signed: true })} per share ${phrase}`;

  // The two sentences that lead the panel: what this side IS, and what changed.
  const stateLine = sideStateLine(side, believersTotal);
  const changeLine = sideChangeLine({
    side,
    belDelta,
    capDelta,
    priceDelta,
    phrase,
    money: (usd) => format(usd, "USD"),
  });


  const metricRows: {
    metric: LensMetric;
    label: string;
    value: string;
    pct: number | null;
    absolute: string | null;
  }[] = [
    {
      metric: "believers",
      label: `${side} Believers`,
      // One source of holders: the authoritative per-side count, else the roster
      // we actually list. Never the tape-derived tally — it can drift from the
      // holder table and make the headline disagree with the names below it.
      value: (authBelievers ?? believers.length).toLocaleString("en-US"),
      pct:
        belChange != null
          ? belChange.pct
          : believerMetric
            ? metricPct(believerMetric)
            : (summary?.believersPct ?? null),
      absolute: believerAbs,
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
      absolute: capitalAbs,
    },
    {
      metric: "price",
      label: "Price",
      value: priceUsd != null ? format(priceUsd, "USD") : "—",
      pct: pricePct,
      absolute: priceAbs,
    },
  ];


  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header IS the headline: the pulse for the window when there is one,
        otherwise just the side. Either way the side name is said once, never
        twice. The timeframe is chosen in the center panel and quoted here. */}
      <div className="mb-3 shrink-0">
        <div className="flex items-baseline gap-3">
          <h3 className="min-w-0 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[var(--text)]">
            {pulse ? (
              <SideWords text={pulse.headline} />
            ) : (
              <span style={{ color }}>{side}</span>
            )}
          </h3>
          <span className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {FLOW_WINDOW_SHORT[win]}
          </span>
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-scroll pr-0.5">
        {/* 1 — CURRENT STATE: what this side IS, in plain language, before any
          metric. When something moved in the window, one sentence says what. */}
        <div className="space-y-1">
          {pulse ? (
            <>
              <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                <SideWords text={pulse.narrative} />
              </p>
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                <SideWords text={stateLine} />
              </p>
            </>
          ) : (
            <>
              <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                <SideWords text={stateLine} />
              </p>
              {changeLine && (
                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                  <SideWords text={changeLine} />
                </p>
              )}
            </>
          )}
        </div>


        {/* 2 — SNAPSHOT: the three essential metrics. They double as the chart's
          lens selector — no tabs, no segmented control. Supporting copy appears
          only when the metric actually moved. */}
        <div
          className="space-y-0.5"
          role="radiogroup"
          aria-label={`${side} — choose a metric to chart`}
        >
          {metricRows.map((r) => (
            <MetricRow
              key={r.metric}
              label={r.label}
              value={r.value}
              pct={r.pct}
              absolute={r.absolute}
              active={metric === r.metric}
              color={color}
              onSelect={() => setDeckLens(r.metric)}
            />
          ))}
        </div>

        {/* The chart carries no caption: the headline and the metric row above
          already say what moved and by how much. */}
        <LensChart
          side={side}
          metric={metric}
          kind={meta.kind}
          series={series}
          markers={[]}
          coldStart={coldStart}
        />

        {/* 3 — BELIEVERS: the people currently backing this side. */}
        <CaseRoster
          side={side}
          believers={believers}
          people={net?.people}
          priceUsd={priceUsd}
          variant={compactRoster ? "compact" : "list"}
        />

        {/* 4 — RECENT ACTIVITY: the same tape the app-wide feed runs, scoped to
          this side. The column already says YES, so sentences don't repeat it. */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Recent activity
          </span>
          <LiveTape
            marketIds={[marketId]}
            side={side}
            wallet={viewerWallet}
            scroll={false}
            showTitles={false}
            limit={24}
            skeletonRows={3}
            emptyText="No moves on this side yet."
          />
        </div>
      </div>

    </div>
  );
}

/** One headline total with its window-relative % change. */
export function StatRow({
  label,
  value,
  pct,
}: {
  label: string;
  value: string;
  pct: number | null;
}) {
  return (
    <div className="flex items-center gap-2.5">
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
  const color = flat ? "var(--text-muted)" : pct > 0 ? "var(--gain)" : "var(--loss)";
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
 * One selectable lens, read the same way as the Total Market instrument:
 * the current total leads on the left, the window's % change is the big figure
 * on the right (arrow trailing), the label sits beneath, and the EXACT absolute
 * move states what actually happened — a % never travels alone. The active lens
 * brightens and gains an accent edge; the others stay muted but tappable.
 */
function MetricRow({
  label,
  value,
  pct,
  absolute,
  active,
  color,
  onSelect,
}: {
  label: string;
  value: string;
  pct: number | null;
  /** The exact change in the metric's own unit, e.g. "+$12.40 committed over 24H". */
  absolute?: string | null;
  active: boolean;
  color: string;
  onSelect: () => void;
}) {
  const flat = pct == null || Math.abs(pct) < 0.05;
  const tone = flat ? "var(--text-muted)" : pct! > 0 ? "var(--gain)" : "var(--loss)";
  const arrow = flat ? "" : pct! > 0 ? "▲" : "▼";
  const pctText =
    pct == null ? "" : `${Math.abs(pct).toFixed(!flat && Math.abs(pct) < 10 ? 1 : 0)}%`;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className="w-full rounded-[10px] py-2 pr-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"
      style={{
        paddingLeft: "8px",
        borderLeft: `2px solid ${active ? color : "transparent"}`,
        background: active ? `color-mix(in oklab, ${color} 7%, transparent)` : "transparent",
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={`num min-w-0 truncate font-semibold leading-none tracking-[-0.02em] ${active ? "text-[22px]" : "text-[18px]"}`}
            style={{ color: active ? "var(--text)" : "var(--text-muted)" }}
          >
            {value}
          </span>
        </span>
        <span
          className={`num shrink-0 font-semibold leading-none tabular-nums ${active ? "text-[19px]" : "text-[15px]"}`}
          style={{ color: tone, opacity: active ? 1 : 0.6 }}
        >
          {pctText}
          {arrow && pctText ? <span className="ml-1 align-middle text-[0.6em]">{arrow}</span> : null}
        </span>
      </div>
      <div
        className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: active ? "var(--text-secondary)" : "var(--text-muted)" }}
      >
        {label}
      </div>
      {absolute && (
        <div
          className="num mt-0.5 text-[11px]"
          style={{ color: "var(--text-muted)", opacity: active ? 1 : 0.6 }}
        >
          <span style={{ color: tone }}>{absolute.split(" ")[0]}</span>
          {absolute.slice(absolute.split(" ")[0].length)}
        </div>
      )}

    </button>
  );
}


/** Time held, at a glance: hours until a day has passed, then whole days. */
function heldLabel(daysHeld: number): string {
  if (!Number.isFinite(daysHeld) || daysHeld <= 0) return "new";
  if (daysHeld < 1) return `${Math.max(1, Math.round(daysHeld * 24))}h`;
  return `${Math.round(daysHeld)}d`;
}

/** How many believers the panel previews before "+N more". */
const PREVIEW = 5;

/** The people, as one ranked roster — name, amount, and shared DNA when there is any. */
export function CaseRoster({
  side,
  believers,
  people,
  priceUsd,
  variant = "list",
}: {
  side: Side;
  believers: Believer[];
  people?: { wallet: string; relationship: string; agreement?: number; sharedBeliefs?: number }[];
  /** Live price per share on this side — used to value positions the indexer hasn't priced. */
  priceUsd?: number | null;
  /** "compact" = Instagram-likers face pile (mobile); "list" = full roster. */
  variant?: "compact" | "list";
}) {
  const { format } = useMoney();
  const [openAll, setOpenAll] = useState(false);
  const { ref: anchorRef, box: anchorBox } = useAnchorRect<HTMLDivElement>(openAll);
  const byWallet = useMemo(
    () => new Map((people ?? []).map((p) => [p.wallet.toLowerCase(), p])),
    [people],
  );
  const relOf = useMemo(() => (w: string) => byWallet.get(w)?.relationship ?? null, [byWallet]);
  const roster = useMemo(() => rankBelievers(believers, relOf), [believers, relOf]);

  const renderRows = (list: typeof roster) => (
    <ul className="space-y-0.5">
      {list.map(({ believer: b, relationship }) => {
        const p = byWallet.get(b.wallet.toLowerCase());
        // Only a real overlap earns a DNA line — no "unmapped", no filler.
        const dna =
          p && (p.sharedBeliefs ?? 0) > 0 && Number.isFinite(p.agreement)
            ? `${Math.round(p.agreement as number)}% shared DNA`
            : null;
        // The indexed value can be missing (no valuation pass yet) — fall back
        // to shares × the side's live price so an amount always shows.
        const valueUsd =
          b.valueUsd > 0 ? b.valueUsd : priceUsd != null && b.shares > 0 ? b.shares * priceUsd : 0;
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
            <span className="num w-[52px] shrink-0 text-right text-[12px] font-semibold text-[var(--text)]">
              {amount ?? "—"}
            </span>
            {/* Conviction = how long they have stayed in. Time held is the one
              thing money cannot fake, so it earns its own column. */}
            <span
              className="num w-[34px] shrink-0 text-right text-[11px] text-[var(--text-muted)]"
              title={`Held ${heldLabel(b.daysHeld)}`}
            >
              {heldLabel(b.daysHeld)}
            </span>
          </li>
        );
      })}
    </ul>
  );

  // The list variant previews the strongest few; "+N more" opens the rest.
  const allRows = renderRows(roster);
  const rows = variant === "compact" ? allRows : renderRows(roster.slice(0, PREVIEW));

  return (
    <div ref={anchorRef} className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Believers
        </span>
        {roster.length > 0 && (
          <span className="num text-[10px] text-[var(--text-muted)]">{roster.length}</span>
        )}
      </div>
      {/* Icon column heads — the row grammar (who · how much · how long) without
        three words of chrome. */}
      {roster.length > 0 && variant !== "compact" && (
        <div className="flex items-center gap-2 px-1 pb-0.5 text-[var(--text-muted)]">
          <span className="w-[28px] shrink-0" aria-hidden />
          <span className="min-w-0 flex-1" aria-hidden />
          <span className="flex w-[52px] shrink-0 justify-end" title="Position">
            <DollarSign size={11} aria-label="Position" />
          </span>
          <span className="flex w-[34px] shrink-0 justify-end" title="Conviction — time held">
            <Clock size={11} aria-label="Conviction, time held" />
          </span>
        </div>
      )}
      {roster.length === 0 ? (
        <p className="px-0.5 text-[11px] text-[var(--text-muted)]">No one on this side yet.</p>
      ) : variant === "compact" ? (
        <>
          <FacePile roster={roster} onOpenAll={() => setOpenAll(true)} />
          {openAll && (
            <RosterSheet side={side} count={roster.length} onClose={() => setOpenAll(false)} anchor={anchorBox}>
              {rows}
            </RosterSheet>
          )}
        </>
      ) : (
        <>
          {rows}
          {roster.length > PREVIEW && (
            <button
              type="button"
              onClick={() => setOpenAll(true)}
              className="px-1 text-[12px] text-[var(--text-secondary)] underline-offset-2 hover:underline"
            >
              +{roster.length - PREVIEW} more
            </button>
          )}
          {openAll && (
            <RosterSheet side={side} count={roster.length} onClose={() => setOpenAll(false)} anchor={anchorBox}>
              {allRows}
            </RosterSheet>
          )}
        </>
      )}
    </div>
  );
}

/** Instagram-likers row: up to three faces, then a sentence that opens the full list. */
function FacePile({
  roster,
  onOpenAll,
}: {
  roster: { believer: Believer }[];
  onOpenAll: () => void;
}) {
  const faces = roster.slice(0, 3).map((r) => r.believer);
  const total = roster.length;
  const first = (n: string) => n.split(/\s+/)[0] || n;
  const sentence =
    total === 1
      ? `Backed by ${first(faces[0].name)}`
      : total === 2
        ? `Backed by ${first(faces[0].name)} and ${first(faces[1].name)}`
        : total === 3
          ? `Backed by ${first(faces[0].name)}, ${first(faces[1].name)} and ${first(faces[2].name)}`
          : `Backed by ${first(faces[0].name)}, ${first(faces[1].name)} and ${total - 2} others`;

  return (
    <div className="flex items-center gap-2">
      <div className="flex shrink-0 -space-x-2">
        {faces.map((b) => (
          <PersonAvatar
            key={b.wallet}
            wallet={b.wallet}
            name={b.name}
            avatarUrl={b.avatarUrl}
            size={24}
            className="ring-2 ring-[var(--bg)]"
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onOpenAll}
        className="min-w-0 flex-1 truncate text-left text-[12px] text-[var(--text-secondary)] underline-offset-2 hover:underline"
      >
        {sentence}
      </button>
    </div>
  );
}

/** Bottom sheet holding the complete roster — scrolls on its own, X to close. */
function RosterSheet({
  side,
  count,
  onClose,
  anchor,
  children,
}: {
  side: Side;
  count: number;
  onClose: () => void;
  /** Column the sheet opens over, so it never spans the whole viewport. */
  anchor: AnchorBox | null;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed bottom-0 top-0 z-50 flex flex-col"
      style={anchorStyle(anchor)}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      {/* Fills the column top to bottom: a pinned header over one scroll area,
        so the roster never resizes the sheet as it loads. */}
      <div className="relative mt-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-t-[16px] border-t border-[var(--border)] bg-[var(--bg)] pt-3">
        <div className="mb-2 flex shrink-0 items-center justify-between px-4">
          <span className="text-[12px] font-semibold text-[var(--text)]">
            Who backs {side} · <span className="num text-[var(--text-muted)]">{count}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-full px-2 py-1 text-[14px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
