/**
 * The ONE timeframe control: 1H · 1D · 1W · 1M · All.
 *
 * It lives in the center panel and publishes to the deck window store, so every
 * number on screen — the center's believers/capital totals, their deltas,
 * percentages and sparklines, the pulse copy, and both YES/NO Case columns —
 * is measured over exactly the same selected period. It is deliberately its own
 * tiny module so the center can render it without pulling in the Case File.
 */
import { FLOW_WINDOW_SHORT, type FlowWindow } from "@/domain/market-flow";

export const WINDOWS: FlowWindow[] = ["1h", "24h", "7d", "30d", "all"];

export function WindowFilter({ win, onWin }: { win: FlowWindow; onWin: (w: FlowWindow) => void }) {
  return (
    <div
      className="flex rounded-[9px] p-0.5"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      role="tablist"
      aria-label="Timeframe"
    >
      {WINDOWS.map((w) => {
        const on = w === win;
        return (
          <button
            key={w}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onWin(w)}
            className={`flex-1 rounded-[7px] px-1.5 py-1 text-[11px] font-semibold transition-colors ${
              on ? "bg-[var(--bg)] text-[var(--text)]" : "text-[var(--text-muted)]"
            }`}
          >
            {FLOW_WINDOW_SHORT[w]}
          </button>
        );
      })}
    </div>
  );
}
