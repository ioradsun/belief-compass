/**
 * Conviction Timeline — the Case File's chart.
 *
 * A prediction market normally plots price. This plots how the belief FORMED:
 * three normalized curves on one axis so the eye answers, in a second, the only
 * question that matters before adding conviction —
 *
 *     did people lead, did money lead, or did price lead?
 *
 * 👥 believers (thickest, primary) → 💰 capital backed (medium) → 📈 price
 * (thinnest, secondary). All three start at zero and are plotted as % change
 * over the SAME window as everything else on screen, so leadership is visible
 * rather than inferred. Underneath, an event rail says what caused each move;
 * hovering the chart highlights the matching event and vice-versa.
 *
 * Presentation only: no fetch, no math beyond layout — the series and the rail
 * come from the pure domain module.
 */
import { useMemo, useState } from "react";
import type { SeriesPoint, TimelineEvent } from "@/domain/conviction-series";
import { fmtUsd } from "@/domain/order";

const W = 300;
const H = 96;
const PAD_Y = 10;

type Line = { key: "believers" | "capital" | "price"; label: string; emoji: string; width: number };

const LINES: Line[] = [
  { key: "believers", label: "Believers", emoji: "👥", width: 2.4 },
  { key: "capital", label: "Capital", emoji: "💰", width: 1.6 },
  { key: "price", label: "Price", emoji: "📈", width: 1 },
];

function valueAt(p: SeriesPoint, key: Line["key"]): number | null {
  return key === "believers" ? p.believersPct : key === "capital" ? p.capitalPct : p.pricePct;
}

