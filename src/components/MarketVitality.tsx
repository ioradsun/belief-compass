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
import { believerMove, capitalMove, type MetricMove } from "@/domain/metric-display";

const dirTone = (d: "up" | "down" | "flat"): string =>
  d === "up" ? "var(--yes)" : d === "down" ? "var(--no)" : "var(--text-muted)";

/** Formats an ETH-native capital amount in the viewer's chosen unit. */
type CapFmt = (eth: number, signed?: boolean) => string;


// Believers and capital are turned into their two copy lines by the ONE shared
// metric-display rule (src/domain/metric-display): the count/money leads, the %
// is paired, and a % off a tiny base is kept quiet or dropped. These adapters just
// feed the canonical book metric into that rule.
const believerCopy = (m: BookMetric, w: BookWindow): MetricMove =>
  believerMove(m.current, m.base, w.since);


// Materiality (direction, the percentage floor) is judged in USD so a display in
// ETH never changes what counts as a real move; only the shown figure converts.
const capitalCopy = (
  m: BookMetric,
  w: BookWindow,
  usd: (eth: number) => number,
  money: CapFmt,
): MetricMove =>
  capitalMove({ currentEth: m.current, baseEth: m.base, since: w.since, usd, money });


/**
 * One full-width metric row inside the Total Market instrument: the current
 * total in large type on the left, the percentage change in large type on the
 * right (with its direction arrow trailing it), the metric label beneath, and
 * the exact absolute change over the selected timeframe beneath that.
 */
function MomentumMetric({ total, label, copy }: { total: string; label: string; copy: MetricMove }) {
  const tone = dirTone(copy.direction);
  const arrow = copy.direction === "up" ? "▲" : copy.direction === "down" ? "▼" : "";
  // Only a trusted (headline) % earns the big right-hand figure. A small-base %
  // is demoted to a quiet suffix on the absolute line so it never overstates the
  // move; with no % at all the headline space stays empty.
  const headlinePct = copy.pct && !copy.pctQuiet ? copy.pct : copy.direction === "flat" ? "0%" : "";
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
          {headlinePct}
          {arrow && headlinePct ? (
            <span className="ml-1.5 text-[0.6em] align-middle">{arrow}</span>
          ) : null}
        </span>
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="num mt-0.5 text-[12px]" style={{ color: tone }}>
        {copy.absolute}
        {copy.pct && copy.pctQuiet && (
          <span className="ml-1.5 text-[var(--text-muted)]">· {copy.pct}</span>
        )}
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
