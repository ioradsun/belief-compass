import { describe, it, expect } from "vitest";
import {
  BARS,
  DEFAULT_SENSITIVITY,
  MATERIAL,
  SENSITIVITY_ORDER,
  barFor,
  changeFrom24hRow,
  changeFromBaseline,
  currencyDrift,
  headlineBarFor,
  isRateMove,
  marketChange,
  materialMoves,
  metricChange,
  sideChange,
  sideMaterialMoves,
  significance,
  topMaterialMove,
  type SideChange,
} from "./market-change";
import { FEED_TRIGGERS } from "./feed-event";

const now = {
  yes: { believers: 20, capitalUsd: 100, priceUsd: 2 },
  no: { believers: 10, capitalUsd: 50, priceUsd: 1 },
};
const base = {
  yes: { believers: 16, capitalUsd: 80, priceUsd: 1.9 },
  no: { believers: 10, capitalUsd: 50, priceUsd: 1 },
};

describe("one metric, one derivation", () => {
  it("pairs a current with a base and reports the move", () => {
    const m = metricChange(100, 80, "capital");
    expect(m).toEqual({ current: 100, base: 80, delta: 20, pct: 25, rank: "headline" });
  });

  it("defers to gain — a dust base yields no percentage anywhere", () => {
    const m = metricChange(2.6959, 0.004, "capital");
    expect(m.rank).toBe("origin");
    expect(m.pct).toBeNull();
    expect(m.delta).toBeCloseTo(2.6919, 4);
  });

  it("says 'no history' rather than 'no change' when there is no baseline", () => {
    const m = metricChange(100, null, "capital");
    expect(m.rank).toBe("unknown");
    expect(m.base).toBeNull();
    expect(m.delta).toBeNull();
    // The current state is still a fact and is still handed over.
    expect(m.current).toBe(100);
  });

  it("never invents a count's ratio", () => {
    expect(metricChange(3, 1, "believers").pct).toBeNull();
  });
});

/**
 * The centre panel and the side panels used to derive this window from two
 * different sources — a capped trade replay and a snapshot baseline — and could
 * disagree on the same screen. Adding the sides here is what makes that
 * impossible rather than merely unlikely.
 */
describe("the market total is the two sides added, by construction", () => {
  const c = marketChange(now, base, "24h");

  it("totals the currents and the bases", () => {
    expect(c.market.believers.current).toBe(30);
    expect(c.market.believers.base).toBe(26);
    expect(c.market.believers.delta).toBe(4);
    expect(c.market.capital.current).toBe(150);
    expect(c.market.capital.base).toBe(130);
  });

  it("equals the sum of the per-side deltas it displays beside", () => {
    expect(c.market.believers.delta).toBe(
      (c.yes.believers.delta ?? 0) + (c.no.believers.delta ?? 0),
    );
    expect(c.market.capital.delta).toBeCloseTo(
      (c.yes.capital.delta ?? 0) + (c.no.capital.delta ?? 0),
      9,
    );
  });

  it("has no market-wide price — a per-share price of 'the market' is not a quantity", () => {
    expect("price" in c.market).toBe(false);
  });

  it("refuses a total when one side is unknown, rather than showing half as the whole", () => {
    const partial = marketChange({ yes: now.yes, no: { believers: null } }, base, "24h");
    expect(partial.market.believers.current).toBeNull();
    expect(partial.market.believers.rank).toBe("unknown");
  });

  it("still totals the current when only the history is missing", () => {
    const c2 = marketChange(now, null, "24h");
    expect(c2.market.believers.current).toBe(30);
    expect(c2.market.believers.rank).toBe("unknown");
  });
});

