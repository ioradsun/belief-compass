/**
 * CENTER — Market Momentum: the timeless read of "how big and which way?"
 *
 * Two compact metric rows — believers and capital (value · capped sparkline ·
 * percentage) — plus a one-word status pill for the shape. This is the only
 * momentum surface; the story (the narrative sentence, the House voice, the
 * activity) lives in the right feed. The center never becomes a feed.
 *
 * Every number is read off the canonical marketBook, so the totals reconcile with
 * the side panels; the label comes from marketPulse — existing calculations,
 * unchanged. Side-blind by construction. The SAME component renders on desktop and
 * mobile; only the layout (and the sparkline size) changes.
 */
import { useMemo } from "react";
import {
  marketBook,
  type BookMetric,
  type BookWindow,
  type VitalityPoint,
} from "@/domain/market-book";
import type { TapeTrade } from "@/domain/conviction-series";
import type { FlowWindow } from "@/domain/market-flow";
import { formatMoney } from "@/domain/money";
import { useDisplayUnit } from "@/lib/display-unit";

/** Below these bases a percentage is noise, so we show the absolute change only. */
const BELIEVER_PCT_MIN = 1;
const CAPITAL_PCT_MIN_USD = 1;

const dirTone = (d: "up" | "down" | "flat"): string =>
  d === "up" ? "var(--yes)" : d === "down" ? "var(--no)" : "var(--text-muted)";

/** Formats an ETH-native capital amount in the viewer's chosen unit. */
type CapFmt = (eth: number, signed?: boolean) => string;

// The sparkline answers only up / down / flat. Its box is set by the caller's
// wrapper (small inline on mobile, wider on desktop); the path fills it.
const SPARK_W = 300;
const SPARK_H = 46;

function FlatSpark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
    >
      <line
        x1="1"
        y1={SPARK_H / 2}
        x2={SPARK_W - 1}
        y2={SPARK_H / 2}
        stroke="var(--border)"
        strokeWidth="1.4"
        strokeDasharray="3 4"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** An event-driven step line, tinted by the window's direction. No axes/fills. */
function StepSpark({
  points,
  tone,
  className,
}: {
  points: VitalityPoint[];
  tone: string;
  className?: string;
}) {
  const vs = points.map((p) => p.v);
  const flat = points.length < 2 || Math.max(...vs) === Math.min(...vs);
  if (flat) return <FlatSpark className={className} />;

  const t0 = points[0].t;
  const t1 = Math.max(points[points.length - 1].t, t0 + 1);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const pad = (hi - lo) * 0.12;
  const min = lo - pad;
  const max = hi + pad;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * (SPARK_W - 2) + 1;
  const y = (v: number) => SPARK_H - 2 - ((v - min) / (max - min || 1)) * (SPARK_H - 4);

  let d = `M ${x(points[0].t).toFixed(2)} ${y(points[0].v).toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${x(points[i].t).toFixed(2)} ${y(points[i - 1].v).toFixed(2)}`;
    d += ` L ${x(points[i].t).toFixed(2)} ${y(points[i].v).toFixed(2)}`;
  }
  const last = points[points.length - 1];
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={d} fill="none" stroke={tone} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      {points.length <= 2 && <circle cx={x(last.t)} cy={y(last.v)} r="2.4" fill={tone} />}
    </svg>
  );
}

interface RowCopy {
  /** e.g. "+14%" or null when the base is too small to be meaningful. */
  pct: string | null;
  /** e.g. "+1 believer over 24H" / "First believer" / "No change over 24H". */
  absolute: string;
  direction: "up" | "down" | "flat";
}

/** Turn a metric + its cold-start context into the row's two copy lines. */
function believerCopy(m: BookMetric, w: BookWindow): RowCopy {
  const direction = m.delta > 0 ? "up" : m.delta < 0 ? "down" : "flat";
  if (m.base === 0 && m.current > 0) {
    return m.current === 1
      ? { pct: null, absolute: "First believer", direction: "up" }
      : { pct: null, absolute: `+${m.current} believers ${w.since}`, direction: "up" };
  }
  const pct =
    m.base >= BELIEVER_PCT_MIN
      ? `${m.delta >= 0 ? "+" : "−"}${Math.round((Math.abs(m.delta) / m.base) * 100)}%`
      : null;
  if (m.delta === 0)
    return { pct: pct ? "0%" : null, absolute: `No change ${w.since}`, direction: "flat" };
  const n = Math.abs(m.delta);
  return {
    pct,
    absolute: `${m.delta > 0 ? "+" : "−"}${n} believer${n === 1 ? "" : "s"} ${w.since}`,
    direction,
  };
}

