import { describe, it, expect } from "vitest";
import {
  convictionSeries,
  timelineEvents,
  leadStory,
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
    const ev = timelineEvents([...small, t({ w: "whale", eth: 100, t: now - 1000 })], "YES", "24h", now);
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
