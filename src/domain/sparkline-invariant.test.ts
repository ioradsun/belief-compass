/**
 * The invariant the whole deck depends on: for a selected window, the % shown
 * next to a metric MUST equal the change between the FIRST and LAST points its
 * sparkline draws. If they can drift, the chart and the number tell different
 * stories (a "0%" over a visibly sloped line). These tests lock that agreement
 * for both series the UI plots: the center totals (marketBook) and each side's
 * lens series (sideCaseSummary).
 */
import { describe, expect, it } from "vitest";
import { marketBook } from "./market-book";
import { sideCaseSummary } from "./case-file";
import type { TapeTrade } from "./conviction-series";

const DAY = 86_400_000;
const now = 40 * DAY;

// A market with pre-window history (so the window opens on a carried baseline)
// plus real in-window moves on both sides, including a price drift and an exit.
const tape: TapeTrade[] = [
  // ── before the 30d window (t < now-30d = 10d) ──
  { w: "a", side: "YES", action: "BUY", eth: 1.0, price: 0.5, t: 2 * DAY, seq: 1 },
  { w: "b", side: "NO", action: "BUY", eth: 0.8, price: 0.5, t: 3 * DAY, seq: 2 },
  { w: "c", side: "YES", action: "BUY", eth: 0.5, price: 0.52, t: 5 * DAY, seq: 3 },
  // ── inside the 30d window ──
  { w: "d", side: "YES", action: "BUY", eth: 0.6, price: 0.55, t: 15 * DAY, seq: 4 },
  { w: "e", side: "YES", action: "BUY", eth: 0.4, price: 0.6, t: 20 * DAY, seq: 5 },
  { w: "a", side: "YES", action: "SELL", eth: 0.3, price: 0.58, t: 25 * DAY, seq: 6 },
  { w: "f", side: "NO", action: "BUY", eth: 1.2, price: 0.51, t: 22 * DAY, seq: 7 },
  { w: "g", side: "YES", action: "BUY", eth: 0.2, price: 0.545, t: 30 * DAY, seq: 8 },
];

/** The change the UI would read off the drawn line's endpoints. */
const endpointPct = (first: number, last: number): number | null =>
  first > 0 ? ((last - first) / first) * 100 : null;

describe("center totals (marketBook): % equals the sparkline's endpoints", () => {
  for (const win of ["1h", "24h", "7d", "30d", "all"] as const) {
    it(`holds for the ${win} window`, () => {
      const book = marketBook(tape, now, win);
      for (const metric of [book.believers.market, book.capitalEth.market]) {
        const s = metric.series;
        // The line is drawn from series[0] to series[last]; the % is delta/base.
        expect(metric.base).toBeCloseTo(s[0].v, 9);
        expect(metric.current).toBeCloseTo(s[s.length - 1].v, 9);
        const shownPct = metric.base > 0 ? (metric.delta / metric.base) * 100 : null;
        expect(shownPct).toEqual(endpointPct(s[0].v, s[s.length - 1].v));
      }
    });
  }
});

describe("side lens (sideCaseSummary): each % equals its sparkline's endpoints", () => {
  for (const side of ["YES", "NO"] as const) {
    for (const win of ["24h", "7d", "30d", "all"] as const) {
      it(`${side} · ${win}`, () => {
        const s = sideCaseSummary(tape, side, win, now);
        if (!s) return; // side never traded in this fixture — nothing to chart
        const series = s.series;

        // The summary now hands over the BASE rather than a ratio, so the
        // invariant is stated where it actually lives: the number the chart
        // starts at is the number any percentage would be divided by, and the
        // number it ends at is the headline total. A ratio built from these can
        // never disagree with the line above it.
        expect(s.believersBase).toBeCloseTo(series[0].believers, 9);
        expect(s.believers).toBeCloseTo(series[series.length - 1].believers, 9);
        expect(s.capitalBaseEth).toBeCloseTo(series[0].capital, 9);
        expect(s.capitalEth).toBeCloseTo(series[series.length - 1].capital, 9);
        // Price: the line only plots priced points; the % must match those endpoints.
        const priced = series.filter((p) => p.price != null) as {
          price: number;
        }[];
        if (priced.length >= 2 && s.pricePct != null) {
          expect(s.pricePct).toBeCloseTo(
            endpointPct(priced[0].price, priced[priced.length - 1].price)!,
            6,
          );
        }
      });
    }
  }
});
