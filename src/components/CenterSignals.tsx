/**
 * CENTER signal — Live Now.
 *
 *   • Live Now — "what happened most recently?" Exactly one MATERIAL event. It
 *                reports history, so it may name a side; it wraps to two lines
 *                rather than truncate the meaning.
 *
 * (Pulse used to live here too; it now folds into <MarketMomentum>.)
 * Presentation only — everything comes from the pure domain modules.
 */
import { useMemo } from "react";
import type { TapeTrade } from "@/domain/conviction-series";
import { marketBook } from "@/domain/market-book";
import { latestMaterialEvent, liveNowLine } from "@/domain/live-now";

const fmtMoney = (usd: number) =>
  usd >= 1000 ? `$${Math.round(usd).toLocaleString("en-US")}` : `$${usd.toFixed(usd < 10 ? 2 : 0)}`;

const agoLabel = (ms: number) => {
  const s = Math.max(0, ms / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172_800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

/** LIVE NOW — the single most recent material event. Wraps, never truncates. */
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
    const t = tape ?? [];
    if (!t.length) return null;
    const book = marketBook(t, nowMs);
    const capUsd = book.capitalEth.market.current * (ethUsd > 0 ? ethUsd : 0);
    // Ignore dust: a capital event must clear ~0.5% of Market Capital (min ~$5).
    const minCapEth = ethUsd > 0 ? Math.max(5, capUsd * 0.005) / ethUsd : 0;
    const e = latestMaterialEvent(t, nowMs, minCapEth);
    return e ? liveNowLine(e, (eth) => fmtMoney(eth * (ethUsd > 0 ? ethUsd : 0))) : null;
  }, [tape, ethUsd, nowMs]);

  if (!line) return null;

  return (
    <section aria-label="Live now" className="flex items-start gap-2">
      <span className="mt-px shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Live now
      </span>
      <span
        className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: "var(--yes)" }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--text-secondary)]">
        <span aria-hidden>{line.emoji}</span> {line.text}
        <span className="num text-[var(--text-muted)]"> · {agoLabel(nowMs - line.at)}</span>
      </span>
    </section>
  );
}
