/**
 * CENTER — neutral market vitality.
 *
 * Two market-level metrics (people, money) with event-driven step sparklines and
 * one calm sentence about their relationship. Everything here is side-blind by
 * construction: the YES/NO split lives in the Case File, not the center.
 */
import { useMemo } from "react";
import {
  marketVitality,
  vitalityStory,
  type MarketVitality,
  type VitalityPoint,
} from "@/domain/market-vitality";
import type { TapeTrade } from "@/domain/conviction-series";

const fmtMoney = (usd: number) =>
  usd >= 1000 ? `$${Math.round(usd).toLocaleString("en-US")}` : `$${usd.toFixed(usd < 10 ? 2 : 0)}`;

const agoLabel = (ms: number) => {
  const s = Math.max(0, ms / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172_800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

/** A step line. No axes, no grid, no markers — supporting evidence only. */
function StepSpark({ points, tone }: { points: VitalityPoint[]; tone: string }) {
  const W = 168;
  const H = 28;
  if (points.length < 2) return <div className="h-[28px]" aria-hidden />;
  const t0 = points[0].t;
  const t1 = Math.max(points[points.length - 1].t, t0 + 1);
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const pad = hi === lo ? Math.max(1, Math.abs(hi) * 0.05) : (hi - lo) * 0.12;
  const min = lo - pad;
  const max = hi + pad;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * (W - 2) + 1;
  const y = (v: number) => H - 2 - ((v - min) / (max - min || 1)) * (H - 4);

  let d = `M ${x(points[0].t).toFixed(2)} ${y(points[0].v).toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${x(points[i].t).toFixed(2)} ${y(points[i - 1].v).toFixed(2)}`;
    d += ` L ${x(points[i].t).toFixed(2)} ${y(points[i].v).toFixed(2)}`;
  }
  const last = points[points.length - 1];
  const single = points.length <= 2 && points[0].v !== last.v;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-2 h-[28px] w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={d} fill="none" stroke={tone} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      {single && <circle cx={x(last.t)} cy={y(last.v)} r="2" fill={tone} />}
    </svg>
  );
}

function Metric({
  value,
  label,
  delta,
  cold,
  points,
  tone,
}: {
  value: string;
  label: string;
  delta: string | null;
  cold: string | null;
  points: VitalityPoint[];
  tone: string;
}) {
  return (
    <div className="min-w-0">
      <div className="num text-[30px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)]">
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="num mt-1 text-[11px] text-[var(--text-secondary)]">
        {cold ?? delta ?? " "}
      </div>
      {cold ? <div className="h-[28px]" aria-hidden /> : <StepSpark points={points} tone={tone} />}
    </div>
  );
}

export function MarketVitalityPanel({
  tape,
  ethUsd,
  nowMs = Date.now(),
}: {
  tape: TapeTrade[] | undefined;
  ethUsd: number;
  nowMs?: number;
}) {
  const v: MarketVitality = useMemo(() => marketVitality(tape ?? [], nowMs), [tape, nowMs]);
  const usd = (eth: number) => eth * (ethUsd > 0 ? ethUsd : 0);
  const rangeWords = v.range.label.toLowerCase().replace("past ", "");

  const empty = v.lastEventAt == null;
  const oneBeliever = !empty && v.believers === 1 && v.believerEvents <= 1;
  const oneCapital = !empty && v.capitalEvents === 1;

  const believerDelta =
    v.believersDelta === 0
      ? `No change over ${rangeWords}`
      : `${v.believersDelta > 0 ? "+" : "−"}${Math.abs(v.believersDelta)} over ${rangeWords}`;
  const capitalUsdDelta = usd(v.capitalDeltaEth);
  const capitalDelta =
    Math.abs(capitalUsdDelta) < 1
      ? `No change over ${rangeWords}`
      : `${capitalUsdDelta > 0 ? "+" : "−"}${fmtMoney(Math.abs(capitalUsdDelta))} over ${rangeWords}`;

  return (
    <section aria-label="Market vitality">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <Metric
          value={v.believers.toLocaleString("en-US")}
          label={v.believers === 1 ? "Believer" : "Believers"}
          delta={believerDelta}
          cold={
            empty
              ? "Waiting for the first believer"
              : oneBeliever && v.firstBelieverAt
                ? `First believer joined ${agoLabel(nowMs - v.firstBelieverAt)}`
                : null
          }
          points={v.believersSeries}
          tone="var(--text-secondary)"
        />
        <Metric
          value={fmtMoney(usd(v.capitalEth))}
          label="Capital committed"
          delta={capitalDelta}
          cold={
            empty
              ? "No capital committed yet"
              : oneCapital
                ? `First conviction backed with ${fmtMoney(usd(v.capitalEth))}`
                : null
          }
          points={v.capitalSeries}
          tone="var(--text-secondary)"
        />
      </div>

      <p className="mt-3 text-[13px] leading-snug text-[var(--text-secondary)]">
        {vitalityStory(v)}
      </p>
      {!empty && (
        <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {v.range.label}
        </p>
      )}
    </section>
  );
}
