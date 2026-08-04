/**
 * LensChart — the ONE chart in a side panel. It never shows believers, capital
 * and price at once; it draws exactly the metric the reader selected, titled so
 * they always know what they're looking at.
 *
 * Believers and capital move in discrete steps (someone enters, someone exits),
 * so they're drawn as step lines. Price re-rates continuously, so it's a smooth
 * line. Up to two markers annotate the biggest real moves. Switching metric
 * crossfades (the keyed wrapper replays a ~180ms fade) so the panel feels calm,
 * like flipping between lenses rather than reloading a dashboard.
 *
 * Presentation only — every value and marker comes from the pure side-lens engine.
 * The SVG uses a normalized 0–100 viewBox with non-scaling strokes, so the line
 * stays crisp at any width while markers are laid out as pixel-perfect HTML.
 */
import { lensValue, type LensMarker, type LensMetric } from "@/domain/side-lens";
import type { SeriesPoint } from "@/domain/conviction-series";
import { sparkDomain, SPARK_DOMAIN } from "@/domain/spark-domain";

// Vertical breathing room (in viewBox %) so the line never hugs the edges and
// markers near the top/bottom stay legible.
const TOP = 14;
const BOTTOM = 92;

export function LensChart({
  side,
  metric,
  title,
  kind,
  series,
  markers,
  coldStart,
}: {
  side: "YES" | "NO";
  metric: LensMetric;
  /** Optional heading. Omit for a bare, label-free spark. */
  title?: string;
  kind: "step" | "line";
  series: SeriesPoint[];
  markers: LensMarker[];
  /** When set, we lack the history to draw an honest chart — show this instead. */
  coldStart: string | null;
}) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";

  return (
    <div>
      {title ? (
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {title}
          </span>
        </div>
      ) : null}
      {/* Keyed on metric → the wrapper remounts and replays the crossfade. */}
      <div key={metric} className="animate-in fade-in duration-200 motion-reduce:animate-none">
        {coldStart ? (
          <ColdStart text={coldStart} />
        ) : (
          <Plot
            side={side}
            color={color}
            kind={kind}
            metric={metric}
            series={series}
            markers={markers}
          />
        )}
      </div>
    </div>
  );
}

function ColdStart({ text }: { text: string }) {
  return (
    <div
      className="grid h-[92px] w-full place-items-center rounded-[10px] px-4 text-center"
      style={{ border: "1px dashed var(--border)" }}
    >
      <p className="whitespace-pre-line text-[11px] leading-snug text-[var(--text-muted)]">
        {text}
      </p>
    </div>
  );
}

function Plot({
  side,
  color,
  kind,
  metric,
  series,
  markers,
}: {
  side: "YES" | "NO";
  color: string;
  kind: "step" | "line";
  metric: LensMetric;
  series: SeriesPoint[];
  markers: LensMarker[];
}) {
  // Price only draws where it exists; steps use every point.
  const pts = (metric === "price" ? series.filter((p) => p.price != null) : series)
    .map((p) => ({ t: p.t, v: lensValue(p, metric) }))
    .filter((p): p is { t: number; v: number } => p.v != null);

  if (pts.length < 2) return <ColdStart text="Too new to chart." />;

  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const vals = pts.map((p) => p.v);
  // Materiality: scale against a per-metric floor anchored on the window baseline
  // (pts[0]), so a move the headline calls "flat / 0%" renders flat instead of
  // being stretched to full height. A genuinely large move still fills the box.
  const { min: lo, max: hi } = sparkDomain(vals, pts[0].v, SPARK_DOMAIN[metric]);
  const range = Math.max(1e-9, hi - lo);
  const x = (t: number) => ((t - t0) / span) * 100;
  const y = (v: number) => BOTTOM - ((v - lo) / range) * (BOTTOM - TOP);

  // Step-after for discrete metrics; straight segments for price.
  let d = `M${x(pts[0].t).toFixed(2)} ${y(pts[0].v).toFixed(2)}`;
  for (let i = 1; i < pts.length; i += 1) {
    const px = x(pts[i].t).toFixed(2);
    if (kind === "step") d += ` L${px} ${y(pts[i - 1].v).toFixed(2)}`;
    d += ` L${px} ${y(pts[i].v).toFixed(2)}`;
  }
  const area = `${d} L${x(t1).toFixed(2)} 100 L${x(t0).toFixed(2)} 100 Z`;

  return (
    <div className="relative h-[92px] w-full">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full overflow-visible"
        role="img"
        aria-label={`${metric} trend on ${side}`}
      >
        <path d={area} fill={`color-mix(in oklab, ${color} 12%, transparent)`} stroke="none" />
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Markers as crisp HTML overlays — positioned by %, never distorted. */}
      {markers.map((m, i) => {
        const mx = Math.min(96, Math.max(4, x(m.t)));
        const mColor =
          m.dir === "up" ? "var(--yes)" : m.dir === "down" ? "var(--no)" : "var(--text-muted)";
        return (
          <div
            key={`${m.t}-${i}`}
            className="pointer-events-none absolute -translate-x-1/2"
            style={{ left: `${mx}%`, top: 0 }}
          >
            <span
              className="num whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
              style={{
                color: mColor,
                background: `color-mix(in oklab, ${mColor} 14%, transparent)`,
              }}
            >
              {m.label}
            </span>
          </div>
        );
      })}
      {/* The now-point, so the eye lands on where the side stands today. */}
      <span
        className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ left: `${x(t1)}%`, top: `${y(pts[pts.length - 1].v)}%`, background: color }}
        aria-hidden
      />
    </div>
  );
}