describe("two loaders, one shape", () => {
  it("recovers the base by subtraction from the market_state row", () => {
    const c = changeFrom24hRow({
      believersYes: 20,
      believersNo: 10,
      newBelieversYes24h: 4,
      newBelieversNo24h: 0,
      yesCapitalUsd: 100,
      noCapitalUsd: 50,
      yesCapitalDelta24h: 20,
      noCapitalDelta24h: 0,
      yesPriceUsd: 2,
      noPriceUsd: 1,
      yesPriceBaseUsd: 2 / 1.1,
    });
    expect(c.yes.believers.base).toBe(16);
    expect(c.yes.capital.base).toBe(80);
    expect(c.yes.price.base).toBeCloseTo(2 / 1.1, 9);
    expect(c.window).toBe("24h");
  });

  it("treats a missing stored delta as no history, not as zero", () => {
    const c = changeFrom24hRow({
      yesCapitalUsd: 100,
      yesCapitalDelta24h: null,
      believersYes: 5,
      newBelieversYes24h: null,
    });
    expect(c.yes.capital.rank).toBe("unknown");
    expect(c.yes.believers.rank).toBe("unknown");
  });

  it("produces the same structure from a window baseline", () => {
    const c = changeFromBaseline(
      now,
      {
        believersYes: 16,
        believersNo: 10,
        yesCapitalUsd: 80,
        noCapitalUsd: 50,
        yesPriceUsd: 1.9,
        noPriceUsd: 1,
      },
      "7d",
    );
    expect(c.yes.capital.pct).toBe(25);
    expect(c.window).toBe("7d");
    // Identical to the row loader's answer for the same numbers.
    expect(c.yes.capital.delta).toBe(
      changeFrom24hRow({ yesCapitalUsd: 100, yesCapitalDelta24h: 20 }).yes.capital.delta,
    );
  });

  it("an absent baseline is unknown, not flat", () => {
    const c = changeFromBaseline(now, null, "1h");
    expect(c.yes.capital.rank).toBe("unknown");
    expect(c.yes.capital.current).toBe(100);
  });
});

describe("major news — five percent, where a percent is real", () => {
  const quiet = marketChange(now, now, "24h");

  it("says nothing about a market that did not move", () => {
    expect(materialMoves(quiet)).toEqual([]);
    expect(topMaterialMove(quiet)).toBeNull();
  });

  it("reports a 5% capital move on an established side", () => {
    const c = marketChange(
      { yes: { capitalUsd: 105 }, no: {} },
      { yes: { capitalUsd: 100 }, no: {} },
      "24h",
    );
    const [m] = materialMoves(c);
    expect(m.metric).toBe("capital");
    expect(m.kind).toBe("rate");
    expect(m.side).toBe("YES");
    expect(m.direction).toBe("up");
    expect(m.pct).toBeCloseTo(5, 9);
  });

  it("reports a fall as loudly as a rise", () => {
    const c = marketChange(
      { yes: { capitalUsd: 60 }, no: {} },
      { yes: { capitalUsd: 100 }, no: {} },
      "24h",
    );
    expect(materialMoves(c)[0].direction).toBe("down");
  });

  it("does not fire a fraction under the bar", () => {
    const c = marketChange(
      { yes: { capitalUsd: 104 }, no: {} },
      { yes: { capitalUsd: 100 }, no: {} },
      "24h",
    );
    expect(materialMoves(c)).toEqual([]);
  });

  /**
   * The whole reason the rule is gated. 22% of funded sides hold under a cent;
   * on those every trade is thousands of percent, and a news rule that fired on
   * the ratio alone would call a five-cent move major.
   */
  it("never manufactures news from a dust base", () => {
    const c = marketChange(
      { yes: { capitalUsd: 0.06 }, no: {} },
      { yes: { capitalUsd: 0.004 }, no: {} },
      "24h",
    );
    expect(isRateMove(c.yes.capital)).toBe(false);
    // Six cents is an origin, but too small to be worth naming.
    expect(materialMoves(c)).toEqual([]);
  });

  it("names real first capital as an arrival, with no percentage", () => {
    const c = marketChange(
      { yes: { capitalUsd: 40 }, no: {} },
      { yes: { capitalUsd: 0 }, no: {} },
      "24h",
    );
    const [m] = materialMoves(c);
    expect(m.kind).toBe("arrival");
    expect(m.pct).toBeNull();
    expect(m.delta).toBe(40);
  });

  it("carries believer news on the count, never on a manufactured rate", () => {
    // 1 → 4 believers: no base to divide by, but three people arriving is news.
    const c = marketChange(
      { yes: { believers: 4 }, no: {} },
      { yes: { believers: 1 }, no: {} },
      "24h",
    );
    const [m] = materialMoves(c);
    expect(m.metric).toBe("believers");
    expect(m.kind).toBe("crowd");
    expect(m.pct).toBeNull();
    expect(m.delta).toBe(3);
  });

  it("lets a real crowd's percentage speak once it has a base", () => {
    const c = marketChange(
      { yes: { believers: 24 }, no: {} },
      { yes: { believers: 20 }, no: {} },
      "24h",
    );
    const [m] = materialMoves(c);
    expect(m.kind).toBe("rate");
    expect(m.pct).toBe(20);
  });

  it("reports one believer move per side, not the same one twice", () => {
    const c = marketChange(
      { yes: { believers: 24 }, no: {} },
      { yes: { believers: 20 }, no: {} },
      "24h",
    );
    expect(materialMoves(c).filter((m) => m.metric === "believers")).toHaveLength(1);
  });

  it("does not call two people a crowd", () => {
    const c = marketChange(
      { yes: { believers: 3 }, no: {} },
      { yes: { believers: 1 }, no: {} },
      "24h",
    );
    expect(materialMoves(c)).toEqual([]);
    expect(MATERIAL.minBelieverDelta).toBe(3);
  });

  it("orders by size, so a 60% move outranks one that just cleared the bar", () => {
    const c = marketChange(
      { yes: { capitalUsd: 160 }, no: { capitalUsd: 105 } },
      { yes: { capitalUsd: 100 }, no: { capitalUsd: 100 } },
      "24h",
    );
    const moves = materialMoves(c);
    expect(moves[0].side).toBe("YES");
    expect(moves[0].weight).toBeGreaterThan(moves[1].weight);
  });

  it("reports both sides when both moved", () => {
    const c = marketChange(
      { yes: { capitalUsd: 130, priceUsd: 2.4 }, no: { capitalUsd: 70 } },
      { yes: { capitalUsd: 100, priceUsd: 2 }, no: { capitalUsd: 100 } },
      "24h",
    );
    const sides = new Set(materialMoves(c).map((m) => m.side));
    expect(sides).toEqual(new Set(["YES", "NO"]));
  });

  it("says nothing when there is no baseline at all", () => {
    expect(materialMoves(marketChange(now, null, "24h"))).toEqual([]);
  });

  it("holds the product's line at five percent", () => {
    expect(MATERIAL.minPct).toBe(5);
  });
});

