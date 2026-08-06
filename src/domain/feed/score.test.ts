import { describe, it, expect } from "vitest";
import { scoreMarket, EMPTY_PROFILE, type FeedMarketSignals } from "./score";
import { FOLLOWS } from "./config";

const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

const signals = (o: Partial<FeedMarketSignals> = {}): FeedMarketSignals => ({
  onchainId: 1,
  category: "crypto",
  creator: null,
  createdAt: null,
  newBelievers1h: 0,
  newBelievers24h: 0,
  tradeCount1h: 0,
  tradeCount24h: 0,
  uniqueWallets1h: 0,
  uniqueWallets24h: 0,
  velocity5m: 0,
  volumeUsd24h: 0,
  directionalBelievers: 0,
  divergence: 0,
  priceMovePct: 0,
  momentumWeight: 0,
  opportunityType: null,
  opportunityReason: null,
  opportunityScore: null,
  opportunityEligible: false,
  tribeSide: null,
  oppSide: null,
  tribeCount: 0,
  oppCount: 0,
  followedHere: 0,
  followedYes: 0,
  followedNo: 0,
  followedNames: [],
  connectedToOrigin: 0,
  hasMedia: false,
  ...o,
});

const score = (s: FeedMarketSignals) =>
  scoreMarket({ signals: s, ai: undefined, viewer: EMPTY_PROFILE, now: NOW, epoch: 0 });

describe("the market you arrived from reaches into what comes next", () => {
  it("lifts a market that shares people with the origin", () => {
    const plain = score(signals()).score;
    const connected = score(signals({ connectedToOrigin: 2 })).score;
    expect(connected).toBeGreaterThan(plain);
  });

  /**
   * Deliberately the weakest social claim in the model. A shared participant is
   * a fact about a stranger — one overlap is a coincidence — so this carries a
   * search into the queue without letting it take the queue over.
   */
  it("is weaker than a person the viewer actually chose", () => {
    const followed = score(signals({ followedHere: 1 })).score;
    const connected = score(signals({ connectedToOrigin: 3 })).score;
    expect(connected).toBeLessThan(followed);
  });

  it("changes nothing when the reader simply walked down the feed", () => {
    expect(score(signals({ connectedToOrigin: 0 })).score).toBe(score(signals()).score);
  });

  it("saturates — a crowded market is not a stronger thread", () => {
    const three = score(signals({ connectedToOrigin: 3 })).score;
    const thirty = score(signals({ connectedToOrigin: 30 })).score;
    expect(thirty).toBe(three);
  });
});

describe("following raises a market, it does not select one", () => {
  it("lifts a market where someone followed is active", () => {
    const plain = score(signals()).score;
    const followed = score(signals({ followedHere: 1 })).score;
    expect(followed).toBeGreaterThan(plain);
  });

  /**
   * The whole difference between a ranking term and a filter: a followed
   * person's market moves up, and an unfollowed market with real momentum still
   * outranks it. If this ever fails, the feed has quietly become a following
   * list.
   */
  it("does not beat a market that is genuinely moving", () => {
    const quietButFollowed = score(signals({ followedHere: FOLLOWS.SATURATE_AT })).score;
    // "Genuinely moving" is now `momentumWeight` — a drift-corrected change from
    // the same engine every panel renders. This fixture used to say it with
    // `newBelievers1h: 10, tradeCount1h: 18`, which described a platform that
    // does not exist: zero markets here have ever had a believer or a trade
    // inside one hour, so the old "loud" market was loud only in the test.
    const loudAndUnfollowed = score(
      signals({ momentumWeight: 0.9, newBelievers24h: 4, tradeCount24h: 14, volumeUsd24h: 400 }),
    ).score;
    expect(loudAndUnfollowed).toBeGreaterThan(quietButFollowed);
  });

  /**
   * The gradient, pinned: a single follow is a cheap gesture and should NOT
   * beat a Tribe relationship the DNA engine only asserts after real agreement
   * across real markets. Several followed people in one market should, because
   * that is no longer a gesture.
   */
  it("ranks one follow below an inferred Tribe, and several above it", () => {
    const tribe = score(signals({ tribeSide: "YES" })).score;
    expect(score(signals({ followedHere: 1 })).score).toBeLessThan(tribe);
    expect(score(signals({ followedHere: FOLLOWS.SATURATE_AT })).score).toBeGreaterThan(tribe);
  });

  it("saturates, so one prolific creator cannot own a feed", () => {
    const four = score(signals({ followedHere: 4 })).score;
    const forty = score(signals({ followedHere: 40 })).score;
    expect(forty - four).toBeLessThan(four - score(signals({ followedHere: 1 })).score);
  });

  it("changes nothing for a viewer who follows nobody", () => {
    // The anonymous and never-followed cases must score exactly as before.
    expect(score(signals({ followedHere: 0 })).score).toBe(score(signals()).score);
  });
});
