import { DOMAINS, type Domain } from "@/domain/categories";
import type { CircleSummary } from "@/lib/circles.functions";

interface Props {
  circles: CircleSummary[];
  size?: number;
}

/**
 * Radial "conviction fingerprint" — one spoke per domain.
 * Missing spokes render as faint dashed stubs (RULE 1: honesty gate).
 */
export function Fingerprint({ circles, size = 260 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const rMax = size / 2 - 24;
  const byDomain = new Map<Domain, CircleSummary>(circles.map((c) => [c.domain, c]));

  const points: string[] = [];
  const stubs: JSX.Element[] = [];
  const labels: JSX.Element[] = [];
  const spokeEls: JSX.Element[] = [];

  DOMAINS.forEach((dom, i) => {
    const angle = (i / DOMAINS.length) * Math.PI * 2 - Math.PI / 2;
    const c = byDomain.get(dom);
    const score = c?.top_ally?.match_score;
    const ok = c && !c.insufficient && typeof score === "number";
    const r = ok ? (Math.max(0, Math.min(100, score!)) / 100) * rMax : rMax * 0.15;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    points.push(`${x},${y}`);

    // axis line
    spokeEls.push(
      <line
        key={`ax-${dom}`}
        x1={cx} y1={cy}
        x2={cx + Math.cos(angle) * rMax}
        y2={cy + Math.sin(angle) * rMax}
        stroke="currentColor"
        strokeOpacity={0.08}
      />
    );

    if (!ok) {
      const sx = cx + Math.cos(angle) * (rMax * 0.35);
      const sy = cy + Math.sin(angle) * (rMax * 0.35);
      stubs.push(
        <line
          key={`stub-${dom}`}
          x1={cx} y1={cy} x2={sx} y2={sy}
          stroke="currentColor" strokeOpacity={0.25}
          strokeDasharray="3 3"
        />
      );
    }

    const lx = cx + Math.cos(angle) * (rMax + 14);
    const ly = cy + Math.sin(angle) * (rMax + 14);
    labels.push(
      <text
        key={`lb-${dom}`}
        x={lx} y={ly}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={9}
        className="fill-muted-foreground"
        style={{ opacity: ok ? 1 : 0.5 }}
      >
        {dom}
      </text>
    );
  });

  return (
    <svg width={size} height={size} className="text-foreground">
      {/* rings */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={cx} cy={cy} r={rMax * f}
          fill="none" stroke="currentColor" strokeOpacity={0.06} />
      ))}
      {spokeEls}
      {stubs}
      <polygon
        points={points.join(" ")}
        fill="hsl(var(--primary) / 0.15)"
        stroke="hsl(var(--primary))"
        strokeWidth={1.5}
      />
      {labels}
    </svg>
  );
}
