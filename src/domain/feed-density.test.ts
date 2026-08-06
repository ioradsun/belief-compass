import { describe, it, expect } from "vitest";
import { adaptiveFloor, admitToFeed, DENSITY } from "./feed-density";
import { scoreFeedEvent, type FeedCandidate } from "./feed-event";

const trade = (o: Partial<FeedCandidate> = {}): FeedCandidate => ({
  kind: "trade_burst",
  side: "YES",
  amountUsd: 60,
  walletCount: 1,
  tradeCount: 1,
  marketBelievers: 100,
  ...o,
});

/**
 * The exact rows povnumbers showed in one 28-minute window, while
 * conviction.company's live tape rendered two rows and an empty column. This is
 * the fixture the whole module exists for.
 */
const POV_WINDOW = [0.2, 3.84, 54.01, 62.99, 69.99, 70.19, 77.99];

const run = (usds: number[], believers: number) => {
  const cands = usds.map((amountUsd) => trade({ amountUsd, marketBelievers: believers }));
  const { floor, relaxed } = adaptiveFloor(cands.map((c) => scoreFeedEvent(c).score));
  return { floor, relaxed, admitted: cands.filter((c) => admitToFeed(c, floor)).length };
};

describe("the day pov was alive and we were not", () => {
  it("used to drop every one of those trades in a mid-size market", () => {
    // The regression this module fixes: an absolute bar, and nothing clears it.
    const believers = 100;
    const material = POV_WINDOW.map((amountUsd) =>
      scoreFeedEvent(trade({ amountUsd, marketBelievers: believers })),
    ).filter((s) => s.tier <= 3);
    expect(material).toHaveLength(0);
  });

  it("now admits the real ones, and still refuses the dust", () => {
    const { admitted, relaxed } = run(POV_WINDOW, 100);
    expect(relaxed).toBe(true);
    // Only the $0.20 is dust now. $3.84 squeaks in on a quiet day, which is the
    // rule working as intended: the bar comes from the day, and a real if small
    // stake is a better row than an empty column. See DENSITY.dustUsd for why
    // that floor moved from $5 — measured trade sizes here are cents, not tens.
    expect(admitted).toBe(6);
  });

  it("keeps dust out at ANY density", () => {
    // Sizes measured in production: two cents cannot be a position at any price.
    for (const usd of [0.02, 0.04, 0.2, DENSITY.dustUsd - 0.01])
      expect(admitToFeed(trade({ amountUsd: usd, marketBelievers: 100 }), DENSITY.hardFloor)).toBe(
        false,
      );
  });

  it("lets a real if small stake through — the platform trades in cents", () => {
    // $0.72 and $2.46 are ordinary here. A $5 floor rejected both, which was the
    // empty feed all over again, one layer down.
    for (const usd of [0.72, 2.46])
      expect(admitToFeed(trade({ amountUsd: usd, marketBelievers: 6 }), DENSITY.hardFloor)).toBe(
        true,
      );
  });

  it("but a tiny trade that EARNED its place still shows", () => {
    // A Twin's $3 buy is the product working, not noise. The dust rule gates
    // only the relaxed path, never a row that cleared the bar on its merits.
    expect(admitToFeed(trade({ amountUsd: 3, relationship: "twin" }), DENSITY.hardFloor)).toBe(
      true,
    );
  });
});

describe("the bar comes from the day, not from a constant", () => {
  it("changes nothing on a busy day", () => {
    const busy = Array.from({ length: 30 }, () => trade({ amountUsd: 900 }));
    const { floor, relaxed } = adaptiveFloor(busy.map((c) => scoreFeedEvent(c).score));
    expect(relaxed).toBe(false);
    expect(floor).toBe(DENSITY.standard);
  });

  it("never rises above the standard bar — this can only add rows", () => {
    const huge = Array.from({ length: 50 }, () => trade({ amountUsd: 50_000 }));
    expect(adaptiveFloor(huge.map((c) => scoreFeedEvent(c).score)).floor).toBe(DENSITY.standard);
  });

  it("relaxes toward the Nth-best candidate, not to zero", () => {
    const quiet = Array.from({ length: 6 }, () => trade({ amountUsd: 40 }));
    const { floor } = adaptiveFloor(quiet.map((c) => scoreFeedEvent(c).score));
    expect(floor).toBeGreaterThanOrEqual(DENSITY.hardFloor);
    expect(floor).toBeLessThan(DENSITY.standard);
  });

  it("stops at the hard floor on a genuinely dead day", () => {
    const dust = Array.from({ length: 40 }, () => trade({ amountUsd: 0.05 }));
    const { floor } = adaptiveFloor(dust.map((c) => scoreFeedEvent(c).score));
    expect(floor).toBeGreaterThanOrEqual(DENSITY.hardFloor);
    // A short feed is the right answer. Padding it with dust would be a lie.
    expect(dust.filter((c) => admitToFeed(c, floor)).length).toBe(0);
  });

  it("holds the standard bar when there is nothing to judge", () => {
    expect(adaptiveFloor([])).toEqual({ floor: DENSITY.standard, relaxed: false });
  });
});

