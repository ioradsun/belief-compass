import { describe, it, expect } from "vitest";
import { findWashTrades, WASH, type JudgeableTrade } from "./wash-trading";

const T0 = Date.UTC(2026, 7, 5, 12, 0, 0);
const at = (msAgo: number) => new Date(T0 - msAgo).toISOString();

const trade = (o: Partial<JudgeableTrade> & { key: string }): JudgeableTrade => ({
  wallet: "0xchurner",
  marketId: "42",
  side: "YES",
  action: "BUY",
  amountEth: 0.036,
  occurredAt: at(0),
  ...o,
});

/** The measured production shape: a perfect alternating ladder, one wallet, one side. */
const ladder = (n: number, size = 0.036, gapMs = 60_000): JudgeableTrade[] =>
  Array.from({ length: n }, (_, i) =>
    trade({
      key: `t${i}`,
      action: i % 2 === 0 ? "SELL" : "BUY",
      amountEth: size,
      occurredAt: at(i * gapMs),
    }),
  );

describe("churn — the pattern is judged, not the pair", () => {
  it("flags a balanced ladder entirely", () => {
    const v = findWashTrades(ladder(8));
    expect(v.size).toBe(8);
    expect([...v.values()].every((r) => r === "churn")).toBe(true);
  });

  it("leaves a short run alone — that is trading, not a pattern", () => {
    // Below minTrades nothing is CHURN. The pairwise rule still catches the
    // matched legs inside it, which is the intended layering: round trips
    // handle the small case, churn handles the one that evaded it.
    const v = findWashTrades(ladder(WASH.minTrades - 1));
    expect([...v.values()].includes("churn")).toBe(false);
  });

  it("does not call a short run churn even when it is spaced out", () => {
    // Five trades, none pairable within 15 minutes, none of them a pattern.
    const sparse = ladder(WASH.minTrades - 1, 0.036, 16 * 60_000);
    expect(findWashTrades(sparse).size).toBe(0);
  });

  /**
   * The whole reason churn exists as a separate rule: pairwise matching only
   * catches trades inside a 15-minute window at under 2% size difference, so a
   * churner who widens either dimension walks straight back into the feed — and
   * arrives as an aggregated sweep, the loudest row there is.
   */
  it("catches a churner who jitters sizes past the round-trip tolerance", () => {
    const jittered = ladder(8).map((t, i) => ({ ...t, amountEth: 0.036 + i * 0.004 }));
    const v = findWashTrades(jittered);
    expect(v.size).toBeGreaterThanOrEqual(WASH.minTrades);
  });

  it("catches a churner who spaces trades past the round-trip window", () => {
    // 16-minute gaps: past the 15-minute pairing window, and 8 x 16 = 128 min
    // still fits the 2-hour churn window, so the ladder stays balanced.
    const slow = ladder(8, 0.036, 16 * 60_000);
    expect(findWashTrades(slow).size).toBe(8);
  });

  it("needs the window's contents to balance, not merely to be long", () => {
    // 20-minute gaps push the oldest trade out of the 2-hour window, leaving
    // seven — four sells against three buys. That is a net position, and the
    // rule correctly declines to call it churn. Balance is the whole test.
    const truncated = ladder(8, 0.036, 20 * 60_000);
    expect(findWashTrades(truncated).size).toBe(0);
  });

  it("does NOT flag someone who actually took a position", () => {
    // Eight buys and no sells: unbalanced, so they ended somewhere.
    const committed = ladder(8).map((t) => ({ ...t, action: "BUY" as const }));
    expect(findWashTrades(committed).size).toBe(0);
  });

  it("does not flag a lopsided run that merely looks busy", () => {
    const lopsided = ladder(8).map((t, i) =>
      i % 2 === 0 ? { ...t, amountEth: 0.036 } : { ...t, amountEth: 0.2 },
    );
    expect(findWashTrades(lopsided).size).toBe(0);
  });

  it("keeps separate markets and sides separate", () => {
    const spread = ladder(8).map((t, i) => ({
      ...t,
      marketId: String(40 + (i % 4)),
    }));
    expect(findWashTrades(spread).size).toBe(0);
  });
});

describe("round trip — one position, taken and given back", () => {
  const pair: JudgeableTrade[] = [
    trade({ key: "sell", action: "SELL", occurredAt: at(0) }),
    trade({ key: "buy", action: "BUY", occurredAt: at(5 * 60_000) }),
  ];

  it("flags BOTH legs", () => {
    // The feed drops the sell and refuses the buy at admission, so neither
    // reaches a reader. Metrics must match that net effect.
    const v = findWashTrades(pair);
    expect(v.get("sell")).toBe("round_trip");
    expect(v.get("buy")).toBe("round_trip");
  });

  it("does not pair across the window", () => {
    const apart = [pair[0], { ...pair[1], occurredAt: at(WASH.roundTripWindowMs + 1000) }];
    expect(findWashTrades(apart).size).toBe(0);
  });

  it("does not pair different sizes", () => {
    const uneven = [pair[0], { ...pair[1], amountEth: 0.1 }];
    expect(findWashTrades(uneven).size).toBe(0);
  });

  it("does not pair across wallets or sides", () => {
    expect(findWashTrades([pair[0], { ...pair[1], wallet: "0xother" }]).size).toBe(0);
    expect(findWashTrades([pair[0], { ...pair[1], side: "NO" }]).size).toBe(0);
  });

  it("consumes each leg once — three trades are not two round trips", () => {
    const three = [
      trade({ key: "s1", action: "SELL", occurredAt: at(0) }),
      trade({ key: "b1", action: "BUY", occurredAt: at(60_000) }),
      trade({ key: "b2", action: "BUY", occurredAt: at(120_000) }),
    ];
    expect(findWashTrades(three).size).toBe(2);
  });
});

describe("the verdict does not depend on how it was asked", () => {
  /**
   * One rule, two callers: the tape judges its own fetched buffer, the marker
   * judges a SQL page. A rule whose answer changes with input order is a rule
   * with two answers, and the whole point of this module is that the feed and
   * the scoreboard agree.
   */
  it("is identical for shuffled input", () => {
    const rows = ladder(8);
    const shuffled = [rows[3], rows[7], rows[0], rows[5], rows[1], rows[6], rows[2], rows[4]];
    const a = [...findWashTrades(rows).keys()].sort();
    const b = [...findWashTrades(shuffled).keys()].sort();
    expect(b).toEqual(a);
  });

  it("is identical for oldest-first input", () => {
    const rows = ladder(8);
    const a = [...findWashTrades(rows).keys()].sort();
    const b = [...findWashTrades([...rows].reverse()).keys()].sort();
    expect(b).toEqual(a);
  });

  it("says nothing about an empty set", () => {
    expect(findWashTrades([]).size).toBe(0);
  });
});

describe("churn outranks round trip when a trade is both", () => {
  it("keeps the stronger statement", () => {
    // A tight ladder satisfies both rules; the reason recorded should be the
    // one that describes the behaviour, not the one that happened to run last.
    const v = findWashTrades(ladder(8, 0.036, 60_000));
    expect([...v.values()].every((r) => r === "churn")).toBe(true);
  });
});