/**
 * A share is worth a fixed 0.001 ETH until somebody trades it, so the DOLLAR
 * value of every market moves together with the exchange rate having done
 * nothing. Measured over 1,194 live sides in one 24h window, the USD price
 * change was +1.196% at the 5th, 25th, 50th, 75th AND 95th percentile — not one
 * side was flat. At a 5% bar that is invisible until ETH moves 5%, and then the
 * unguarded rule declares a major move on all 2,762 markets at once.
 */
describe("a currency move is not a market move", () => {
  const drifted = (pct: number) =>
    marketChange(
      { yes: { capitalUsd: 100 * (1 + pct / 100) }, no: {} },
      { yes: { capitalUsd: 100 }, no: {} },
      "24h",
    );

  it("measures the drift as the move the whole cross-section shares", () => {
    // The typical market never trades, so the median IS the currency.
    const cross = [1.2, 1.196, 1.196, 1.196, 1.2, 1.196, 41, 1.196, -30, 1.196];
    expect(currencyDrift(cross)).toBeCloseTo(1.196, 3);
  });

  it("refuses to guess a drift from too few markets", () => {
    expect(currencyDrift([1.2, 1.2, 1.2])).toBeNull();
    expect(currencyDrift([])).toBeNull();
    expect(currencyDrift([null, null, null, null, null, null, null, null])).toBeNull();
  });

  it("does not report a move that is entirely the exchange rate", () => {
    // A 6% ETH day: every market shows +6% and none of it is a market move.
    expect(materialMoves(drifted(6), 6)).toEqual([]);
  });

  it("still reports a real move on a volatile currency day", () => {
    // +14% gross on a +6% currency day is an +8% market move.
    const [m] = materialMoves(drifted(14), 6);
    expect(m.metric).toBe("capital");
    expect(m.pct).toBeCloseTo(8, 6);
  });

  it("reports a real FALL that the currency was masking", () => {
    // Flat in dollars on a +6% day means the market lost 6%.
    const [m] = materialMoves(drifted(0), 6);
    expect(m.direction).toBe("down");
    expect(m.pct).toBeCloseTo(-6, 6);
  });

  it("exempts counts — a believer is not denominated in anything", () => {
    const c = marketChange(
      { yes: { believers: 24 }, no: {} },
      { yes: { believers: 20 }, no: {} },
      "24h",
    );
    expect(materialMoves(c, 6)[0].pct).toBe(20);
  });

  it("behaves exactly as before when no drift could be measured", () => {
    expect(materialMoves(drifted(14), null)).toEqual(materialMoves(drifted(14)));
    expect(isRateMove(drifted(14).yes.capital)).toBe(true);
  });
});

