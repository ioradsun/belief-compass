/**
 * MOVEMENT LINE — your side, growing into something larger.
 *
 * After you back a side, this shows the movement it belongs to by its UNIQUE
 * believers (never capital — one whale can't fake a crowd) and how close it is
 * to the next stage: Spark → Forming → Tribe → Movement. A quiet nudge toward
 * collective progress, not a points bar.
 */
import { movementProgress } from "@/domain/movement";

export function MovementLine({
  believers,
  side,
  className = "",
}: {
  believers: number;
  side: "YES" | "NO";
  className?: string;
}) {
  const m = movementProgress(believers);
  const tone = side === "YES" ? "var(--yes)" : "var(--no)";

  return (
    <div
      className={`rounded-[12px] px-3.5 py-2.5 ${className}`}
      style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: tone }}
        >
          {m.label}
        </span>
        <span className="num text-[11px] text-[var(--text-muted)]">
          {m.believers} believer{m.believers === 1 ? "" : "s"}
        </span>
      </div>
      {m.nextStage && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--bg)]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.round(m.progress * 100)}%`,
              background: tone,
              transition: "width .3s ease",
            }}
          />
        </div>
      )}
      <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{m.note}</div>
    </div>
  );
}
