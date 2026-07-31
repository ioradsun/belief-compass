/**
 * Conviction Index — the product's primary visual language.
 *
 * One line, not three. The number is the transparent blend of people, money and
 * price, and the chart is a STEP chart because nothing happens between trades:
 * the line holds flat, then jumps, and every jump has a stated reason.
 *
 * Under the line the three drivers are always shown, so no one has to wonder
 * where the score came from. Hovering a jump shows "66 → 70" plus what caused
 * it; clicking a jump highlights the matching event and vice-versa.
 *
 * Presentation only — the arithmetic lives in the pure domain module.
 */
import { useMemo, useState } from "react";
import type { IndexStep } from "@/domain/conviction-index";
import { INDEX_WEIGHTS } from "@/domain/conviction-index";
import { fmtUsd } from "@/domain/order";

const W = 300;
const H = 96;
const PAD_Y = 10;

function ago(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const clock = (t: number) =>
  new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function ConvictionIndexChart({
  side,
  opening,
  steps,
  ethUsd,
  windowLabel,
  caption,
}: {
  side: "YES" | "NO";
  opening: IndexStep | null;
  steps: IndexStep[];
  /** ETH→USD, so reasons can speak in dollars like the rest of the app. */
  ethUsd: number;
  windowLabel: string;
  caption: string | null;
}) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  const [activeId, setActiveId] = useState<string | null>(null);

  const current = steps.length ? steps[steps.length - 1] : opening;
  const now = current?.t ?? Date.now();
  const usd = (eth: number) => fmtUsd(eth * (ethUsd || 0));

  const geo = useMemo(() => {
    if (!opening) return null;
    const pts = [opening, ...steps];
    const t0 = pts[0].t;
    const t1 = Math.max(pts[pts.length - 1].t, t0 + 1);
    const vals = pts.map((p) => p.index);
    const lo = Math.max(0, Math.min(...vals) - 6);
    const hi = Math.min(100, Math.max(...vals) + 6);
    const range = Math.max(1, hi - lo);
    const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
    const y = (v: number) => H - PAD_Y - ((v - lo) / range) * (H - PAD_Y * 2);
    // Step path: hold the previous value, then jump vertically at the event.
    let d = `M0 ${y(pts[0].index).toFixed(1)} `;
    for (const p of pts.slice(1)) {
      d += `L${x(p.t).toFixed(1)} ${y(p.from).toFixed(1)} L${x(p.t).toFixed(1)} ${y(p.index).toFixed(1)} `;
    }
    d += `L${W} ${y(pts[pts.length - 1].index).toFixed(1)}`;
    return { x, y, d, pts };
  }, [opening, steps]);

  const active = activeId ? (steps.find((s) => s.id === activeId) ?? null) : null;

  return (
    <div className="mb-4 shrink-0">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Conviction Index
        </span>
        <span className="num text-[10px] text-[var(--text-muted)]">{windowLabel}</span>
      </div>

      {/* The number itself — the one thing to read first. */}
      <div className="mb-1.5 flex items-baseline gap-2">
        <span
          className="num text-[30px] font-semibold leading-none tracking-[-0.02em]"
          style={{ color }}
        >
          {current ? Math.round(current.index) : "—"}
        </span>
        {opening && current && Math.abs(current.index - opening.index) >= 0.5 && (
          <span
            className="num text-[11px] font-medium"
            style={{ color: current.index > opening.index ? "var(--yes)" : "var(--no)" }}
          >
            {current.index > opening.index ? "▲" : "▼"}{" "}
            {Math.abs(current.index - opening.index).toFixed(1)} · {windowLabel}
          </span>
        )}
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
              aria-label={`Conviction Index for ${side} over ${windowLabel}, as a step chart`}
              onPointerLeave={() => setActiveId(null)}
            >
              <path
                d={geo.d}
                fill="none"
                stroke={color}
                strokeWidth="2.2"
                strokeLinejoin="miter"
                strokeLinecap="square"
              />
              {steps.map((s) => {
                const on = activeId === s.id;
                return (
                  <g key={s.id}>
                    {/* Wide invisible hit area — jumps are thin. */}
                    <rect
                      x={geo.x(s.t) - 7}
                      y={0}
                      width={14}
                      height={H}
                      fill="transparent"
                      onPointerEnter={() => setActiveId(s.id)}
                      onClick={() => setActiveId(s.id)}
                      style={{ cursor: "pointer" }}
                    />
                    <circle
                      cx={geo.x(s.t)}
                      cy={geo.y(s.index)}
                      r={on ? 3.4 : 2}
                      fill={color}
                      opacity={on ? 1 : 0.75}
                      pointerEvents="none"
                    />
                    {on && (
                      <line
                        x1={geo.x(s.t)}
                        x2={geo.x(s.t)}
                        y1="0"
                        y2={H}
                        stroke="var(--text-muted)"
                        strokeWidth="1"
                        opacity="0.5"
                        pointerEvents="none"
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Hover readout — "66 → 70" and exactly why. */}
          {active && (
            <div
              className="mt-1.5 rounded-[10px] px-2 py-1.5 text-[11px]"
              style={{ background: `color-mix(in oklab, ${color} 10%, transparent)` }}
            >
              <div className="num flex items-baseline gap-2 text-[var(--text)]">
                <span className="text-[var(--text-muted)]">{clock(active.t)}</span>
                <span className="font-semibold">
                  {Math.round(active.from)} → {Math.round(active.index)}
                </span>
              </div>
              <div className="mt-0.5 text-[var(--text-secondary)]">
                {active.emoji} {active.text}
                {active.ethIn > 0 ? ` · +${usd(active.ethIn)} backed` : ""}
                {active.ethOut > 0 ? ` · −${usd(active.ethOut)} left` : ""}
                {active.pricePct != null && Math.abs(active.pricePct) >= 0.1
                  ? ` · price ${active.pricePct > 0 ? "+" : ""}${active.pricePct.toFixed(1)}%`
                  : ""}
              </div>
            </div>
          )}

          {/* Driver breakdown — the score always shows its own arithmetic. */}
          <div className="mt-2 space-y-1">
            {(
              [
                ["👥", "Believers", (active ?? current)?.believerScore, INDEX_WEIGHTS.believers],
                ["💰", "Capital", (active ?? current)?.capitalScore, INDEX_WEIGHTS.capital],
                ["📈", "Price", (active ?? current)?.priceScore, INDEX_WEIGHTS.price],
              ] as const
            ).map(([emoji, label, value, weight]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-[86px] shrink-0 text-[11px] text-[var(--text-muted)]">
                  {emoji} {label}
                </span>
                <span className="h-1.5 min-w-0 flex-1 rounded-full" style={{ background: "var(--border)" }}>
                  <span
                    className="block h-1.5 rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, value ?? 0))}%`,
                      background: color,
                      opacity: 0.55 + weight,
                    }}
                  />
                </span>
                <span className="num w-[28px] shrink-0 text-right text-[11px] font-semibold text-[var(--text)]">
                  {value == null ? "—" : Math.round(value)}
                </span>
              </div>
            ))}
            <p className="text-[10px] text-[var(--text-muted)]">
              40% believers + 40% capital + 20% price
            </p>
          </div>

          {caption && (
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-secondary)]">{caption}</p>
          )}
        </>
      )}

      {/* Event rail — every jump, in words. */}
      <div className="mt-2 space-y-0.5">
        {steps.length === 0 ? (
          <p className="text-[11px] text-[var(--text-muted)]">
            Nothing moved on {side} in this window.
          </p>
        ) : (
          [...steps]
            .reverse()
            .slice(0, 12)
            .map((s) => {
              const on = activeId === s.id;
              const up = s.index >= s.from;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveId((v) => (v === s.id ? null : s.id))}
                  onPointerEnter={() => setActiveId(s.id)}
                  className="flex w-full items-baseline gap-1.5 rounded-[8px] px-1 py-1 text-left transition-colors"
                  style={{
                    background: on ? `color-mix(in oklab, ${color} 10%, transparent)` : undefined,
                  }}
                >
                  <span aria-hidden className="text-[11px]">
                    {s.emoji}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text)]">
                    {s.text}
                    {s.ethIn > 0 ? ` · ${usd(s.ethIn)}` : ""}
                  </span>
                  <span
                    className="num shrink-0 text-[10px] font-semibold"
                    style={{ color: up ? "var(--yes)" : "var(--no)" }}
                  >
                    {Math.round(s.from)}→{Math.round(s.index)}
                  </span>
                  <span className="num shrink-0 text-[10px] text-[var(--text-muted)]">
                    {ago(s.t, now)}
                  </span>
                </button>
              );
            })
        )}
      </div>
    </div>
  );
}