/**
 * The product question the archetype harness surfaced: should a dramatic
 * percentage move in a tiny market outrank a smaller one in a much larger
 * market? Neither signal answers it alone.
 */
describe("significance weighs the move against the money", () => {
  const side = (nowCap: number, baseCap: number, nowPrice = 1.9, basePrice = 1.9): SideChange =>
    sideChange(
      { believers: 3, capitalUsd: nowCap, priceUsd: nowPrice },
      { believers: 3, capitalUsd: baseCap, priceUsd: basePrice },
    );

  const capitalWeight = (nowCap: number, baseCap: number): number =>
    sideMaterialMoves(side(nowCap, baseCap), "YES").find((m) => m.metric === "capital")?.weight ??
    0;

  it("ranks a big market's modest move above a tiny market's dramatic one", () => {
    // The exact case from the harness: $2 losing $1.90 vs $104 moving ~9%.
    const tinyButDramatic = capitalWeight(0.1, 2);
    const largeButModest = capitalWeight(94.6, 104);
    expect(tinyButDramatic).toBeGreaterThan(0);
    expect(largeButModest).toBeGreaterThan(tinyButDramatic);
  });

  it("still lets a small market qualify on a truly exceptional move", () => {
    // It must not be BURIED — dollar-only ranking would erase almost the whole
    // platform, whose median market holds under a dollar.
    const smallExceptional = capitalWeight(0.1, 8);
    const largeMarginal = capitalWeight(97, 100);
    expect(smallExceptional).toBeGreaterThan(0);
    expect(smallExceptional).toBeGreaterThan(largeMarginal);
  });

  it("rises with the money when the percentage is held constant", () => {
    const at = (base: number) => capitalWeight(base * 0.8, base);
    const climb = [5, 20, 100, 400].map(at);
    for (let i = 1; i < climb.length; i += 1) expect(climb[i]).toBeGreaterThan(climb[i - 1]!);
  });

  it("rises with the percentage when the money is held constant", () => {
    const a = capitalWeight(90, 100);
    const b = capitalWeight(50, 100);
    expect(b).toBeGreaterThan(a);
  });

  it("saturates so one whale cannot own the scale", () => {
    const big = capitalWeight(500, 1000);
    const huge = capitalWeight(500_000, 1_000_000);
    expect(huge).toBeLessThanOrEqual(1);
    expect(huge - big).toBeLessThan(0.35);
  });

  /**
   * A price is per-share, so its own delta is cents whatever the book is worth.
   * The side's CAPITAL is the honest absolute term: a 9% re-rate of a $104 book
   * moves more than a 9% re-rate of a $2 one, and the price delta alone cannot
   * tell them apart.
   */
  it("judges a price move by the capital it re-rates, not by cents per share", () => {
    const priceWeight = (cap: number) =>
      sideMaterialMoves(side(cap, cap, 2.09, 1.9), "YES").find((m) => m.metric === "price")
        ?.weight ?? 0;
    expect(priceWeight(200)).toBeGreaterThan(priceWeight(2));
  });

  /**
   * A believer count is already an absolute measure of itself — there is no
   * second unit to weigh it in — so counts keep the relative term alone.
   */
  it("leaves counts out of it", () => {
    const crowd = sideMaterialMoves(
      sideChange(
        { believers: 9, capitalUsd: 0.02, priceUsd: 1.9 },
        { believers: 1, capitalUsd: 0.02, priceUsd: 1.9 },
      ),
      "YES",
    ).find((m) => m.metric === "believers");
    // Eight people arriving is news even though almost no money is involved.
    expect(crowd?.weight ?? 0).toBeGreaterThan(0.5);
  });

  it("is bounded, whatever it is handed", () => {
    for (const [rel, usd] of [
      [0, 0],
      [1, 0],
      [0, 1e9],
      [1, 1e9],
      [-5, -5],
      [Number.NaN, Number.NaN],
    ]) {
      const w = significance(rel!, usd!);
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * The consolidation. Three modules used to answer the same three questions with
 * different numbers — price 8 / 5 / 3 across feed-event, market-change and the
 * momentum lens. These tests exist so a fourth copy cannot quietly appear.
 */
describe("one bar table, and every threshold is a row in it", () => {
  it("orders the rows from most permissive to strictest, on every axis", () => {
    const axes = ["minPct", "minBelieverDelta", "minUsd", "minRelPct"] as const;
    for (const axis of axes) {
      expect(BARS.everything[axis]).toBeLessThan(BARS.notable[axis]);
      expect(BARS.notable[axis]).toBeLessThan(BARS.major[axis]);
    }
  });

  it("makes the news bar a row rather than a table of its own", () => {
    expect(MATERIAL.minPct).toBe(BARS.notable.minPct);
    expect(MATERIAL.minBelieverDelta).toBe(BARS.notable.minBelieverDelta);
    expect(MATERIAL.minOriginUsd).toBe(BARS.notable.minOriginUsd);
  });

  /**
   * The activity feed's triggers were the third implementation, and its price
   * bar of 8% disagreed with the 5% both the product and the data had settled
   * on. It reads the table now.
   */
  it("makes the activity feed's triggers a view onto the same row", () => {
    expect(FEED_TRIGGERS.price.minPct).toBe(BARS.notable.minPct);
    expect(FEED_TRIGGERS.capital.minUsd).toBe(BARS.notable.minUsd);
    expect(FEED_TRIGGERS.capital.minRelPct).toBe(BARS.notable.minRelPct);
    expect(FEED_TRIGGERS.believers.minAbs).toBe(BARS.notable.minBelieverDelta);
  });

  /**
   * Being IN the feed and being the SENTENCE on the card are different
   * achievements, so the two bars must never be the same one — except at the
   * strictest setting, where there is nothing above it to climb to.
   */
  it("keeps the headline bar above the admission bar", () => {
    expect(headlineBarFor("everything").minPct).toBeGreaterThan(barFor("everything").minPct);
    expect(headlineBarFor("notable").minPct).toBeGreaterThan(barFor("notable").minPct);
    expect(headlineBarFor("major")).toEqual(barFor("major"));
  });

  /** A reader who never opens the control must get precisely today's feed. */
  it("defaults to the behaviour that already shipped", () => {
    expect(DEFAULT_SENSITIVITY).toBe("everything");
    expect(headlineBarFor(DEFAULT_SENSITIVITY)).toEqual(BARS.notable);
    expect(headlineBarFor(DEFAULT_SENSITIVITY).minPct).toBe(MATERIAL.minPct);
  });

  it("falls back to the default rather than throwing on anything unrecognised", () => {
    for (const junk of [null, undefined, "", "loud", 7, {}]) {
      expect(barFor(junk)).toEqual(BARS[DEFAULT_SENSITIVITY]);
    }
  });

  it("raises every bar as the reader asks for less", () => {
    const quieter = SENSITIVITY_ORDER.map((s) => barFor(s));
    for (let i = 1; i < quieter.length; i += 1) {
      expect(quieter[i]!.minPct).toBeGreaterThan(quieter[i - 1]!.minPct);
      expect(quieter[i]!.minUsd).toBeGreaterThan(quieter[i - 1]!.minUsd);
    }
  });
});
