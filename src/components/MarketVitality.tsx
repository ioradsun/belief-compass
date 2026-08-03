/**
 * CENTER — Market Momentum: the timeless read of "how big and which way?"
 *
 * Two compact metric rows — believers and capital (total · percentage change) —
 * plus the exact absolute move over the selected timeframe. No charts here: the
 * shape of the move lives in the Case File. This is the only momentum surface;
 * the story (the narrative sentence, the House voice, the activity) lives in the
 * right feed. The center never becomes a feed.
 *
 * Every number is read off the canonical marketBook, so the totals reconcile with
 * the side panels; the label comes from marketPulse — existing calculations,
 * unchanged. Side-blind by construction. The SAME component renders on desktop and
 * mobile; only the layout changes.
 */
import { useMemo, type ReactNode } from "react";
import { marketBook, type BookMetric, type BookWindow } from "@/domain/market-book";
import type { TapeTrade } from "@/domain/conviction-series";
import type { FlowWindow } from "@/domain/market-flow";
import { formatMoney } from "@/domain/money";
import { useDisplayUnit } from "@/lib/display-unit";


/** Below these bases a percentage is noise, so we show the absolute change only. */
const BELIEVER_PCT_MIN = 1;
const CAPITAL_PCT_MIN_USD = 1;

const dirTone = (d: "up" | "down" | "flat"): string =>
  d === "up" ? "var(--yes)" : d === "down" ? "var(--no)" : "var(--text-muted)";

/** Formats an ETH-native capital amount in the viewer's chosen unit. */
type CapFmt = (eth: number, signed?: boolean) => string;


interface RowCopy {
  /** e.g. "+14%" or null when the base is too small to be meaningful. */
  pct: string | null;
  /**
   * What the big right-hand figure shows. It is the percentage whenever the
   * base supports one; on a cold start (no base to divide by) it falls back to
   * the absolute move so the arrow is never left standing on its own.
   */
  trend: string;
  /** e.g. "+1 believer over 24H" / "First believer" / "No change over 24H". */
  absolute: string;
  direction: "up" | "down" | "flat";
}

/** Turn a metric + its cold-start context into the row's two copy lines. */
function believerCopy(m: BookMetric, w: BookWindow): RowCopy {
  const direction = m.delta > 0 ? "up" : m.delta < 0 ? "down" : "flat";
  if (m.base === 0 && m.current > 0) {
    return {
      pct: null,
      trend: "New",
      absolute:
        m.current === 1 ? "First believer" : `+${m.current} believers ${w.since}`,
      direction: "up",
    };
  }
  const pct =
    m.base >= BELIEVER_PCT_MIN
      ? `${m.delta >= 0 ? "+" : "−"}${Math.round((Math.abs(m.delta) / m.base) * 100)}%`
      : null;
  if (m.delta === 0)
    return {
      pct: pct ? "0%" : null,
      trend: "0%",
      absolute: `No change ${w.since}`,
      direction: "flat",
    };
  const n = Math.abs(m.delta);
  const signed = `${m.delta > 0 ? "+" : "−"}${n}`;
  return {
    pct,
    trend: pct ?? "New",
    absolute: `${signed} believer${n === 1 ? "" : "s"} ${w.since}`,
    direction,
  };
}


// Materiality (direction, the percentage floor) is judged in USD so a display in
// ETH never changes what counts as a real move; only the shown figure converts.
function capitalCopy(
  m: BookMetric,
  w: BookWindow,
  usd: (eth: number) => number,
  money: CapFmt,
): RowCopy {
  const baseUsd = usd(m.base);
  const deltaUsd = usd(m.delta);
  const direction = deltaUsd > 0.5 ? "up" : deltaUsd < -0.5 ? "down" : "flat";
  if (baseUsd < 0.5 && usd(m.current) > 0.5) {
    return {
      pct: null,
      trend: "New",
      absolute: `First capital · ${money(m.current)}`,
      direction: "up",
    };
  }
  const pct =
    baseUsd >= CAPITAL_PCT_MIN_USD
      ? `${deltaUsd >= 0 ? "+" : "−"}${Math.round((Math.abs(deltaUsd) / baseUsd) * 100)}%`
      : null;
  if (direction === "flat")
    return {
      pct: pct ? "0%" : null,
      trend: "0%",
      absolute: `No change ${w.since}`,
      direction: "flat",
    };
  return {
    pct,
    trend: pct ?? "New",
    absolute: `${money(m.delta, true)} committed ${w.since}`,
    direction,
  };
}


/**
 * One full-width metric row inside the Total Market instrument: the current
 * total in large type on the left, the percentage change in large type on the
 * right (with its direction arrow trailing it), the metric label beneath, and
 * the exact absolute change over the selected timeframe beneath that.
 */
function MomentumMetric({ total, label, copy }: { total: string; label: string; copy: RowCopy }) {
  const tone = dirTone(copy.direction);
  const arrow = copy.direction === "up" ? "▲" : copy.direction === "down" ? "▼" : "";
  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="num min-w-0 truncate text-[26px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)] sm:text-[30px]">
          {total}
        </span>
        <span
          className="num shrink-0 text-[22px] font-semibold leading-none tabular-nums sm:text-[26px]"
          style={{ color: tone }}
        >
          {copy.trend}
          {arrow ? <span className="ml-1.5 text-[0.6em] align-middle">{arrow}</span> : null}
        </span>
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="num mt-0.5 text-[12px]" style={{ color: tone }}>
        {copy.absolute}
      </div>
    </div>
  );
}


export function MarketMomentum({
  tape,
  ethUsd,
  win,
  nowMs = Date.now(),
  footer,
}: {
  tape: TapeTrade[] | undefined;
  ethUsd: number;
  /** The one on-screen timeframe — every total, delta and spark quotes it. */
  win?: FlowWindow;
  nowMs?: number;
  /** The insight + Case File disclosure, rendered inside the same instrument. */
  footer?: ReactNode;
}) {
  const book = useMemo(() => marketBook(tape ?? [], nowMs, win), [tape, nowMs, win]);
  const { unit } = useDisplayUnit();
  const usd = (eth: number) => eth * (ethUsd > 0 ? ethUsd : 0);
  // Capital is ETH-native; one rate takes it to the viewer's chosen display unit.
  const money: CapFmt = (eth, signed) =>
    formatMoney(eth, { from: "ETH", to: unit, ethUsd, signed });

  const b = book.believers.market;
  const c = book.capitalEth.market;

  // ONE analytical container: heading → believers → cap → insight → Case File.
  // No floating typography, no nested cards — a single market instrument.
  return (
    <section
      aria-label="Total market"
      className="shrink-0 overflow-hidden rounded-[16px]"
      style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
    >
      <div className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] sm:px-5">
        Total market
      </div>
      <MomentumMetric
        total={b.current.toLocaleString("en-US")}
        label="Believers"
        copy={believerCopy(b, book.window)}
      />
      <div className="border-t border-[var(--hairline)]" aria-hidden />
      <MomentumMetric
        total={money(c.current)}
        label="Total market cap"
        copy={capitalCopy(c, book.window, usd, money)}
      />

      {footer && (
        <>
          <div className="border-t border-[var(--hairline)]" aria-hidden />
          {footer}
        </>
      )}
    </section>
  );
}

