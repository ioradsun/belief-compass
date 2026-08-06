import { describe, it, expect } from "vitest";
import {
  metricDirection,
  pctOf,
  pctRank,
  formatPct,
  believerMove,
  capitalMove,
  priceMove,
  positionReturn,
  gain,
  METRIC_DISPLAY,
} from "./metric-display";

describe("metricDirection", () => {
  it("uses the epsilon to call small moves flat", () => {
    expect(metricDirection(1)).toBe("up");
    expect(metricDirection(-1)).toBe("down");
    expect(metricDirection(0)).toBe("flat");
    expect(metricDirection(0.3, 0.5)).toBe("flat");
    expect(metricDirection(-0.3, 0.5)).toBe("flat");
    expect(metricDirection(0.6, 0.5)).toBe("up");
  });
  it("is flat for non-finite deltas", () => {
    expect(metricDirection(NaN)).toBe("flat");
  });
});

describe("pctOf", () => {
  it("divides by a positive base", () => {
    expect(pctOf(5, 10)).toBe(50);
    expect(pctOf(-5, 10)).toBe(-50);
  });
  it("is null with no positive denominator", () => {
    expect(pctOf(5, 0)).toBeNull();
    expect(pctOf(5, -1)).toBeNull();
  });
});

describe("pctRank — small-number protection", () => {
  const { pctValidMinBase, pctHeadlineMinBase } = METRIC_DISPLAY.capitalUsd;
  it("hides below the valid floor", () => {
    expect(pctRank(0, pctValidMinBase, pctHeadlineMinBase)).toBe("none");
    expect(pctRank(0.9, pctValidMinBase, pctHeadlineMinBase)).toBe("none");
  });
  it("stays quiet between valid and headline", () => {
    expect(pctRank(1, pctValidMinBase, pctHeadlineMinBase)).toBe("quiet");
    expect(pctRank(9, pctValidMinBase, pctHeadlineMinBase)).toBe("quiet");
  });
  it("headlines once the base is large enough", () => {
    expect(pctRank(10, pctValidMinBase, pctHeadlineMinBase)).toBe("headline");
    expect(pctRank(100, pctValidMinBase, pctHeadlineMinBase)).toBe("headline");
  });
});

/**
 * THE BUG THAT PROMPTED THIS MODULE'S SECOND HALF.
 *
 * A live market's mobile panel read:
 *
 *   3 BELIEVERS   200%▲    +2 believers today
 *   $2.70 COMMITTED  67298%▲   +$2.69 committed today
 *
 * Every figure was arithmetically correct. Neither percentage was information:
 * one divided by a single person, the other by four tenths of a cent.
 */
