/**
 * CENTER — Market Momentum.
 *
 * Two STACKED rows — Market Believers, then Market Capital — read as one story:
 * people, then money, then (in Pulse) meaning. Stacking (not side by side) avoids
 * a false red-vs-green contest, since believers and capital are not opposing
 * sides. Every number comes from the canonical marketBook, so the center totals
 * reconcile exactly with the two side panels. Side-blind by construction.
 */
import { useMemo } from "react";
import { marketBook, type BookMetric, type BookWindow } from "@/domain/market-book";
import type { TapeTrade } from "@/domain/conviction-series";
import type { VitalityPoint } from "@/domain/market-vitality";

/** Below these bases a percentage is noise, so we show the absolute change only. */
const BELIEVER_PCT_MIN = 5;
const CAPITAL_PCT_MIN_USD = 10;

const dirTone = (d: "up" | "down" | "flat"): string =>
  d === "up" ? "var(--yes)" : d === "down" ? "var(--no)" : "var(--text-muted)";

const fmtMoney = (usd: number) =>
  usd >= 1000 ? `$${Math.round(usd).toLocaleString("en-US")}` : `$${usd.toFixed(usd < 10 ? 2 : 0)}`;

const SPARK_W = 168;
const SPARK_H = 26;

function FlatSpark() {
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="mt-1.5 h-[26px] w-full"
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
function StepSpark({ points, tone }: { points: VitalityPoint[]; tone: string }) {
  const vs = points.map((p) => p.v);
  const flat = points.length < 2 || Math.max(...vs) === Math.min(...vs);
  if (flat) return <FlatSpark />;

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
      className="mt-1.5 h-[26px] w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={d} fill="none" stroke={tone} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      {points.length <= 2 && <circle cx={x(last.t)} cy={y(last.v)} r="2" fill={tone} />}
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

function capitalCopy(m: BookMetric, w: BookWindow, usd: (eth: number) => number): RowCopy {
  const baseUsd = usd(m.base);
  const deltaUsd = usd(m.delta);
  const direction = deltaUsd > 0.5 ? "up" : deltaUsd < -0.5 ? "down" : "flat";
  if (baseUsd < 0.5 && usd(m.current) > 0.5) {
    return { pct: null, absolute: `First capital · ${fmtMoney(usd(m.current))}`, direction: "up" };
  }
  const pct =
    baseUsd >= CAPITAL_PCT_MIN_USD
      ? `${deltaUsd >= 0 ? "+" : "−"}${Math.round((Math.abs(deltaUsd) / baseUsd) * 100)}%`
      : null;
  if (direction === "flat")
    return { pct: pct ? "0%" : null, absolute: `No change ${w.since}`, direction: "flat" };
  return {
    pct,
    absolute: `${deltaUsd > 0 ? "+" : "−"}${fmtMoney(Math.abs(deltaUsd))} committed ${w.since}`,
    direction,
  };
}

function MomentumRow({
  total,
  label,
  copy,
  points,
}: {
  total: string;
  label: string;
  copy: RowCopy;
  points: VitalityPoint[];
}) {
  const tone = dirTone(copy.direction);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="num text-[21px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)]">
            {total}
          </span>
          <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
            {label}
          </span>
        </div>
        {copy.pct && (
          <span
            className="num shrink-0 text-[13px] font-semibold tabular-nums"
            style={{ color: tone }}
          >
            {copy.direction === "up" ? "▲ " : copy.direction === "down" ? "▼ " : ""}
            {copy.pct}
          </span>
        )}
      </div>
      <div className="num mt-0.5 text-[11px]" style={{ color: tone }}>
        {copy.absolute}
      </div>
      <StepSpark points={points} tone={tone} />
    </div>
  );
}

export function MarketMomentum({
  tape,
  ethUsd,
  nowMs = Date.now(),
}: {
  tape: TapeTrade[] | undefined;
  ethUsd: number;
  nowMs?: number;
}) {
  const book = useMemo(() => marketBook(tape ?? [], nowMs), [tape, nowMs]);
  const usd = (eth: number) => eth * (ethUsd > 0 ? ethUsd : 0);

  const b = book.believers.market;
  const c = book.capitalEth.market;

  return (
    <section aria-label="Market momentum" className="space-y-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Market Momentum · {book.window.short}
      </div>
      <MomentumRow
        total={b.current.toLocaleString("en-US")}
        label="Market Believers"
        copy={believerCopy(b, book.window)}
        points={b.series}
      />
      <MomentumRow
        total={fmtMoney(usd(c.current))}
        label="Market Capital"
        copy={capitalCopy(c, book.window, usd)}
        points={c.series}
      />
    </section>
  );
}
