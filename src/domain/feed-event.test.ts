import { describe, it, expect } from "vitest";
import {
  scoreFeedEvent,
  includeInFeed,
  believerTrigger,
  capitalTrigger,
  priceTrigger,
  switchTrigger,
  socialTrigger,
  compositeSignal,
  FEED_TRIGGERS,
  type FeedCandidate,
} from "./feed-event";

const trade = (over: Partial<FeedCandidate>): FeedCandidate => ({
  kind: "trade_burst",
  side: "YES",
  amountUsd: null,
  walletCount: 1,
  tradeCount: 1,
  windowMs: 0,
  relationship: null,
  marketBelievers: null,
  ...over,
});

describe("market-relative magnitude — the central rule", () => {
  it("drops the same small trade in a whale market but keeps it in a tiny one", () => {
    const whale = trade({ amountUsd: 6, marketBelievers: 1000 });
    const tiny = trade({ amountUsd: 6, marketBelievers: 2 });
    expect(includeInFeed(whale)).toBe(false); // dust — belongs in the ledger
    expect(includeInFeed(tiny)).toBe(true); // could be the start of a movement
    expect(scoreFeedEvent(tiny).score).toBeGreaterThan(scoreFeedEvent(whale).score);
  });

  it("a $500 trade in a large market is not automatically feed-worthy", () => {
    const big = trade({ amountUsd: 500, marketBelievers: 4000 });
    expect(scoreFeedEvent(big).tier).toBe(4);
    expect(includeInFeed(big)).toBe(false);
  });

  it("more wallets moving together lifts magnitude", () => {
    const solo = trade({ amountUsd: 40, walletCount: 1, marketBelievers: 30 });
    const crowd = trade({ amountUsd: 40, walletCount: 5, tradeCount: 5, marketBelievers: 30 });
    expect(scoreFeedEvent(crowd).score).toBeGreaterThan(scoreFeedEvent(solo).score);
  });
});

describe("structural transitions always rank", () => {
  it("a fresh market is Breaking (Tier 1)", () => {
    expect(scoreFeedEvent(trade({ kind: "market_created", amountUsd: null })).tier).toBe(1);
  });
  it("a believer milestone is Breaking", () => {
    expect(scoreFeedEvent(trade({ kind: "believer_milestone", amountUsd: null })).tier).toBe(1);
  });
  it("a tribe doubling is Breaking", () => {
    expect(scoreFeedEvent(trade({ kind: "tribe_doubled", amountUsd: null })).tier).toBe(1);
  });
  it("a lone side flip is Context, a multi-wallet flip is Breaking", () => {
    expect(
      scoreFeedEvent(trade({ kind: "side_shift", amountUsd: null, walletCount: 1 })).tier,
    ).toBe(2);
    expect(
      scoreFeedEvent(trade({ kind: "side_shift", amountUsd: null, walletCount: 3 })).tier,
    ).toBe(1);
  });
  it("all structural rows are included in the feed", () => {
    for (const kind of ["market_created", "believer_milestone", "tribe_doubled", "side_shift"]) {
      expect(includeInFeed(trade({ kind, amountUsd: null }))).toBe(true);
    }
  });
});

describe("personal relevance lifts an event", () => {
  it("a Twin's small action is Breaking and always shown", () => {
    const t = trade({ amountUsd: 10, marketBelievers: 500, relationship: "twin" });
    expect(scoreFeedEvent(t).tier).toBe(1);
    expect(scoreFeedEvent(t).dimension).toBe("social");
    expect(includeInFeed(t)).toBe(true);
  });
  it("a Rival (opp) action is Breaking", () => {
    expect(scoreFeedEvent(trade({ amountUsd: 10, relationship: "opp" })).tier).toBe(1);
  });
  it("a single Tribe member is at least Context and kept", () => {
    const t = trade({ amountUsd: 8, marketBelievers: 800, relationship: "tribe" });
    expect(scoreFeedEvent(t).tier).toBeLessThanOrEqual(3);
    expect(includeInFeed(t)).toBe(true);
  });
  it("the same action scores higher when it's your Twin than a stranger", () => {
    const base = { amountUsd: 20, marketBelievers: 100 } as const;
    expect(scoreFeedEvent(trade({ ...base, relationship: "twin" })).score).toBeGreaterThan(
      scoreFeedEvent(trade({ ...base })).score,
    );
  });
});