describe("what never comes back", () => {
  it("a wash is not activity, however quiet the day", () => {
    expect(admitToFeed(trade({ kind: "round_trip", amountUsd: 5000 }), DENSITY.hardFloor)).toBe(
      false,
    );
  });

  it("a structural event is admitted exactly as before", () => {
    for (const kind of ["market_created", "believer_milestone", "side_shift", "tribe_doubled"])
      expect(admitToFeed(trade({ kind, amountUsd: null }), DENSITY.standard)).toBe(true);
  });
});

describe("meaning outranks money", () => {
  const at = (o: Partial<FeedCandidate>) => scoreFeedEvent(trade(o)).score;

  it("a small exit after three months beats a larger entry from a newcomer", () => {
    expect(at({ amountUsd: 12, conviction: "exit", daysHeld: 90 })).toBeGreaterThan(
      at({ amountUsd: 200, conviction: "enter", daysHeld: 0 }),
    );
  });

  it("the longer the belief, the bigger the ending", () => {
    const ladder = [1, 7, 30, 90, 365].map((d) =>
      at({ amountUsd: 40, conviction: "exit", daysHeld: d }),
    );
    expect(ladder).toEqual([...ladder].sort((a, b) => a - b));
  });

  it("changing your mind is the loudest thing one person can do", () => {
    const flip = at({ amountUsd: 40, conviction: "flip" });
    for (const k of ["enter", "add", "reduce"] as const)
      expect(flip).toBeGreaterThan(at({ amountUsd: 40, conviction: k, daysHeld: 30 }));
  });

  it("doubling down reads as more than arriving", () => {
    expect(at({ amountUsd: 40, conviction: "add" })).toBeGreaterThan(
      at({ amountUsd: 40, conviction: "enter" }),
    );
  });

  it("lifts a long-held exit over the publish bar on its own", () => {
    // $40 in a 100-believer market is Tier 4 on money alone. After 90 days of
    // belief it is a story, and it no longer needs a quiet day to be told.
    expect(scoreFeedEvent(trade({ amountUsd: 40 })).tier).toBe(4);
    expect(
      scoreFeedEvent(trade({ amountUsd: 40, conviction: "exit", daysHeld: 90 })).tier,
    ).toBeLessThanOrEqual(3);
  });

  it("scores identically when no conviction context is known", () => {
    expect(at({ amountUsd: 60 })).toBe(at({ amountUsd: 60, conviction: null, daysHeld: null }));
  });

  it("cannot overshoot, however much meaning piles on", () => {
    expect(
      at({ amountUsd: 1e9, conviction: "flip", daysHeld: 5000, walletCount: 99 }),
    ).toBeLessThanOrEqual(100);
  });
});

/**
 * THE RELATIVE TERM HAS TO WORK WHERE THE PLATFORM ACTUALLY LIVES.
 *
 * `magnitudeOf` weights a trade's fraction of its market's own scale at 60% —
 * "reaching its normal scale is a full-magnitude move". The reference was
 * `max($20, believers × $8)`, and measured against 269 funded markets that
 * floor bound on 78% of them (210 have two believers or fewer) while sitting at
 * TWENTY TIMES the median market's entire capital of $0.96.
 *
 * The consequence was not a missing rule but a dead one: inside a typical
 * market, a $0.08 trade and a $0.96 trade both scored ≈0 on the term meant to
 * separate them, and the ranking fell through to the people count — identical
 * for every lone trade. That is what makes a young platform feel uniformly busy
 * instead of meaningfully active.
 */
describe("significance is relative to the market it happened in", () => {
  const inMarket = (amountUsd: number, believers: number) =>
    scoreFeedEvent(trade({ amountUsd, marketBelievers: believers })).score;

  it("separates a cent-sized trade from a market-sized one on a typical market", () => {
    // The median funded market: one believer, $0.96 of capital.
    const dust = inMarket(0.08, 1);
    const whole = inMarket(0.96, 1);
    // Not merely "greater" — under the old reference these were 1.41x apart on
    // magnitude and a couple of points apart on score, which is indistinguishable
    // once the constant people and novelty terms are added. The gap has to be
    // wide enough to survive that dilution.
    expect(whole - dust).toBeGreaterThanOrEqual(5);
  });

  it("still calls the same dollar amount noise in a market that dwarfs it", () => {
    // $1 is most of a small market and nothing in a large one. The SAME trade,
    // scored by where it happened — which is the whole point of the term.
    expect(inMarket(1, 1)).toBeGreaterThan(inMarket(1, 100));
  });

  it("scales with the market rather than jumping at a fixed dollar line", () => {
    const ladder = [1, 3, 10, 37].map((b) => inMarket(5, b));
    // A $5 trade matters less the bigger the room it lands in, monotonically.
    expect(ladder).toEqual([...ladder].sort((a, b) => b - a));
  });
});
