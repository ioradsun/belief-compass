/**
 * Conviction spark — one signal's shape over the active window.
 *
 * Defaults to believers (the side card's primary line), but plots any of the
 * three real signals — believers, capital, or price — so the full timeline can
 * show all three as themselves, never a synthetic blend. Ticks mark where
 * something happened, so a spark hints at a story without telling it.
 *
 * Presentation only — the series comes from the pure domain module.
 */
import type { SeriesPoint, TimelineEvent } from "@/domain/conviction-series";

const W = 120;
const H = 34;
const PAD = 3;

type Metric = "believers" | "capital" | "price";
const valOf = (p: SeriesPoint, m: Metric): number =>
  m === "capital" ? p.capitalPct : m === "price" ? (p.pricePct ?? 0) : p.believersPct;

export function ConvictionSpark({
  side,
  points,
  events = [],
  metric = "believers",
}: {
  side: "YES" | "NO";
  points: SeriesPoint[];
  events?: TimelineEvent[];
  metric?: Metric;
}) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  if (points.length < 2) {
    return (
      <div
        className="h-[34px] w-full rounded-[8px]"
        style={{ border: "1px dashed var(--border)" }}
      />
    );
  }
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const vals = points.map((p) => valOf(p, metric));
  const lo = Math.min(0, ...vals);
  const hi = Math.max(1, ...vals);
  const range = Math.max(1, hi - lo);
  const x = (t: number) => PAD + ((t - t0) / span) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / range) * (H - PAD * 2);

  const d = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(valOf(p, metric)).toFixed(1)}`)
    .join(" ");
  const area = `${d} L${x(t1).toFixed(1)} ${H - PAD} L${x(t0).toFixed(1)} ${H - PAD} Z`;
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[34px] w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${metric} trend on ${side}`}
    >
      <path d={area} fill={`color-mix(in oklab, ${color} 14%, transparent)`} stroke="none" />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {events.slice(0, 6).map((e) => (
        <circle
          key={e.id}
          cx={x(e.t)}
          cy={H - 1.5}
          r="1.2"
          fill="var(--text-muted)"
          opacity="0.7"
        />
      ))}
      <circle cx={x(last.t)} cy={y(valOf(last, metric))} r="2" fill={color} />
    </svg>
  );
}
