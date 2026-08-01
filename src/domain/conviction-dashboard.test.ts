import { describe, it, expect } from "vitest";
import {
  realizedTradingEth,
  gainBreakdown,
  bucketCreatorFees,
  type DashTrade,
} from "./conviction-dashboard";

const T = (o: Partial<DashTrade>): DashTrade => ({
  market: "1",
  side: "YES",
  action: "BUY",
  eth: 0,
  tokens: 0,
  ...o,
});

describe("realizedTradingEth", () => {
  it("realizes a simple win", () => {
    expect(
      realizedTradingEth([
        T({ action: "BUY", eth: 1, tokens: 10 }),
        T({ action: "SELL", eth: 1.5, tokens: 10 }),
      ]),
    ).toBeCloseTo(0.5, 9);
  });

  it("realizes nothing on a flat partial sell", () => {
    expect(
      realizedTradingEth([
        T({ action: "BUY", eth: 1, tokens: 10 }),
        T({ action: "SELL", eth: 0.5, tokens: 5 }),
      ]),
    ).toBeCloseTo(0, 9);
  });

  it("uses weighted-average cost across buys", () => {
    expect(
      realizedTradingEth([
        T({ action: "BUY", eth: 1, tokens: 10 }),
        T({ action: "BUY", eth: 3, tokens: 10 }),
        T({ action: "SELL", eth: 3, tokens: 10 }),
      ]),
    ).toBeCloseTo(1, 9);
  });

  it("realizes losses", () => {
    expect(
      realizedTradingEth([
        T({ action: "BUY", eth: 2, tokens: 10 }),
        T({ action: "SELL", eth: 1, tokens: 10 }),
      ]),
    ).toBeCloseTo(-1, 9);
  });

  it("never invents gain when a sell has no basis", () => {
    expect(realizedTradingEth([T({ action: "SELL", eth: 1, tokens: 10 })])).toBe(0);
  });

  it("realizes only the portion of a sell with real basis", () => {
    expect(
      realizedTradingEth([
        T({ action: "BUY", eth: 0.5, tokens: 5 }),
        T({ action: "SELL", eth: 2, tokens: 10 }),
      ]),
    ).toBeCloseTo(0.5, 9);
  });

  it("keeps YES/NO sides and markets independent", () => {
    expect(
      realizedTradingEth([
        T({ side: "YES", action: "BUY", eth: 1, tokens: 10 }),
        T({ side: "YES", action: "SELL", eth: 1.5, tokens: 10 }),
        T({ side: "NO", action: "BUY", eth: 1, tokens: 10 }),
        T({ side: "NO", action: "SELL", eth: 0.5, tokens: 10 }),
      ]),
    ).toBeCloseTo(0, 9);
  });
});

describe("bucketCreatorFees", () => {
  const now = Date.UTC(2026, 7, 1, 12, 0, 0);
  const H = 3_600_000;
  const D = 86_400_000;

  it("splits accruals into today / this week / last week without double counting", () => {
    const r = bucketCreatorFees(
      [
        { at: now - 1 * H, eth: 0.01 }, // today
        { at: now - 13 * H, eth: 0.02 }, // crosses midnight → this week, not today
        { at: now - 2 * D, eth: 0.03 }, // this week
        { at: now - 8 * D, eth: 0.04 }, // last week
        { at: now - 20 * D, eth: 0.05 }, // older → excluded
      ],
      now,
    );
    expect(r.todayEth).toBeCloseTo(0.01, 9);
    expect(r.weekEth).toBeCloseTo(0.06, 9);
    expect(r.prevWeekEth).toBeCloseTo(0.04, 9);
  });

  it("ignores non-positive entries and handles empty", () => {
    expect(bucketCreatorFees([{ at: now, eth: -1 }], now)).toEqual({
      todayEth: 0,
      weekEth: 0,
      prevWeekEth: 0,
    });
    expect(bucketCreatorFees([], now)).toEqual({ todayEth: 0, weekEth: 0, prevWeekEth: 0 });
  });
});

describe("gainBreakdown", () => {
  it("splits percentages across positive contributors", () => {
    expect(
      gainBreakdown([
        { key: "holding", label: "Holding Markets", usd: 80 },
        { key: "trading", label: "Trading", usd: 20 },
        { key: "creating", label: "Creating Markets", usd: 0 },
      ]).map((x) => x.pct),
    ).toEqual([80, 20, null]);
  });

  it("excludes losses from the percentage split", () => {
    expect(
      gainBreakdown([
        { key: "holding", label: "h", usd: -50 },
        { key: "trading", label: "t", usd: 100 },
        { key: "creating", label: "c", usd: 0 },
      ]).map((x) => x.pct),
    ).toEqual([null, 100, null]);
  });
});
