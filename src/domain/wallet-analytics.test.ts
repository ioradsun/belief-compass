import { describe, expect, it } from "vitest";
import {
  foldWalletAnalytics,
  summarizeWalletAnalytics,
  type AnalyticsTrade,
} from "./wallet-analytics";

const H = 3_600_000;

const trades: AnalyticsTrade[] = [
  { wallet: "0xAA", marketId: "1", isBuy: true, usd: 100, at: 0 },
  { wallet: "0xaa", marketId: "1", isBuy: false, usd: 90, at: H / 2 },
  { wallet: "0xaa", marketId: "2", isBuy: true, usd: 50, at: 5 * 24 * H },
  { wallet: "0xbb", marketId: "1", isBuy: true, usd: 10, at: 0 },
  { wallet: "0xcc", marketId: "3", isBuy: true, usd: 0, at: 0 },
];

describe("wallet analytics", () => {
  it("collapses trades to one row per wallet, case-insensitively", () => {
    const rows = foldWalletAnalytics(trades);
    expect(rows.map((r) => r.wallet)).toEqual(["0xaa", "0xbb"]);
    const aa = rows[0];
    expect(aa.marketsTraded).toBe(2);
    expect(aa.totalTrades).toBe(3);
    expect(aa.buyUsd).toBe(150);
    expect(aa.sellUsd).toBe(90);
    expect(aa.sellBuyRatio).toBeCloseTo(0.6);
    expect(aa.activeDays).toBe(2);
    expect(aa.lifespanDays).toBeCloseTo(5);
    // holds: market 1 = 1800s, market 2 = 0s → median 900
    expect(aa.medianHoldSecs).toBe(900);
  });

  it("summarizes repeat use and concentration", () => {
    const s = summarizeWalletAnalytics(foldWalletAnalytics(trades));
    expect(s.wallets).toBe(2);
    expect(s.repeatWallets).toBe(1);
    expect(s.medianMarketsTraded).toBe(1.5);
    expect(s.top10BuyShare).toBe(1);
    expect(s.totalBuyUsd).toBe(160);
  });
});
