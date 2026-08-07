import { describe, it, expect } from "vitest";
import {
  convictionSeries,
  timelineEvents,
  leadStory,
  convictionStory,
  narrateStory,
  type SeriesPoint,
  type TapeTrade,
} from "./conviction-series";

const H = 3_600_000;
const now = 1_800_000_000_000;

const t = (o: Partial<TapeTrade>): TapeTrade => ({
  w: "a",
  side: "YES",
  action: "BUY",
  eth: 1,
  price: 1,
  t: now - H,
  ...o,
});

describe("convictionSeries", () => {
  it("accumulates distinct believers and capital, and normalizes to the window start", () => {
    const trades = [
      t({ w: "a", t: now - 30 * H, eth: 2, price: 1 }),
      t({ w: "b", t: now - 2 * H, eth: 2, price: 1.5 }),
      t({ w: "c", t: now - H, eth: 4, price: 2 }),
    ];
    const s = convictionSeries(trades, "YES", "24h", now);
    const last = s[s.length - 1];
    expect(last.believers).toBe(3);
    expect(last.capital).toBe(8);
    // window opens with 1 believer / 2 ETH → +200% people, +300% money, +100% price
    expect(Math.round(last.believersPct)).toBe(200);
    expect(Math.round(last.capitalPct)).toBe(300);
    expect(Math.round(last.pricePct!)).toBe(100);
  });

  it("starts every line at zero", () => {
    const s = convictionSeries([t({ t: now - H })], "YES", "24h", now);
    expect(s[0].believersPct).toBe(0);
    expect(s[0].capitalPct).toBe(0);
  });

  it("sells reduce capital but never below zero, and never remove a believer", () => {
    const s = convictionSeries(
      [t({ w: "a", eth: 3, t: now - 2 * H }), t({ w: "a", action: "SELL", eth: 9, t: now - H })],
      "YES",
      "24h",
      now,
    );
    const last = s[s.length - 1];
    expect(last.capital).toBe(0);
    expect(last.believers).toBe(1);
  });

  it("ignores the other side entirely", () => {
    const s = convictionSeries([t({ side: "NO", w: "z" })], "YES", "24h", now);
    expect(s).toEqual([]);
  });

  it("carries the last state forward to now (flat, not truncated at the last event)", () => {
    // One trade an hour ago, inside a 24h window. The series must reach `now`,
    // holding the value flat — inactivity is state, not missing data.
    const s = convictionSeries([t({ w: "a", eth: 2, t: now - H })], "YES", "24h", now);
    const last = s[s.length - 1];
    expect(last.t).toBe(now); // right edge is the window end, not the last event
    expect(last.believers).toBe(1);
    expect(last.capital).toBe(2);
    // Flat carry-forward: the point before `now` holds the same value.
    expect(s[s.length - 2].capital).toBe(2);
  });

  it("draws a flat line to now when all activity predates the window", () => {
    // Last trade 30h ago; a 24h window has no in-window events. Rather than one
    // orphan point, the side reads as a continuous flat line at its held state.
    const s = convictionSeries([t({ w: "a", eth: 3, t: now - 30 * H })], "YES", "24h", now);
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s[s.length - 1].t).toBe(now);
    expect(s[s.length - 1].believers).toBe(1);
    expect(s[s.length - 1].capital).toBe(3);
    // No change across the window → 0% move, never a fabricated jump.
    expect(s[s.length - 1].believersPct).toBe(0);
    expect(s[s.length - 1].capitalPct).toBe(0);
  });

  it("downsamples long histories while keeping the last point", () => {
    const many = Array.from({ length: 900 }, (_, i) =>
      t({ w: `w${i}`, t: now - 900 * 1000 + i * 1000 }),
    );
    const s = convictionSeries(many, "YES", "24h", now, 60);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s[s.length - 1].believers).toBe(900);
  });
});

