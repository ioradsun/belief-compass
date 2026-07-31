/**
 * CENTER signals — Pulse and Live Now.
 *
 * Two one-line answers the Judge gives, both side-blind about the market as a
 * whole (Live Now may name a side only because it reports history, not evidence):
 *
 *   • Pulse    — "what changed recently?" One label + one calm sentence. The raw
 *                deltas live in the totals above; Pulse is the interpretation.
 *   • Live Now — "what happened most recently?" Exactly one chronological event.
 *
 * Presentation only — everything comes from the pure domain modules.
 */
import { useMemo } from "react";
import type { TapeTrade } from "@/domain/conviction-series";
import { marketVitality } from "@/domain/market-vitality";
import { marketPulse, pulseTone } from "@/domain/market-pulse";
import { latestMarketEvent, liveNowLine } from "@/domain/live-now";

const toneColor = (t: "up" | "down" | "flat"): string =>
  t === "up" ? "var(--yes)" : t === "down" ? "var(--no)" : "var(--text-muted)";

const fmtMoney = (usd: number) =>
  usd >= 1000 ? `$${Math.round(usd).toLocaleString("en-US")}` : `$${usd.toFixed(usd < 10 ? 2 : 0)}`;

const agoLabel = (ms: number) => {
  const s = Math.max(0, ms / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172_800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

/** PULSE — the market's one-word state and one calm sentence. */
export function MarketPulse({
  tape,
  nowMs = Date.now(),
}: {
  tape: TapeTrade[] | undefined;
  nowMs?: number;
}) {
  const pulse = useMemo(() => marketPulse(marketVitality(tape ?? [], nowMs)), [tape, nowMs]);
  const tone = toneColor(pulseTone(pulse.label));

  return (
    <section aria-label="Pulse" className="flex items-baseline gap-2.5">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Pulse
      </span>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{ color: tone, background: `color-mix(in oklab, ${tone} 14%, transparent)` }}
      >
        {pulse.label}
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--text-secondary)]">
        {pulse.meaning}
      </span>
    </section>
  );
}

/** LIVE NOW — the single most recent chronological event. */
export function LiveNow({
  tape,
  ethUsd,
  nowMs = Date.now(),
}: {
  tape: TapeTrade[] | undefined;
  ethUsd: number;
  nowMs?: number;
}) {
  const line = useMemo(() => {
    const e = latestMarketEvent(tape ?? [], nowMs);
    return e ? liveNowLine(e, (eth) => fmtMoney(eth * (ethUsd > 0 ? ethUsd : 0))) : null;
  }, [tape, ethUsd, nowMs]);

  if (!line) return null;

  return (
    <section aria-label="Live now" className="flex items-center gap-2.5">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Live now
      </span>
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: "var(--yes)" }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-secondary)]">
        <span aria-hidden>{line.emoji}</span> {line.text}
      </span>
      <span className="num shrink-0 text-[11px] text-[var(--text-muted)]">
        {agoLabel(nowMs - line.at)}
      </span>
    </section>
  );
}
