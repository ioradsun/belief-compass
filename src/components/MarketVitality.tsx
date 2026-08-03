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
import { useMemo, type ReactNode } from "react";
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
import { sparkDomain, SPARK_DOMAIN, type SparkDomainOpts } from "@/domain/spark-domain";
import { believerMove, capitalMove, type MetricMove } from "@/domain/metric-display";

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
  domain,
  className,
}: {
  points: VitalityPoint[];
  tone: string;
  /** Per-metric materiality floor so an immaterial move renders near-flat. */
  domain: SparkDomainOpts;
  className?: string;
}) {
  const vs = points.map((p) => p.v);
  const flat = points.length < 2 || Math.max(...vs) === Math.min(...vs);
  if (flat) return <FlatSpark className={className} />;

  const t0 = points[0].t;
  const t1 = Math.max(points[points.length - 1].t, t0 + 1);
  // Scale against a per-metric floor anchored on the window baseline (points[0]),
  // so a −2% or sub-percent move reads as a gentle slope, not a full-height crash.
  const dom = sparkDomain(vs, points[0].v, domain);
  const pad = (dom.max - dom.min) * 0.1;
  const min = dom.min - pad;
  const max = dom.max + pad;
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

// Believers and capital are turned into their two copy lines by the ONE shared
// metric-display rule (src/domain/metric-display): the count/money leads, the %
// is paired, and a % off a tiny base is kept quiet or dropped. These adapters just
// feed the canonical book metric into that rule.
const believerCopy = (m: BookMetric, w: BookWindow): MetricMove =>
  believerMove(m.current, m.base, w.since);

// Materiality (direction, the percentage floor) is judged in USD so a display in
// ETH never changes what counts as a real move; only the shown figure converts.
const capitalCopy = (
  m: BookMetric,
  w: BookWindow,
  usd: (eth: number) => number,
  money: CapFmt,
): MetricMove =>
  capitalMove({ currentEth: m.current, baseEth: m.base, since: w.since, usd, money });

/**
 * One full-width metric row inside the Total Market instrument: the current
 * total in large type on the left, the percentage change in large type on the
 * right, the metric label beneath, and the exact absolute change over the
 * selected timeframe beneath that. A faint full-width sparkline keeps the shape
 * of the move without turning the row back into a card.
 */
function MomentumMetric({
  total,
  label,
  copy,
  points,
  domain,
}: {
  total: string;
  label: string;
  copy: MetricMove;
  points: VitalityPoint[];
  domain: SparkDomainOpts;
}) {
  const tone = dirTone(copy.direction);
  const arrow = copy.direction === "up" ? "▲" : copy.direction === "down" ? "▼" : "";
  // Only a trusted (headline) % earns the big right-hand figure. A small-base %
  // is demoted to a quiet suffix on the absolute line so it never overstates the
  // move; with no % at all the headline space stays empty.
  const headlinePct = copy.pct && !copy.pctQuiet ? copy.pct : copy.direction === "flat" ? "0%" : "";
  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="num min-w-0 truncate text-[26px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)] sm:text-[30px]">
          {total}
        </span>
        <span
          className="num shrink-0 text-[22px] font-semibold leading-none tabular-nums sm:text-[26px]"
          style={{ color: tone }}
        >
          {arrow && headlinePct ? `${arrow} ` : ""}
          {headlinePct}
        </span>
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="num mt-0.5 text-[12px]" style={{ color: tone }}>
        {copy.absolute}
        {copy.pct && copy.pctQuiet && (
          <span className="ml-1.5 text-[var(--text-muted)]">· {copy.pct}</span>
        )}
      </div>
      <div className="mt-1.5 h-[18px] w-full opacity-60">
        <StepSpark points={points} tone={tone} domain={domain} className="h-full w-full" />
      </div>
    </div>
  );
}

export function MarketMomentum({
  tape,
  ethUsd,
  win,
  nowMs = Date.now(),
  footer,
}: {
  tape: TapeTrade[] | undefined;
  ethUsd: number;
  /** The one on-screen timeframe — every total, delta and spark quotes it. */
  win?: FlowWindow;
  nowMs?: number;
  /** The insight + Case File disclosure, rendered inside the same instrument. */
  footer?: ReactNode;
}) {
  const book = useMemo(() => marketBook(tape ?? [], nowMs, win), [tape, nowMs, win]);
  const { unit } = useDisplayUnit();
  const usd = (eth: number) => eth * (ethUsd > 0 ? ethUsd : 0);
  // Capital is ETH-native; one rate takes it to the viewer's chosen display unit.
  const money: CapFmt = (eth, signed) =>
    formatMoney(eth, { from: "ETH", to: unit, ethUsd, signed });

  const b = book.believers.market;
  const c = book.capitalEth.market;

  // ONE analytical container: heading → believers → cap → insight → Case File.
  // No floating typography, no nested cards — a single market instrument.
  return (
    <section
      aria-label="Total market"
      className="shrink-0 overflow-hidden rounded-[16px]"
      style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
    >
      <div className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] sm:px-5">
        Total market
      </div>
      <MomentumMetric
        total={b.current.toLocaleString("en-US")}
        label="Believers"
        copy={believerCopy(b, book.window)}
        points={b.series}
        domain={SPARK_DOMAIN.believers}
      />
      <div className="border-t border-[var(--hairline)]" aria-hidden />
      <MomentumMetric
        total={money(c.current)}
        label="Total market cap"
        copy={capitalCopy(c, book.window, usd, money)}
        points={c.series}
        domain={SPARK_DOMAIN.capital}
      />
      {footer && (
        <>
          <div className="border-t border-[var(--hairline)]" aria-hidden />
          {footer}
        </>
      )}
    </section>
  );
}
