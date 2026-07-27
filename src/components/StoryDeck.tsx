/**
 * StoryDeck — Instagram-stories presentation for the Belief column.
 *
 * One market on screen at a time. Segment bars across the top show where you
 * are in the deck, the active segment fills over STORY_MS and then advances.
 * Tap/click the left third to go back, the right two-thirds to go forward,
 * hold (or hover on desktop) to pause, swipe horizontally on touch.
 * Purely presentational: it reuses MarketCard untouched.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MarketCard, type MarketRow } from "./MarketCard";
import type { MatchPerson, Pulse } from "@/lib/markets.functions";

const STORY_MS = 14_000;
const TICK_MS = 100;

export function StoryDeck({
  rows,
  pulses,
  ethUsd,
  winLabel,
  tribe,
  opp,
}: {
  rows: MarketRow[];
  pulses: Record<string, Pulse[]>;
  ethUsd: number;
  winLabel: string;
  tribe?: MatchPerson | null;
  opp?: MatchPerson | null;
}) {
  const [i, setI] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);

  const count = rows.length;
  const idx = Math.min(i, Math.max(0, count - 1));

  const go = useCallback(
    (delta: number) => {
      setElapsed(0);
      setI((prev) => {
        const next = prev + delta;
        if (next < 0) return 0;
        if (next > count - 1) return 0; // loop the deck
        return next;
      });
    },
    [count],
  );

  // Auto-advance timer.
  useEffect(() => {
    if (paused || count === 0) return;
    const t = setInterval(() => {
      setElapsed((e) => {
        if (e + TICK_MS >= STORY_MS) {
          go(1);
          return 0;
        }
        return e + TICK_MS;
      });
    }, TICK_MS);
    return () => clearInterval(t);
  }, [paused, count, go]);

  // Keyboard: arrows step, space pauses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA"].includes(el.tagName)) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (count === 0) return null;
  const row = rows[idx];

  return (
    <div className="space-y-3">
      {/* Segment bars */}
      <div className="flex items-center gap-1">
        {rows.map((r, k) => (
          <button
            key={r.onchain_id}
            type="button"
            aria-label={`Market ${k + 1} of ${count}`}
            onClick={() => {
              setElapsed(0);
              setI(k);
            }}
            className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--border)]"
          >
            <span
              className="block h-full rounded-full bg-[var(--text)] transition-[width] duration-100 ease-linear"
              style={{
                width: k < idx ? "100%" : k === idx ? `${(elapsed / STORY_MS) * 100}%` : "0%",
              }}
            />
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span className="num">
          {idx + 1} / {count}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="rounded border border-[var(--border)] px-2 py-1 uppercase tracking-wide hover:text-[var(--text)]"
          >
            {paused ? "play" : "pause"}
          </button>
          <button
            type="button"
            onClick={() => go(-1)}
            className="rounded border border-[var(--border)] px-2 py-1 uppercase tracking-wide hover:text-[var(--text)]"
          >
            prev
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            className="rounded border border-[var(--border)] px-2 py-1 uppercase tracking-wide hover:text-[var(--text)]"
          >
            next
          </button>
        </div>
      </div>

      {/* Stage */}
      <div
        className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
          setPaused(true);
        }}
        onTouchEnd={(e) => {
          setPaused(false);
          const start = touchX.current;
          touchX.current = null;
          if (start == null) return;
          const dx = (e.changedTouches[0]?.clientX ?? start) - start;
          if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
        }}
      >
        <div key={row.onchain_id} className="animate-in fade-in duration-300">
          <MarketCard
            row={row}
            pulses={pulses[String(row.onchain_id)] ?? []}
            ethUsd={ethUsd}
            winLabel={winLabel}
            stagger={0}
            tribe={tribe}
            opp={opp}
          />
        </div>

        {/* Tap zones — sit behind interactive card content */}
        <button
          type="button"
          aria-label="Previous market"
          onClick={() => go(-1)}
          className="absolute inset-y-0 left-0 -z-10 w-1/3"
        />
        <button
          type="button"
          aria-label="Next market"
          onClick={() => go(1)}
          className="absolute inset-y-0 right-0 -z-10 w-2/3"
        />
      </div>
    </div>
  );
}