// Materiality (direction, the percentage floor) is judged in USD so a display in
// ETH never changes what counts as a real move; only the shown figure converts.
function capitalCopy(
  m: BookMetric,
  w: BookWindow,
  usd: (eth: number) => number,
  money: CapFmt,
): RowCopy {
  const baseUsd = usd(m.base);
  const deltaUsd = usd(m.delta);
  const direction = deltaUsd > 0.5 ? "up" : deltaUsd < -0.5 ? "down" : "flat";
  if (baseUsd < 0.5 && usd(m.current) > 0.5) {
    return { pct: null, absolute: `First capital · ${money(m.current)}`, direction: "up" };
  }
  const pct =
    baseUsd >= CAPITAL_PCT_MIN_USD
      ? `${deltaUsd >= 0 ? "+" : "−"}${Math.round((Math.abs(deltaUsd) / baseUsd) * 100)}%`
      : null;
  if (direction === "flat")
    return { pct: pct ? "0%" : null, absolute: `No change ${w.since}`, direction: "flat" };
  return {
    pct,
    absolute: `${money(m.delta, true)} committed ${w.since}`,
    direction,
  };
}

/**
 * One metric row: value + unit on the left, a capped sparkline + the percentage
 * pinned to the endpoint on the right, an absolute change beneath. On mobile the
 * sparkline shrinks and the absolute line hides unless it carries the only signal
 * (cold-start, when there's no percentage). Below ~380px the chart drops before
 * the percentage — the percentage carries more per pixel.
 */
function MomentumMetric({
  total,
  unit,
  copy,
  points,
}: {
  total: string;
  unit: string;
  copy: RowCopy;
  points: VitalityPoint[];
}) {
  const tone = dirTone(copy.direction);
  const arrow = copy.direction === "up" ? "▲" : copy.direction === "down" ? "▼" : "";
  const trend = copy.pct ?? (copy.direction === "flat" ? "0%" : "");
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="num text-[19px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)] sm:text-[21px]">
            {total}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
            {unit}
          </span>
        </div>
        {/* pl-6 guarantees clear air between the label and the chart so the
          sparkline can never butt against "believers" / "committed". */}
        <div className="ml-auto flex shrink-0 items-center gap-2 pl-6">
          <div className="hidden h-[22px] w-[72px] shrink-0 min-[380px]:block sm:h-[44px] sm:w-[168px]">
            <StepSpark points={points} tone={tone} className="h-full w-full" />
          </div>
          <span
            className="num shrink-0 text-[13px] font-semibold tabular-nums"
            style={{ color: tone }}
          >
            {arrow ? `${arrow} ` : ""}
            {trend}
          </span>
        </div>
      </div>
      <div
        className={`num mt-0.5 text-[11px] ${copy.pct ? "hidden sm:block" : ""}`}
        style={{ color: tone }}
      >
        {copy.absolute}
      </div>
    </div>
  );
}

export function MarketMomentum({
  tape,
  ethUsd,
  win,
  nowMs = Date.now(),
}: {
  tape: TapeTrade[] | undefined;
  ethUsd: number;
  /** The one on-screen timeframe — every total, delta and spark quotes it. */
  win?: FlowWindow;
  nowMs?: number;
}) {
  const book = useMemo(() => marketBook(tape ?? [], nowMs, win), [tape, nowMs, win]);
  const { unit } = useDisplayUnit();
  const usd = (eth: number) => eth * (ethUsd > 0 ? ethUsd : 0);
  // Capital is ETH-native; one rate takes it to the viewer's chosen display unit.
  const money: CapFmt = (eth, signed) =>
    formatMoney(eth, { from: "ETH", to: unit, ethUsd, signed });

  const b = book.believers.market;
  const c = book.capitalEth.market;

  // Just the shape — two metric rows. No momentum word, no narrative: the
  // sparklines and percentages already say which way and how hard. The momentum
  // story is the tension teaser on the Case File door; the voice is in the feed.
  return (
    <section aria-label="Market momentum" className="space-y-2.5">
      <MomentumMetric
        total={b.current.toLocaleString("en-US")}
        unit="believers"
        copy={believerCopy(b, book.window)}
        points={b.series}
      />
      <MomentumMetric
        total={money(c.current)}
        unit="committed"
        copy={capitalCopy(c, book.window, usd, money)}
        points={c.series}
      />
    </section>
  );
}
