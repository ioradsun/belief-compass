import { describe, it, expect } from "vitest";
import { convertMoney, formatMoney, formatRate, formatUsdPrice, isRateStale } from "./money";

const RATE = 2000; // 1 ETH = $2,000

describe("convertMoney", () => {
  it("is identity when units match (no rate needed)", () => {
    expect(convertMoney(123.45, "USD", "USD", 0)).toBe(123.45);
    expect(convertMoney(0.5, "ETH", "ETH", 0)).toBe(0.5);
  });

  it("converts USD↔ETH through the one rate", () => {
    expect(convertMoney(100, "USD", "ETH", RATE)).toBeCloseTo(0.05, 12);
    expect(convertMoney(0.05, "ETH", "USD", RATE)).toBeCloseTo(100, 12);
  });

  it("round-trips through the same rate exactly (the D2 guarantee)", () => {
    const usd = 137.42;
    const eth = convertMoney(usd, "USD", "ETH", RATE)!;
    expect(convertMoney(eth, "ETH", "USD", RATE)).toBeCloseTo(usd, 9);
  });

  it("refuses to convert without a positive rate (never fabricates)", () => {
    expect(convertMoney(100, "USD", "ETH", 0)).toBeNull();
    expect(convertMoney(100, "ETH", "USD", -5)).toBeNull();
    expect(convertMoney(100, "USD", "ETH", Number.NaN)).toBeNull();
  });

  it("rejects non-finite values", () => {
    expect(convertMoney(Number.NaN, "USD", "USD", RATE)).toBeNull();
    expect(convertMoney(Number.POSITIVE_INFINITY, "ETH", "USD", RATE)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("renders USD with cents below $1k and grouped whole dollars above", () => {
    expect(formatMoney(12.3, { from: "USD", to: "USD", ethUsd: RATE })).toBe("$12.30");
    expect(formatMoney(2500, { from: "USD", to: "USD", ethUsd: RATE })).toBe("$2,500");
  });

  it("renders ETH with adaptive precision and trimmed zeros", () => {
    expect(formatMoney(0.05, { from: "ETH", to: "ETH", ethUsd: RATE })).toBe("\u039E0.05");
    expect(formatMoney(0.004, { from: "ETH", to: "ETH", ethUsd: RATE })).toBe("\u039E0.004");
    expect(formatMoney(12.5, { from: "ETH", to: "ETH", ethUsd: RATE })).toBe("\u039E12.5");
  });

  it("converts a USD-native value into the chosen ETH display", () => {
    expect(formatMoney(100, { from: "USD", to: "ETH", ethUsd: RATE })).toBe("\u039E0.05");
  });

  it("converts an ETH-native value (committed capital) into USD display", () => {
    expect(formatMoney(0.05, { from: "ETH", to: "USD", ethUsd: RATE })).toBe("$100.00");
  });

  it("signs gains with + / − and always marks a loss", () => {
    expect(formatMoney(18, { from: "USD", to: "USD", ethUsd: RATE, signed: true })).toBe("+$18.00");
    expect(formatMoney(-20, { from: "USD", to: "USD", ethUsd: RATE, signed: true })).toBe(
      "−$20.00",
    );
    // Negative shows the minus even without `signed`.
    expect(formatMoney(-5, { from: "USD", to: "USD", ethUsd: RATE })).toBe("−$5.00");
  });

  it("shows an em dash rather than a wrong number when the rate is missing", () => {
    expect(formatMoney(100, { from: "USD", to: "ETH", ethUsd: 0 })).toBe("—");
    expect(formatMoney(100, { from: "ETH", to: "USD", ethUsd: Number.NaN })).toBe("—");
  });
});

describe("formatRate", () => {
  it("states the rate in use (whole dollars at $1k+)", () => {
    expect(formatRate(2000)).toBe("1 ETH = $2,000");
    expect(formatRate(3214)).toBe("1 ETH = $3,214");
    expect(formatRate(42.5)).toBe("1 ETH = $42.50");
  });
  it("is null when the rate is unknown", () => {
    expect(formatRate(0)).toBeNull();
    expect(formatRate(-1)).toBeNull();
  });
});

describe("formatUsdPrice", () => {
  it("shows the rate as a plain price with cents", () => {
    expect(formatUsdPrice(3421.18)).toBe("$3,421.18");
    expect(formatUsdPrice(2000)).toBe("$2,000.00");
  });
  it("is null when the rate is unknown (never a fabricated number)", () => {
    expect(formatUsdPrice(0)).toBeNull();
    expect(formatUsdPrice(Number.NaN)).toBeNull();
  });
});

describe("isRateStale", () => {
  const now = 1_000_000_000;
  it("is fresh within the window, stale beyond it", () => {
    expect(isRateStale(now - 60_000, now)).toBe(false); // 1 min old
    expect(isRateStale(now - 31 * 60_000, now)).toBe(true); // 31 min old
  });
  it("treats a missing timestamp as stale (cannot prove freshness)", () => {
    expect(isRateStale(null, now)).toBe(true);
    expect(isRateStale(undefined, now)).toBe(true);
    expect(isRateStale(Number.NaN, now)).toBe(true);
  });
});
