import { describe, it, expect } from "vitest";
import { convictionIndexSeries, indexOf, indexTrendCaption } from "./conviction-index";
import type { TapeTrade } from "./conviction-series";

const now = Date.UTC(2026, 0, 1, 12, 0, 0);
const M = 60_000;
const t = (o: Partial<TapeTrade> = {}): TapeTrade => ({
  w: "a",
  side: "YES",
  action: "BUY",
  eth: 1,
  price: 0.5,
  t: now - 30 * M,
  ...o,
});

describe("indexOf", () => {
  it("is the plain 40/40/20 blend", () => {
    expect(indexOf(100, 50, 0)).toBeCloseTo(60);
  });
});

describe("convictionIndexSeries", () => {
  it("scores a one-sided market near 100 on people and money", () => {
    const { steps } = convictionIndexSeries([t({ w: "a" }), t({ w: "b" })], "YES", "24h", now);
    const last = steps[steps.length - 1];
    expect(last.believerScore).toBe(100);
    expect(last.capitalScore).toBe(100);
    expect(last.priceScore).toBe(50);
    expect(Math.round(last.index)).toBe(90);
  });

  it("splits evenly when both sides match", () => {
    const { steps } = convictionIndexSeries(
      [t({ w: "a" }), t({ w: "b", side: "NO" })],
      "YES",
      "24h",
      now,
    );
    expect(Math.round(steps[steps.length - 1].index)).toBe(50);
  });

  it("labels a believer-driven jump", () => {
    const { steps } = convictionIndexSeries(
      [t({ w: "a", t: now - 90 * M }), t({ w: "b", t: now - 5 * M })],
      "YES",
      "1h",
      now,
    );
    expect(steps.at(-1)!.newBelievers).toBe(1);
    expect(steps.at(-1)!.emoji).toBe("👥");
  });

  it("returns nothing when the tape is empty", () => {
    expect(convictionIndexSeries([], "YES", "24h", now).opening).toBeNull();
  });

  it("captions a rise", () => {
    const { opening, steps } = convictionIndexSeries(
      [t({ w: "a", side: "NO", t: now - 200 * M }), t({ w: "b", t: now - 5 * M })],
      "YES",
      "1h",
      now,
    );
    expect(indexTrendCaption(opening, steps)).toContain("rose");
  });
});