/** Relative time, matching the feed's voice ("3m", "4h"). */
function ago(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function ConvictionTimeline({
  side,
  points,
  events,
  ethUsd,
  windowLabel,
  caption,
}: {
  side: "YES" | "NO";
  points: SeriesPoint[];
  events: TimelineEvent[];
  /** ETH→USD, so the rail can speak in dollars like the rest of the app. */
  ethUsd: number;
  windowLabel: string;
  caption: string | null;
}) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  const [hover, setHover] = useState<number | null>(null);
  const [activeEvent, setActiveEvent] = useState<string | null>(null);

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const vals: number[] = [];
    for (const p of points)
      for (const l of LINES) {
        const v = valueAt(p, l.key);
        if (v != null && Number.isFinite(v)) vals.push(v);
      }
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const range = Math.max(1, hi - lo);
    const x = (t: number) => ((t - t0) / span) * W;
    const y = (v: number) => H - PAD_Y - ((v - lo) / range) * (H - PAD_Y * 2);
    const paths: Record<Line["key"], string> = { believers: "", capital: "", price: "" };
    for (const l of LINES) {
      let d = "";
      let open = false;
      for (const p of points) {
        const v = valueAt(p, l.key);
        if (v == null || !Number.isFinite(v)) {
          open = false;
          continue;
        }
        d += `${open ? "L" : "M"}${x(p.t).toFixed(1)} ${y(v).toFixed(1)} `;
        open = true;
      }
      paths[l.key] = d.trim();
    }
    return { x, y, t0, t1, zeroY: y(0), paths };
  }, [points]);

  const now = points.length ? points[points.length - 1].t : Date.now();
  const usd = (eth?: number) => (eth == null ? null : fmtUsd(eth * (ethUsd || 0)));

  // Hover ↔ rail: the nearest event to the hovered instant lights up, and
  // selecting an event pins the crosshair to when it happened.
  const pinned = activeEvent ? (events.find((e) => e.id === activeEvent)?.t ?? null) : null;
  const cursorT = pinned ?? hover;
  const nearEventId = useMemo(() => {
    if (cursorT == null || events.length === 0) return null;
    let best = events[0];
    for (const e of events) if (Math.abs(e.t - cursorT) < Math.abs(best.t - cursorT)) best = e;
    return Math.abs(best.t - cursorT) < 45 * 60_000 ? best.id : null;
  }, [cursorT, events]);

  const cursorPoint =
    geo && cursorT != null
      ? points.reduce((a, b) => (Math.abs(b.t - cursorT) < Math.abs(a.t - cursorT) ? b : a))
      : null;

  return (
    <div className="mb-4 shrink-0">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          How conviction formed
        </span>
        <span className="num text-[10px] text-[var(--text-muted)]">{windowLabel}</span>
      </div>

      {geo == null ? (
        <div
          className="grid h-[96px] place-items-center rounded-[12px] text-[11px] text-[var(--text-muted)]"
          style={{ border: "1px solid var(--border)" }}
        >
          Not enough history on {side} yet.
        </div>
      ) : (
        <>
          <div className="rounded-[12px] p-1.5" style={{ border: "1px solid var(--border)" }}>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-[96px] w-full touch-none"
              role="img"
              aria-label={`Normalized ${side} conviction over ${windowLabel}: believers, capital backed and price`}
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
                setHover(geo.t0 + f * (geo.t1 - geo.t0));
                setActiveEvent(null);
              }}
              onPointerLeave={() => setHover(null)}
            >
              {/* Zero line — every curve starts here, so "above" always means growth. */}
              <line
                x1="0"
                x2={W}
                y1={geo.zeroY}
                y2={geo.zeroY}
                stroke="var(--border)"
                strokeWidth="1"
              />
              {/* Where each rail event happened, as quiet ticks. */}
              {events.map((e) => (
                <line
                  key={e.id}
                  x1={geo.x(e.t)}
                  x2={geo.x(e.t)}
                  y1={H - 4}
                  y2={H}
                  stroke={nearEventId === e.id ? color : "var(--text-muted)"}
                  strokeWidth={nearEventId === e.id ? 2 : 1}
                  opacity={nearEventId === e.id ? 1 : 0.4}
                />
              ))}
              {LINES.map((l) => (
                <path
                  key={l.key}
                  d={geo.paths[l.key]}
                  fill="none"
                  stroke={l.key === "believers" ? color : "var(--text-secondary)"}
                  strokeWidth={l.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={l.key === "price" ? 0.55 : l.key === "capital" ? 0.8 : 1}
                  strokeDasharray={l.key === "price" ? "3 3" : undefined}
                />
              ))}
              {cursorPoint && (
                <line
                  x1={geo.x(cursorPoint.t)}
                  x2={geo.x(cursorPoint.t)}
                  y1="0"
                  y2={H}
                  stroke="var(--text-muted)"
                  strokeWidth="1"
                  opacity="0.6"
                />
              )}
            </svg>
          </div>

          {/* Legend doubles as the readout: at rest it shows the window's total
            move, on hover the value at the cursor. Same order as the story. */}
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {LINES.map((l) => {
              const p = cursorPoint ?? points[points.length - 1];
              const v = valueAt(p, l.key);
              return (
                <span key={l.key} className="text-[10px] text-[var(--text-muted)]">
                  {l.emoji} {l.label}{" "}
                  <span
                    className="num font-semibold"
                    style={{
                      color:
                        v == null
                          ? "var(--text-muted)"
                          : v > 0
                            ? "var(--yes)"
                            : v < 0
                              ? "var(--no)"
                              : "var(--text-secondary)",
                    }}
                  >
                    {v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(v >= 100 ? 0 : 1)}%`}
                  </span>
                </span>
              );
            })}
          </div>

          {caption && (
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-secondary)]">
              {caption}
            </p>
          )}
        </>
      )}

      {/* Event rail — the chart says what happened, this says why. */}
      <div className="mt-2 space-y-0.5">
        {events.length === 0 ? (
          <p className="text-[11px] text-[var(--text-muted)]">
            Nothing moved on {side} in this window.
          </p>
        ) : (
          events.map((e) => {
            const on = activeEvent === e.id || nearEventId === e.id;
            const money = usd(e.eth);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setActiveEvent((v) => (v === e.id ? null : e.id))}
                onPointerEnter={() => setActiveEvent(e.id)}
                className="flex w-full items-baseline gap-1.5 rounded-[8px] px-1 py-1 text-left transition-colors"
                style={{
                  background: on ? `color-mix(in oklab, ${color} 10%, transparent)` : undefined,
                }}
              >
                <span aria-hidden className="text-[11px]">
                  {e.emoji}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text)]">
                  {money ? `${money} ${e.text}` : e.text}
                </span>
                <span className="num shrink-0 text-[10px] text-[var(--text-muted)]">
                  {ago(e.t, now)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
