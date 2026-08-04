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
    // The $0.20 and $3.84 stay out; the $54–$78 trades are the day's story.
    expect(admitted).toBe(5);
  });

  it("keeps dust out at ANY density", () => {
    for (const usd of [0.2, 3.84, DENSITY.dustUsd - 0.01])
      expect(admitToFeed(trade({ amountUsd: usd, marketBelievers: 100 }), DENSITY.hardFloor)).toBe(
        false,
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