describe("gain — the first money in is not a gain", () => {
  const CAP = METRIC_DISPLAY.capitalUsd;
  const BEL = METRIC_DISPLAY.believers;

  it("refuses to rate the exact move that started this", () => {
    // base $0.004 → $2.6959 is the screenshot, to the cent.
    const g = gain(2.6959, 0.004, CAP);
    expect(g.rank).toBe("origin");
    expect(g.pct).toBeNull();
    expect(g.delta).toBeCloseTo(2.6919, 4);
  });

  it("refuses to rate 1 → 3 believers", () => {
    const g = gain(3, 1, BEL);
    expect(g.pct).toBeNull();
    expect(g.delta).toBe(2);
  });

  it("never divides by an amount the app already calls dust", () => {
    // The believer-seeding rule elsewhere ignores capital under a cent; this
    // must not turn the same amount into a denominator.
    for (const base of [0, 0.0001, 0.004, 0.009, 0.01]) {
      expect(gain(5, base, CAP).pct).toBeNull();
    }
  });

  it("separates 'no baseline' from 'nothing was here'", () => {
    // No snapshot at the boundary: we cannot claim a change of any kind.
    expect(gain(5, null, CAP)).toEqual({ rank: "unknown", delta: null, pct: null });
    expect(gain(5, undefined, CAP).rank).toBe("unknown");
    expect(gain(NaN, 10, CAP).rank).toBe("unknown");
    expect(gain(8, Number.POSITIVE_INFINITY, CAP).rank).toBe("unknown");
    // A real, empty baseline: the arrival is a fact, the rate is not.
    expect(gain(5, 0, CAP)).toEqual({ rank: "origin", delta: 5, pct: null });
  });

  it("still states the absolute change whenever a percentage is withheld", () => {
    for (const [current, base] of [
      [2.6959, 0.004], // origin
      [0.8, 0.5], // real base, too thin to divide by
      [0.002, 0.008], // dust shrinking
    ] as const) {
      const g = gain(current, base, CAP);
      expect(g.pct).toBeNull();
      expect(g.delta).not.toBeNull();
    }
    expect(gain(3, 1, BEL).pct).toBeNull();
    expect(gain(3, 1, BEL).delta).toBe(2);
  });

  it("does not call a shrinking dust position an origin", () => {
    // Both ends below the line — nothing arrived, so there is nothing to name.
    expect(gain(0.002, 0.008, CAP).rank).toBe("none");
    expect(gain(0.002, 0.008, CAP).delta).toBeCloseTo(-0.006, 6);
  });

  it("keeps a thin but real base quiet", () => {
    const g = gain(8, 5, CAP);
    expect(g.rank).toBe("quiet");
    expect(g.pct).toBe(60);
  });

  it("lets an established base speak", () => {
    const g = gain(35.04, 244.6, CAP);
    expect(g.rank).toBe("headline");
    expect(g.pct).toBeCloseTo(-85.67, 2);
  });

  it("lets a real crowd's ratio through", () => {
    const g = gain(45, 30, BEL);
    expect(g.rank).toBe("headline");
    expect(g.pct).toBe(50);
  });

  /**
   * Calibration, not taste. Measured over 1,000 market_state rows: 22% of funded
   * sides hold under a cent, 67% under a dollar, and only 1% of sides have ten
   * or more believers. These assertions pin the thresholds to that reality so a
   * later edit has to argue with the data.
   */
  it("is calibrated to the markets that exist", () => {
    expect(CAP.originMaxBase).toBe(0.01); // the app's own dust line
    expect(BEL.pctValidMinBase).toBe(BEL.pctHeadlineMinBase); // counts: shown or not, never half-shown
    expect(BEL.pctValidMinBase).toBeGreaterThanOrEqual(10); // above p95 (5) of side sizes
    expect(gain(0.95 + 5, 0.95, CAP).pct).toBeNull(); // the median funded side
  });
});

describe("formatPct", () => {
  it("signs and rounds by magnitude", () => {
    expect(formatPct(12)).toBe("+12%");
    expect(formatPct(-4)).toBe("−4%");
    expect(formatPct(4.2)).toBe("+4.2%");
    expect(formatPct(86)).toBe("+86%");
    expect(formatPct(-86)).toBe("−86%");
  });
  it("reads flat as 0%", () => {
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(0.01)).toBe("0%");
  });
  it("can drop the + sign when asked", () => {
    expect(formatPct(12, { signed: false })).toBe("12%");
    expect(formatPct(-12, { signed: false })).toBe("−12%");
  });
});

describe("believerMove — the count leads", () => {
  it("states the first believer without a percentage", () => {
    const m = believerMove(1, 0, "over 1D");
    expect(m.absolute).toBe("First believer");
    expect(m.pct).toBeNull();
    expect(m.direction).toBe("up");
  });
  it("states a cold-start arrival of several", () => {
    const m = believerMove(4, 0, "over 1D");
    expect(m.absolute).toBe("+4 believers over 1D");
    expect(m.pct).toBeNull();
  });
  it("shows no % off a tiny base, and keeps the count", () => {
    // 2 → 3 believers is arithmetically +50%. It is also one person arriving,
    // and the median side on this platform holds exactly one believer, so the
    // ratio is the count restated with worse precision.
    const m = believerMove(3, 2, "over 1D");
    expect(m.absolute).toBe("+1 believer over 1D");
    expect(m.pct).toBeNull();
    expect(m.pctQuiet).toBe(false);
  });
  it("headlines the % once the crowd is real", () => {
    const m = believerMove(16, 17, "over 1D");
    expect(m.absolute).toBe("−1 believer over 1D");
    expect(m.pct).toBe("−5.9%");
    expect(m.pctQuiet).toBe(false);
    expect(m.direction).toBe("down");
  });
  it("says no change with a stable count", () => {
    const m = believerMove(20, 20, "over 1D");
    expect(m.absolute).toBe("No change over 1D");
    expect(m.direction).toBe("flat");
    expect(m.pct).toBe("0%");
  });
});

