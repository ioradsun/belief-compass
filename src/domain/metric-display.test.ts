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
  const { pctValidMinBase, pctHeadlineMinBase } = METRIC_DISPLAY.believers;
  it("hides below the valid floor", () => {
    expect(pctRank(0, pctValidMinBase, pctHeadlineMinBase)).toBe("none");
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
  it("does NOT headline a % off a tiny base, but keeps the count", () => {
    // 2 → 3 believers is +50%, but off a base of 2 that must stay quiet.
    const m = believerMove(3, 2, "over 1D");
    expect(m.absolute).toBe("+1 believer over 1D");
    expect(m.pct).toBe("+50%");
    expect(m.pctQuiet).toBe(true);
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
