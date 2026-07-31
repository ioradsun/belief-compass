/**
 * Conviction spark — the side card's primary signal, and nothing else.
 *
 * A Case File side card is a summary, so it plots ONE line: believers over the
 * active window. Money and price belong to the full timeline in the center. The
 * spark exists to answer "is this side's belief rising, flat or fading?" in a
 * glance; ticks mark where something happened, so the card hints at a story
 * without telling it.
 *
 * Presentation only — the series comes from the pure domain module.
 */
import type { SeriesPoint, TimelineEvent } from "@/domain/conviction-series";

const W = 120;
const H = 34;
const PAD = 3;

export function ConvictionSpark({
  side,
  points,
  events = [],
}: {
  side: "YES" | "NO";
  points: SeriesPoint[];
  events?: TimelineEvent[];
}) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  if (points.length < 2) {
    return (
      <div className="h-[34px] w-full rounded-[8px]" style={{ border: "1px dashed var(--border)" }} />
    );
  }
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const vals = points.map((p) => p.believersPct);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(1, ...vals);
  const range = Math.max(1, hi - lo);
  const x = (t: number) => PAD + ((t - t0) / span) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / range) * (H - PAD * 2);

  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.believersPct).toFixed(1)}`).join(" ");
  const area = `${d} L${x(t1).toFixed(1)} ${H - PAD} L${x(t0).toFixed(1)} ${H - PAD} Z`;
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[34px] w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Believer trend on ${side}`}
    >
      <path d={area} fill={`color-mix(in oklab, ${color} 14%, transparent)`} stroke="none" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {events.slice(0, 6).map((e) => (
        <circle key={e.id} cx={x(e.t)} cy={H - 1.5} r="1.2" fill="var(--text-muted)" opacity="0.7" />
      ))}
      <circle cx={x(last.t)} cy={y(last.believersPct)} r="2" fill={color} />
    </svg>
  );
}