describe("timelineEvents", () => {
  it("groups arrivals into one beat per bucket", () => {
    const trades = [
      t({ w: "a", t: now - 60_000 }),
      t({ w: "b", t: now - 50_000 }),
      t({ w: "c", t: now - 40_000 }),
    ];
    const ev = timelineEvents(trades, "YES", "24h", now);
    const believers = ev.filter((e) => e.kind === "believers");
    expect(believers).toHaveLength(1);
    expect(believers[0].text).toBe("3 believers joined YES");
  });

  it("calls out an outsized single buy on its own", () => {
    const small = Array.from({ length: 9 }, (_, i) =>
      t({ w: `w${i}`, eth: 1, t: now - 3600_000 - i * 1000 }),
    );
    const ev = timelineEvents(
      [...small, t({ w: "whale", eth: 100, t: now - 1000 })],
      "YES",
      "24h",
      now,
    );
    expect(ev.some((e) => e.kind === "whale" && e.eth === 100)).toBe(true);
  });

  it("marks believer milestones only when actually crossed", () => {
    const trades = Array.from({ length: 10 }, (_, i) => t({ w: `w${i}`, t: now - 10_000 + i }));
    const ev = timelineEvents(trades, "YES", "24h", now);
    expect(ev.some((e) => e.kind === "milestone" && e.text.includes("10 believers"))).toBe(true);
    expect(ev.some((e) => e.text.includes("25 believers"))).toBe(false);
  });

  it("is newest-first and bounded", () => {
    const trades = Array.from({ length: 200 }, (_, i) =>
      t({ w: `w${i}`, t: now - i * 20 * 60_000 }),
    );
    const ev = timelineEvents(trades, "YES", "all", now, 8);
    expect(ev.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < ev.length; i++) expect(ev[i - 1].t).toBeGreaterThanOrEqual(ev[i].t);
  });
});

describe("leadStory", () => {
  it("reads a lone large position as money leading", () => {
    const s = convictionSeries(
      [t({ w: "a", eth: 1, t: now - 30 * H }), t({ w: "a", eth: 40, t: now - H })],
      "YES",
      "24h",
      now,
    );
    expect(leadStory(s)).toBe("Money moved without new people — a large position led.");
  });
  it("says nothing when nothing happened", () => {
    expect(leadStory([])).toBeNull();
  });
});

describe("story copy edge cases", () => {
  const pts = (a: Partial<SeriesPoint>, z: Partial<SeriesPoint>): SeriesPoint[] =>
    [
      {
        t: 0,
        believers: 0,
        capital: 0,
        price: null,
        believersPct: 0,
        capitalPct: 0,
        pricePct: 0,
        ...a,
      },
      {
        t: 1,
        believers: 0,
        capital: 0,
        price: null,
        believersPct: 0,
        capitalPct: 0,
        pricePct: 0,
        ...z,
      },
    ] as SeriesPoint[];
  const money = (eth: number) => `$${(eth * 1000).toFixed(2)}`;

  it("dust capital never becomes a funding story", () => {
    const s = convictionStory(
      "YES",
      pts({ believers: 1, capital: 1 }, { believers: 1, capital: 1.000001 }),
      {
        capitalDust: 0.000005,
      },
    )!;
    expect(s.headline).toBe("YES has been quiet");
    expect(s.capitalDeltaEth).toBe(0);
    expect(narrateStory(s, "YES", "today", money)).not.toContain("$0.00");
  });

  it("never says 'they' when nobody joined", () => {
    const s = convictionStory(
      "YES",
      pts({ believers: 2, capital: 1 }, { believers: 2, capital: 2 }),
    )!;
    expect(narrateStory(s, "YES", "today", money)).toContain("Existing believers committed");
  });

  it("reports believers leaving instead of 'quiet'", () => {
    const s = convictionStory(
      "NO",
      pts({ believers: 4, capital: 1 }, { believers: 2, capital: 1 }),
    )!;
    expect(s.headline).toBe("NO is losing believers");
  });

  it("omits price when it did not move", () => {
    const s = convictionStory(
      "YES",
      pts({ believers: 0, capital: 0 }, { believers: 1, capital: 1, pricePct: 0 }),
    )!;
    expect(narrateStory(s, "YES", "today", money)).not.toContain("Price rose");
  });
});
