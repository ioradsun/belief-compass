import { cn } from "@/lib/utils";

/**
 * Sparkline — instrument direction only, so green/red are legitimate here.
 * Neutral tone for anything that is not an instrument price.
 */
export function Sparkline({
  points,
  tone = "neutral",
  width = 64,
  height = 20,
  className,
}: {
  points: number[];
  tone?: "yes" | "no" | "neutral";
  width?: number;
  height?: number;
  className?: string;
}) {
  if (points.length < 2) {
    return <span className={cn("inline-block", className)} style={{ width, height }} />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${(height - ((p - min) / span) * height).toFixed(2)}`)
    .join(" ");

  const stroke =
    tone === "yes" ? "var(--yes)" : tone === "no" ? "var(--no)" : "var(--text-secondary)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
      className={cn("overflow-visible", className)}
    >
      <path d={d} stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
