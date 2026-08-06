import { describe, it, expect } from "vitest";
import {
  minOut,
  usdToWei,
  weiToUsd,
  avgPriceUsd,
  pulseFor,
  selectSide,
  sharesForPct,
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
  it("has no average to report for zero shares", () => {
    // Was `toBe(0)`, which was the only sentinel available when this returned a
    // bare number. The intent of that test was "do not divide by zero", not
    // "the price is zero" — and $0.00 per share IS a price claim. Callers now
    // render "—".
    expect(avgPriceUsd(1n, 0n, 2000)).toBeNull();
  });

  it("has no average to report without a rate", () => {
    // The same rule the rest of the app now follows: a missing ETH/USD rate
    // means we cannot price it, not that it is free.
    const shares = 500n * 10n ** 18n;
    expect(avgPriceUsd(usdToWei(1000, 2000), shares, 0)).toBeNull();
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

describe("sharesForPct", () => {
  const held = 1000n * 10n ** 18n;
  it("takes a floored percentage of the holding", () => {
    expect(sharesForPct(held, 100)).toBe(held);
    expect(sharesForPct(held, 50)).toBe(held / 2n);
    expect(sharesForPct(held, 25)).toBe(held / 4n);
  });
  it("clamps and guards", () => {
    expect(sharesForPct(held, 0)).toBe(0n);
    expect(sharesForPct(held, -5)).toBe(0n);
    expect(sharesForPct(held, 250)).toBe(held);
    expect(sharesForPct(0n, 100)).toBe(0n);
  });
});

describe("selectSide never buys — it only toggles selection", () => {
  it("selects, then deselects on re-tap", () => {
    expect(selectSide(null, "YES")).toBe("YES");
    expect(selectSide("YES", "NO")).toBe("NO");
    expect(selectSide("YES", "YES")).toBe(null);
  });
});
