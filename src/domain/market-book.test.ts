import { describe, expect, it } from "vitest";
import { classifyWallet, marketBook } from "@/domain/market-book";
import type { TapeTrade } from "@/domain/conviction-series";

const now = 1_000_000_000_000;
const hour = 3_600_000;
const day = 86_400_000;
const buy = (w: string, side: "YES" | "NO", eth: number, t: number): TapeTrade => ({
  w,
  side,
  action: "BUY",
  eth,
  price: 1,
  t,
});
const sell = (w: string, side: "YES" | "NO", eth: number, t: number): TapeTrade => ({
  w,
  side,
  action: "SELL",
  eth,
  price: 1,
  t,
});

describe("classifyWallet", () => {
  it("reads the net directional stance with a 0.10 band", () => {
    expect(classifyWallet(1, 0)).toBe("yes");
    expect(classifyWallet(0, 1)).toBe("no");
    expect(classifyWallet(0, 0)).toBe("inactive");
    expect(classifyWallet(1, 1)).toBe("mixed"); // stance 0
    expect(classifyWallet(1, 0.9)).toBe("mixed"); // stance ≈ 0.05 < 0.10
    expect(classifyWallet(1, 0.7)).toBe("yes"); // stance ≈ 0.176 ≥ 0.10
  });
});

describe("marketBook invariants", () => {
  it("always reconciles market = yes + no for believers and capital", () => {
    const tape = [
      buy("a", "YES", 3, now - 5 * day),
      buy("b", "NO", 2, now - 4 * day),
      buy("c", "YES", 1, now - 3 * day),
      buy("c", "NO", 1, now - 2 * day), // c becomes mixed
      buy("d", "NO", 4, now - day),
      sell("a", "YES", 3, now - hour), // a exits → inactive
    ];
    const bk = marketBook(tape, now);
    expect(bk.believers.market.current).toBe(bk.believers.yes.current + bk.believers.no.current);
    expect(bk.capitalEth.market.current).toBeCloseTo(
      bk.capitalEth.yes.current + bk.capitalEth.no.current,
    );
  });

  it("excludes a mixed wallet from believers but keeps its capital on each side", () => {
    // c holds 1 YES and 1 NO → mixed. b is directional NO. d is directional NO.
    const tape = [
      buy("b", "NO", 2, now - 4 * day),
      buy("d", "NO", 4, now - day),
      buy("c", "YES", 1, now - 3 * day),
      buy("c", "NO", 1, now - 2 * day),
    ];
    const bk = marketBook(tape, now);
    expect(bk.believers.yes.current).toBe(0); // c is mixed, not a YES believer
    expect(bk.believers.no.current).toBe(2); // b and d
    expect(bk.believers.market.current).toBe(2);
    expect(bk.mixedParticipants).toBe(1);
    // c's YES value still counts toward YES capital.
    expect(bk.capitalEth.yes.current).toBeCloseTo(1);
    expect(bk.capitalEth.no.current).toBeCloseTo(7); // b2 + d4 + c1
    expect(bk.capitalEth.market.current).toBeCloseTo(8);
  });

  it("drops fully-exited wallets from every current total", () => {
    const tape = [buy("a", "YES", 2, now - 3 * day), sell("a", "YES", 2, now - day)];
    const bk = marketBook(tape, now);
    expect(bk.believers.market.current).toBe(0);
    expect(bk.capitalEth.market.current).toBeCloseTo(0);
    expect(bk.inactiveParticipants).toBe(1);
  });
});

describe("series spans the full window (carry-forward to now)", () => {
  it("extends the last value flat to now when the final event is mid-window", () => {
    // One believer joined 2h ago; nothing since. Over the 24h window the series
    // must end at `now`, holding the value — not stop at the 2h-ago event.
    const bk = marketBook([buy("a", "YES", 1, now - 2 * hour)], now, "24h");
    const s = bk.believers.market.series;
    expect(s[s.length - 1].t).toBe(now);
    expect(s[s.length - 1].v).toBe(bk.believers.market.current);
  });

  it("draws a flat line at the held state when all activity predates the window", () => {
    // Everything happened 3 days ago; a 24h window has no in-window events, yet
    // the market still holds 1 believer / 2 ETH — a flat line, delta 0.
    const bk = marketBook([buy("a", "YES", 2, now - 3 * day)], now, "24h");
    const cap = bk.capitalEth.market;
    expect(cap.series[0].t).toBe(bk.window.sinceMs);
    expect(cap.series[cap.series.length - 1].t).toBe(now);
    expect(cap.current).toBeCloseTo(2);
    expect(cap.delta).toBeCloseTo(0); // carried forward, no in-window change
  });
});

describe("adaptive window", () => {
  it("labels a young market since open", () => {
    const bk = marketBook([buy("a", "YES", 1, now - 2 * hour)], now);
    expect(bk.window.short).toBe("SINCE OPEN");
  });

  it("measures believer growth against the window baseline", () => {
    const tape = [
      buy("a", "YES", 1, now - 3 * day), // before 24h window
      buy("b", "YES", 1, now - 2 * hour), // inside 24h
    ];
    const bk = marketBook(tape, now);
    expect(bk.window.short).toBe("24H");
    expect(bk.believers.market.current).toBe(2);
    expect(bk.believers.market.base).toBe(1); // 1 believer when the window opened
    expect(bk.believers.market.delta).toBe(1);
  });
});

describe("marketBook — same-timestamp chain order", () => {
  const t = 1_700_000_000_000;
  it("closes a round-trip inside one block instead of leaving phantom shares", () => {
    // Arrives newest-first (as the wire delivers it) and both legs share one
    // occurred_at; only block/log order says the BUY came first.
    const b = marketBook(
      [
        { w: "a", side: "YES", action: "SELL", eth: 1, price: null, t, seq: 100_000_002 },
        { w: "a", side: "YES", action: "BUY", eth: 1, price: null, t, seq: 100_000_001 },
      ],
      t + 1000,
    );
    expect(b.believers.market.current).toBe(0);
    expect(b.capitalEth.market.current).toBe(0);
    expect(b.inactiveParticipants).toBe(1);
  });
});
