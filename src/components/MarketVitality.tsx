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
  momentumView,
  vitalityStory,
  type MarketVitality,
  type MomentumDirection,
  type MomentumView,
  type VitalityPoint,
} from "@/domain/market-vitality";
import type { TapeTrade } from "@/domain/conviction-series";

/** Direction → the movement tint. Green = market growing, red = shrinking, muted
 *  = steady. Side-blind: this is the WHOLE market's movement, never YES/NO. */
const directionTone = (d: MomentumDirection): string =>
  d === "up" ? "var(--yes)" : d === "down" ? "var(--no)" : "var(--text-muted)";

const fmtMoney = (usd: number) =>
  usd >= 1000 ? `$${Math.round(usd).toLocaleString("en-US")}` : `$${usd.toFixed(usd < 10 ? 2 : 0)}`;

const agoLabel = (ms: number) => {
  const s = Math.max(0, ms / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172_800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

const SPARK_W = 168;
const SPARK_H = 24;

/**
 * A calm dashed baseline for "no movement" — steady should LOOK steady, and read
 * distinctly from "no data" (which shows nothing at all higher up).
 */
function FlatSpark() {
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="mt-1.5 h-[24px] w-full"
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

/**
 * A step line, TINTED by direction (green rising / red falling), so the shape and
 * the colored delta agree. No axes, grid, or markers — supporting evidence only.
 * A dead-flat series falls back to the dashed baseline so it never masquerades as
 * a trend.
 */
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
  const single = points.length <= 2;

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="mt-1.5 h-[24px] w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={d} fill="none" stroke={tone} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {single && <circle cx={x(last.t)} cy={y(last.v)} r="2" fill={tone} />}
    </svg>
  );
}

function Metric({
  value,
  label,
  momentum,
  cold,
  points,
}: {
  value: string;
  label: string;
  momentum: MomentumView | null;
  cold: string | null;
  points: VitalityPoint[];
}) {
  const tone = momentum ? directionTone(momentum.direction) : "var(--text-muted)";
  return (
    <div className="min-w-0">
      <div className="num text-[28px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)]">
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      {/* The movement line — colored by direction (cold copy stays muted). */}
      <div
        className="num mt-1 text-[11px] font-medium"
        style={{ color: cold ? "var(--text-muted)" : tone }}
      >
        {cold ?? momentum?.text ?? " "}
      </div>
      {cold ? <div className="h-[24px]" aria-hidden /> : <StepSpark points={points} tone={tone} />}
    </div>
  );
}

export function MarketVitalityPanel({
  tape,
  ethUsd,
  nowMs = Date.now(),
  showStory = true,
}: {
  tape: TapeTrade[] | undefined;
  ethUsd: number;
  nowMs?: number;
  /** When false, the calm relationship sentence is owned by Pulse instead. */
  showStory?: boolean;
}) {
  const v: MarketVitality = useMemo(() => marketVitality(tape ?? [], nowMs), [tape, nowMs]);
  const usd = (eth: number) => eth * (ethUsd > 0 ? ethUsd : 0);
  const rangeWords = v.range.label.toLowerCase().replace("past ", "");

  const empty = v.lastEventAt == null;
  const oneBeliever = !empty && v.believers === 1 && v.believerEvents <= 1;
  const oneCapital = !empty && v.capitalEvents === 1;

  const believerMomentum = momentumView({
    delta: v.believersDelta,
    base: v.believers - v.believersDelta,
    rangeWords,
    fmt: (n) => n.toLocaleString("en-US"),
    minBaseForPct: 8,
  });
  const capitalUsdDelta = usd(v.capitalDeltaEth);
  const capitalMomentum = momentumView({
    delta: capitalUsdDelta,
    base: usd(v.capitalEth) - capitalUsdDelta,
    rangeWords,
    fmt: fmtMoney,
    eps: 1,
    minBaseForPct: 25,
  });

  return (
    <section aria-label="Market vitality">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <Metric
          value={v.believers.toLocaleString("en-US")}
          label={v.believers === 1 ? "Believer" : "Believers"}
          momentum={believerMomentum}
          cold={
            empty
              ? "Waiting for the first believer"
              : oneBeliever && v.firstBelieverAt
                ? `First believer joined ${agoLabel(nowMs - v.firstBelieverAt)}`
                : null
          }
          points={v.believersSeries}
        />
        <Metric
          value={fmtMoney(usd(v.capitalEth))}
          label="Capital committed"
          momentum={capitalMomentum}
          cold={
            empty
              ? "No capital committed yet"
              : oneCapital
                ? `First conviction backed with ${fmtMoney(usd(v.capitalEth))}`
                : null
          }
          points={v.capitalSeries}
        />
      </div>

      {showStory && (
        <p className="mt-3 text-[13px] leading-snug text-[var(--text-secondary)]">
          {vitalityStory(v)}
        </p>
      )}
      {!empty && (
        <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {v.range.label}
        </p>
      )}
    </section>
  );
}
