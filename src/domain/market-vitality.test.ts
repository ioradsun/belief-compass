import { describe, it, expect } from "vitest";
import { marketVitality, vitalityRange, vitalityStory } from "./market-vitality";
import type { TapeTrade } from "./conviction-series";

const NOW = Date.UTC(2026, 0, 10, 12, 0, 0);
const DAY = 86_400_000;
const ago = (ms: number) => NOW - ms;
const t = (o: Partial<TapeTrade> = {}): TapeTrade => ({
  w: "a",
  side: "YES",
  action: "BUY",
  eth: 1,
  price: 0.5,
  t: ago(2 * DAY),
  ...o,
});

describe("vitalityRange", () => {
  it("shows a young market since creation", () => {
    expect(vitalityRange(ago(3 * 3_600_000), NOW).kind).toBe("since-creation");
  });
  it("shows a 3 day old market over 24 hours", () => {
    expect(vitalityRange(ago(3 * DAY), NOW).kind).toBe("24h");
  });
  it("shows an old market over 7 days", () => {
    expect(vitalityRange(ago(30 * DAY), NOW).label).toBe("Past 7 days");
  });
});

describe("marketVitality", () => {
  it("counts each directional wallet once, both sides combined", () => {
    const v = marketVitality(
      [t({ w: "a" }), t({ w: "a", eth: 2 }), t({ w: "b", side: "NO", eth: 3 })],
      NOW,
    );
    expect(v.believers).toBe(2);
    expect(v.capitalEth).toBe(6);
  });

  it("excludes a wallet holding both sides", () => {
    const v = marketVitality([t({ w: "a" }), t({ w: "a", side: "NO" })], NOW);
    expect(v.believers).toBe(0);
    expect(v.capitalEth).toBe(2);
  });

  it("drops a wallet that sold out", () => {
    const v = marketVitality([t({ w: "a" }), t({ w: "a", action: "SELL", eth: 1 })], NOW);
    expect(v.believers).toBe(0);
    expect(v.capitalEth).toBe(0);
  });

  it("reports the window delta, not the lifetime total", () => {
    const v = marketVitality(
      [t({ w: "a", t: ago(20 * DAY) }), t({ w: "b", t: ago(1 * DAY) })],
      NOW,
    );
    expect(v.believers).toBe(2);
    expect(v.believersDelta).toBe(1);
  });

  it("never reveals a side", () => {
    const v = marketVitality([t({ w: "a" })], NOW);
    expect(Object.keys(v).join(" ")).not.toMatch(/yes|no/i);
  });
});

describe("vitalityStory", () => {
  it("says nothing happened on an empty market", () => {
    expect(vitalityStory(marketVitality([], NOW))).toBe("Conviction is just beginning to form.");
  });

  it("reads people and money rising together", () => {
    const trades = Array.from({ length: 6 }, (_, i) =>
      t({ w: `w${i}`, eth: 1, t: ago(6 * 3_600_000) }),
    );
    expect(vitalityStory(marketVitality([...trades, t({ w: "old", t: ago(40 * DAY) })], NOW))).toBe(
      "More people are joining, and capital is following.",
    );
  });

  it("reads a shrinking crowd with steady capital", () => {
    const v = marketVitality(
      [
        t({ w: "a", t: ago(40 * DAY) }),
        t({ w: "b", t: ago(40 * DAY) }),
        t({ w: "c", t: ago(40 * DAY) }),
        t({ w: "c", action: "SELL", eth: 1, t: ago(2 * DAY) }),
        t({ w: "d", eth: 1, t: ago(2 * DAY) }),
        t({ w: "d", action: "SELL", eth: 1, t: ago(1 * DAY) }),
      ],
      NOW,
    );
    expect(vitalityStory(v)).toMatch(/narrowing|cooling/);
  });
});
