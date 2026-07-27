import { describe, it, expect } from "vitest";
import {
  minOut,
  usdToWei,
  weiToUsd,
  avgPriceUsd,
  pulseFor,
  selectSide,
  DEFAULT_SLIPPAGE_BPS,
} from "./order";

describe("slippage floor", () => {
  it("applies the default 2% tolerance", () => {
    expect(minOut(10_000n)).toBe(9_800n);
  });
  it("clamps and guards", () => {
    expect(minOut(0n)).toBe(0n);
    expect(minOut(1000n, -5n)).toBe(1000n);
    expect(minOut(1000n, 20_000n)).toBe(0n);
  });
  it("default is 200 bps", () => {
    expect(DEFAULT_SLIPPAGE_BPS).toBe(200n);
  });
});

describe("usd ⇄ wei via calibration", () => {
  it("converts $1000 at $2000/ETH to 0.5 ETH", () => {
    const wei = usdToWei(1000, 2000);
    expect(weiToUsd(wei, 2000)).toBeCloseTo(1000, 0);
    expect(Number(wei) / 1e18).toBeCloseTo(0.5, 6);
  });
  it("stays exact enough for small amounts", () => {
    const wei = usdToWei(5, 3000);
    expect(weiToUsd(wei, 3000)).toBeCloseTo(5, 1);
  });
  it("guards zero / negative", () => {
    expect(usdToWei(0, 2000)).toBe(0n);
    expect(usdToWei(100, 0)).toBe(0n);
  });
});

describe("avg price", () => {
  it("is eth-spent-usd / shares", () => {
    // 0.5 ETH @ $2000 = $1000 for 500 shares → $2.00 avg
    const eth = usdToWei(1000, 2000);
    const shares = 500n * 10n ** 18n;
    expect(avgPriceUsd(eth, shares, 2000)).toBeCloseTo(2, 2);
  });
  it("guards zero shares", () => {
    expect(avgPriceUsd(1n, 0n, 2000)).toBe(0);
  });
});

describe("pulse", () => {
  it("maps hot → Accelerating and prefers the real reason", () => {
    const p = pulseFor("hot", "Money keeps changing hands here.");
    expect(p.label).toBe("Accelerating");
    expect(p.tone).toBe("hot");
    expect(p.why).toBe("Money keeps changing hands here.");
  });
  it("falls back to a class default when no reason", () => {
    expect(pulseFor("early", null).why).toBe("Small but growing.");
  });
  it("unknown/none → Steady", () => {
    expect(pulseFor(null, null).label).toBe("Steady");
  });
});

describe("selectSide never buys — it only toggles selection", () => {
  it("selects, then deselects on re-tap", () => {
    expect(selectSide(null, "YES")).toBe("YES");
    expect(selectSide("YES", "NO")).toBe("NO");
    expect(selectSide("YES", "YES")).toBe(null);
  });
});