describe("washes and dust", () => {
  it("a round-trip is Tier 4 and excluded", () => {
    expect(scoreFeedEvent(trade({ kind: "round_trip", amountUsd: 50 })).tier).toBe(4);
    expect(includeInFeed(trade({ kind: "round_trip", amountUsd: 50 }))).toBe(false);
  });
});

describe("speed rewards bursts", () => {
  it("a fast cluster of trades outranks one lone trade of the same size", () => {
    const lone = trade({ amountUsd: 60, tradeCount: 1, walletCount: 1, marketBelievers: 40 });
    const burst = trade({
      amountUsd: 60,
      tradeCount: 6,
      walletCount: 4,
      windowMs: 3 * 60_000,
      marketBelievers: 40,
    });
    expect(scoreFeedEvent(burst).score).toBeGreaterThan(scoreFeedEvent(lone).score);
  });
});

describe("section-10 trigger predicates", () => {
  it("believerTrigger: absolute or relative", () => {
    expect(believerTrigger(3, 100)).toBe(true); // ≥3 absolute
    expect(believerTrigger(2, 4)).toBe(false); // small abs, small base
    expect(believerTrigger(3, 10)).toBe(true); // 30% off base 10
    expect(believerTrigger(1, 100)).toBe(false); // 1% off a big base
  });
  it("capitalTrigger: material + relative, or a spike", () => {
    expect(capitalTrigger({ deltaUsd: 100, priorUsd: 500 })).toBe(true); // $100, 20%
    expect(capitalTrigger({ deltaUsd: 100, priorUsd: 5000 })).toBe(false); // 2% of a big pool
    // Below the USD floor. Expressed FROM the constant: this assertion is about
    // the floor existing, not about the number it happens to be, and writing the
    // number twice is how a fixture silently stops testing what it names.
    expect(capitalTrigger({ deltaUsd: FEED_TRIGGERS.capital.minUsd / 2, priorUsd: 20 })).toBe(
      false,
    );
    expect(capitalTrigger({ deltaUsd: 30, priorUsd: 10000, recentUsd: 90, baselineUsd: 20 })).toBe(
      true,
    ); // 4.5× baseline spike
  });
  it("priceTrigger: past the 8% bar", () => {
    expect(priceTrigger(8)).toBe(true);
    expect(priceTrigger(-9)).toBe(true);
    expect(priceTrigger(4)).toBe(false);
    expect(priceTrigger(null)).toBe(false);
  });
  it("switchTrigger: at least two wallets", () => {
    expect(switchTrigger(2)).toBe(true);
    expect(switchTrigger(1)).toBe(false);
  });
  it("socialTrigger: a cluster or one twin/opp", () => {
    expect(socialTrigger({ clusterWallets: 1, twinOrOpp: true })).toBe(true);
    expect(socialTrigger({ clusterWallets: 2, twinOrOpp: false })).toBe(true);
    expect(socialTrigger({ clusterWallets: 1, twinOrOpp: false })).toBe(false);
  });
});

describe("composite contradictions", () => {
  it("more believers, less capital", () => {
    expect(compositeSignal({ believerDelta: 4, capitalDeltaUsd: -60, pricePct: null })).toBe(
      "people-up-capital-down",
    );
  });
  it("capital up, people flat", () => {
    expect(compositeSignal({ believerDelta: 0, capitalDeltaUsd: 200, pricePct: null })).toBe(
      "capital-up-people-flat",
    );
  });
  it("price up, people flat", () => {
    // Capital deliberately below the floor, so PRICE is the only live signal.
    expect(
      compositeSignal({
        believerDelta: 0,
        capitalDeltaUsd: FEED_TRIGGERS.capital.minUsd / 2,
        pricePct: 12,
      }),
    ).toBe("price-up-people-flat");
  });
  it("aligned growth is not a contradiction", () => {
    expect(compositeSignal({ believerDelta: 5, capitalDeltaUsd: 200, pricePct: 10 })).toBeNull();
  });
});
