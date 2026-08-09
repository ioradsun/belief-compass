import { describe, expect, it } from "vitest";
import { marketBook } from "../market-book";
import type { MarketChange } from "../market-change";
import { insiderPulse } from "./pulse";
import { marketStateFacts, pulseFactsFromMarket } from "./market-facts";

const book = marketBook([], Date.now());

const change = (believers: { current: number; base: number }, capitalUsd: { current: number; base: number }): MarketChange =>
  ({
    market: {
      believers: { current: believers.current, base: believers.base },
      capital: { current: capitalUsd.current, base: capitalUsd.base },
    },
  }) as unknown as MarketChange;

describe("pulseFactsFromMarket", () => {
  it("prefers the shared change answer over the tape replay", () => {
    const f = pulseFactsFromMarket({
      book,
      change: change({ current: 12, base: 8 }, { current: 400, base: 200 }),
      ethUsd: 2000,
    });
    expect(f.believers).toBe(12);
    expect(f.believerBase).toBe(8);
    expect(f.believerDelta).toBe(4);
    expect(f.capitalBaseEth).toBeCloseTo(0.1);
    expect(f.capitalDeltaEth).toBeCloseTo(0.1);
  });

  it("falls back to the book when no shared answer has arrived", () => {
    const f = pulseFactsFromMarket({ book, change: null, ethUsd: 2000 });
    expect(f.believers).toBe(book.believers.market.current);
    expect(f.capitalBaseEth).toBe(book.capitalEth.market.base);
  });

  it("drops USD-denominated facts when the rate is unknown", () => {
    const f = pulseFactsFromMarket({
      book,
      ethUsd: 0,
      state: { capitalHeldYesUsd: 100, capitalHeldNoUsd: 50 },
    });
    expect(f.capitalHeldYesEth).toBeNull();
    expect(f.capitalHeldNoEth).toBeNull();
  });

  it("reads direction off the market_state split", () => {
    const yes = insiderPulse(
      pulseFactsFromMarket({
        book,
        ethUsd: 2000,
        state: { believersYes: 9, believersNo: 1, capitalHeldYesUsd: 900, capitalHeldNoUsd: 100 },
      }),
    );
    expect(yes.direction).toBe("YES");
    expect(yes.imbalance).toBeGreaterThan(0.5);
  });

  it("reads as calm and balanced with no state at all", () => {
    const p = insiderPulse(pulseFactsFromMarket({ book, ethUsd: 2000 }));
    expect(p.direction).toBe("BALANCED");
    expect(p.imbalance).toBe(0);
    expect(p.activity).toBe(0);
  });
});

describe("marketStateFacts", () => {
  it("maps the row columns it knows and nulls the rest", () => {
    const f = marketStateFacts({
      believers_yes: 4,
      believers_no: 2,
      yes_capital_usd: 120,
      trade_count_24h: 9,
      last_trade_at: "2026-08-09T12:00:00.000Z",
    });
    expect(f.believersYes).toBe(4);
    expect(f.believersNo).toBe(2);
    expect(f.capitalHeldYesUsd).toBe(120);
    expect(f.capitalHeldNoUsd).toBeNull();
    expect(f.tradeCount24h).toBe(9);
    expect(f.lastTradeAt).toBe("2026-08-09T12:00:00.000Z");
  });

  it("tolerates a missing row", () => {
    expect(marketStateFacts(null).believersYes).toBeNull();
  });
});