describe("capitalMove — the money leads", () => {
  const usd = (eth: number) => eth * 2000;
  const money = (eth: number, signed?: boolean) => {
    const v = eth * 2000;
    const sign = signed ? (v >= 0 ? "+" : "−") : "";
    return `${sign}$${Math.abs(v).toFixed(2)}`;
  };

  it("pairs a big percentage with the real (small) amount", () => {
    // base $244.60, now $35.04 → −86%, −$209.56. The amount tells the true scale.
    const m = capitalMove({
      currentEth: 35.04 / 2000,
      baseEth: 244.6 / 2000,
      since: "over 1D",
      usd,
      money,
    });
    expect(m.pct).toBe("−86%");
    expect(m.absolute).toBe("−$209.56 left over 1D");
    expect(m.direction).toBe("down");
    expect(m.pctQuiet).toBe(false);
  });
  it("announces first capital without a percentage", () => {
    const m = capitalMove({ currentEth: 0.05, baseEth: 0, since: "over 1D", usd, money });
    expect(m.absolute).toBe("First capital · $100.00");
    expect(m.pct).toBeNull();
  });
  it("keeps a small-base % quiet", () => {
    // base $10 (< $10 headline floor is exclusive → 10 headlines; use $5).
    const m = capitalMove({
      currentEth: 8 / 2000,
      baseEth: 5 / 2000,
      since: "over 1D",
      usd,
      money,
    });
    expect(m.pctQuiet).toBe(true);
    expect(m.pct).toBe("+60%");
  });
  it("reads flat under the materiality epsilon", () => {
    const m = capitalMove({
      currentEth: 100.1 / 2000,
      baseEth: 100 / 2000,
      since: "over 1D",
      usd,
      money,
    });
    expect(m.direction).toBe("flat");
    expect(m.absolute).toBe("No change over 1D");
  });
});

describe("priceMove — the percentage leads, paired with the exact change", () => {
  const money = (v: number, signed?: boolean) => {
    const sign = signed ? (v >= 0 ? "+" : "−") : "";
    return `${sign}$${Math.abs(v).toFixed(2)}`;
  };
  it("leads with % and pairs the price delta", () => {
    const m = priceMove({ pricePct: 12, priceDelta: 0.05, since: "over 1D", money });
    expect(m.pct).toBe("+12%");
    expect(m.absolute).toBe("+$0.05 over 1D");
    expect(m.direction).toBe("up");
  });
  it("handles a down move", () => {
    const m = priceMove({ pricePct: -4, priceDelta: -0.01, since: "over 1D", money });
    expect(m.pct).toBe("−4%");
    expect(m.absolute).toBe("−$0.01 over 1D");
    expect(m.direction).toBe("down");
  });
  it("reads flat below the price floor", () => {
    const m = priceMove({ pricePct: 0.4, priceDelta: 0.001, since: "over 1D", money });
    expect(m.direction).toBe("flat");
    expect(m.absolute).toBe("Flat over 1D");
  });
  it("returns empty when the market has not priced the side", () => {
    const m = priceMove({ pricePct: null, priceDelta: null, since: "over 1D", money });
    expect(m.pct).toBeNull();
    expect(m.absolute).toBe("");
  });
});

describe("positionReturn — the P&L leads, the return % is paired", () => {
  const money = (v: number, signed?: boolean) => {
    const sign = signed ? (v >= 0 ? "+" : "−") : "";
    return `${sign}$${Math.abs(v).toFixed(2)}`;
  };
  it("shows gain and return together", () => {
    const r = positionReturn({ gainUsd: 8.42, gainPct: 84.2, money });
    expect(r).not.toBeNull();
    expect(r!.pnl).toBe("+$8.42");
    expect(r!.pct).toBe("+84.2%");
    expect(r!.direction).toBe("up");
  });
  it("shows a loss", () => {
    const r = positionReturn({ gainUsd: -3.1, gainPct: -25, money });
    expect(r!.pnl).toBe("−$3.10");
    expect(r!.pct).toBe("−25%");
    expect(r!.direction).toBe("down");
  });
  it("is null without an authoritative cost basis", () => {
    expect(positionReturn({ gainUsd: null, gainPct: null, money })).toBeNull();
  });
  it("still shows P&L when the return % is unknown", () => {
    const r = positionReturn({ gainUsd: 5, gainPct: null, money });
    expect(r!.pnl).toBe("+$5.00");
    expect(r!.pct).toBeNull();
  });
});
