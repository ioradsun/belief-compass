import { describe, it, expect } from "vitest";
import {
  buildPriceBlock,
  priceWindowLabel,
  downsampleSeries,
  MIN_SPARK_POINTS,
  type DailyPoint,
} from "./feed-price";

function days(pcts: number[]): DailyPoint[] {
  // Consecutive daily buckets ending today.
  const start = new Date("2026-05-01T00:00:00Z").getTime();
  return pcts.map((pct, i) => ({
    bucket: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    pct,
  }));
}

describe("priceWindowLabel — never overclaims history", () => {
  it("labels honestly to what accrued", () => {
    expect(priceWindowLabel(60)).toBe("2 months");
    expect(priceWindowLabel(45)).toBe("6 weeks");
    expect(priceWindowLabel(21)).toBe("3 weeks");
    expect(priceWindowLabel(5)).toBe("5 days");
    expect(priceWindowLabel(1)).toBe("1 day");
    expect(priceWindowLabel(0)).toBe("today");
  });
});

describe("downsampleSeries", () => {
  it("keeps first and last and caps the count", () => {
    const big = Array.from({ length: 200 }, (_, i) => i);
    const out = downsampleSeries(big, 60);
    expect(out.length).toBe(60);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(199);
  });
  it("leaves short series untouched", () => {
    expect(downsampleSeries([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe("buildPriceBlock", () => {
  it("prefers the fresh implied % and computes a day-over-day 24h change", () => {
    const b = buildPriceBlock(days([70, 74, 80]), 84)!;
    expect(b.impliedPct).toBe(84); // current money-weighted %, not the last daily avg
    expect(b.chg24h).toBe(6); // 80 − 74
    expect(b.series).toEqual([70, 74, 80]);
  });

  it("labels a short window truthfully — never a confident 2 months", () => {
    const b = buildPriceBlock(days([50, 52, 51, 55, 60, 58, 62]), 62)!; // 7 daily points
    expect(b.windowDays).toBe(6);
    expect(b.windowLabel).toBe("6 days");
  });

  it("falls back to the last bucket when no live implied % is given", () => {
    const b = buildPriceBlock(days([40, 42]), null)!;
    expect(b.impliedPct).toBe(42);
    expect(b.chg24h).toBe(2);
  });

  it("still shows implied % with a single point (renderer omits the sparkline)", () => {
    const b = buildPriceBlock(days([55]), null)!;
    expect(b.impliedPct).toBe(55);
    expect(b.chg24h).toBeNull(); // no prior day → no honest 24h number
    expect(b.series.length).toBeLessThan(MIN_SPARK_POINTS);
  });

  it("returns null only when there is nothing honest to show", () => {
    expect(buildPriceBlock([], null)).toBeNull();
  });
});
