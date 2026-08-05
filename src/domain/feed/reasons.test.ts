import { describe, it, expect } from "vitest";
import { reasonFor } from "./reasons";
import type { FeedMarketSignals, ScoredMarket } from "./score";

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

const scored = (o: Partial<ScoredMarket> = {}): ScoredMarket => ({
  onchainId: 1,
  score: 50,
  components: {
    momentum: 0,
    personal: 0,
    freshness: 0,
    social: 0,
    quality: 0,
    early: 0,
    exploration: 0,
  },
  driver: "momentum",
  acceleration: 1,
  ageHours: 500,
  ...o,
});

describe("a follow is the reason the viewer can check", () => {
  it("names the person and the side", () => {
    const r = reasonFor(
      signals({ followedHere: 1, followedYes: 1, followedNames: ["Reyhan"] }),
      scored(),
    );
    expect(r).toEqual({ code: "follows", text: "Reyhan is backing YES" });
  });

  it("counts them when several went the same way", () => {
    const r = reasonFor(signals({ followedHere: 3, followedNo: 3 }), scored());
    expect(r).toEqual({ code: "follows", text: "3 people you follow are backing NO" });
  });

  it("says someone rather than 1 person, and rather than an address", () => {
    expect(reasonFor(signals({ followedHere: 1, followedYes: 1 }), scored())?.text).toBe(
      "Someone you follow is backing YES",
    );
  });

  /**
   * A split is the reason. Naming one of them would pick a winner out of a
   * disagreement the reader is being shown precisely because it is unresolved.
   */
  it("reports a split rather than choosing a side of it", () => {
    const r = reasonFor(
      signals({ followedHere: 4, followedYes: 3, followedNo: 1, followedNames: ["Reyhan"] }),
      scored(),
    );
    expect(r).toEqual({ code: "follows", text: "4 people you follow are split here" });
  });

  /**
   * `followedHere` counts connections; `followedYes + followedNo` counts sides.
   * A followed creator who never backed their own market is the gap between
   * them, and has no side to report.
   */
  it("falls back to presence when the only connection is authorship", () => {
    expect(reasonFor(signals({ followedHere: 1 }), scored())?.text).toBe(
      "Someone you follow is active here",
    );
    expect(reasonFor(signals({ followedHere: 2 }), scored())?.text).toBe(
      "2 people you follow are active here",
    );
  });

  /**
   * The ordering that matters: a follow is a choice the viewer made, a Tribe is
   * a conclusion the DNA engine drew. When both are true, say the one they can
   * verify.
   */
  it("outranks an inferred Tribe or Rival", () => {
    const both = signals({ followedHere: 2, tribeSide: "YES", oppSide: "NO" });
    expect(reasonFor(both, scored())?.code).toBe("follows");
  });

  it("still yields to a market that is genuinely taking off", () => {
    // Momentum is about the market and beats every relationship line, because a
    // market accelerating right now is the more perishable fact.
    const hot = signals({ followedHere: 4, newBelievers1h: 5 });
    expect(reasonFor(hot, scored({ acceleration: 2 }))?.code).toBe("taking_off");
  });

  it("says nothing about follows when nobody followed is here", () => {
    expect(reasonFor(signals({ tribeSide: "YES" }), scored())?.code).toBe("tribe");
  });

  /**
   * The side used to be withheld here on privacy grounds, over positions that
   * are public on-chain and held by people this viewer chose to follow. The
   * effect was that the one reason a reader could verify was also the vaguest
   * on the card.
   */
  it("reports the follows' own side, not the inferred Tribe's", () => {
    const r = reasonFor(signals({ followedHere: 2, followedNo: 2, tribeSide: "YES" }), scored());
    expect(r?.text).toBe("2 people you follow are backing NO");
  });
});

describe("counts sharpen the sentence, they never gate it", () => {
  it("says how many of your Tribe are here when it knows", () => {
    expect(reasonFor(signals({ tribeSide: "YES", tribeCount: 3 }), scored())?.text).toBe(
      "3 people in your Tribe are backing YES",
    );
  });

  it("counts your Rivals the same way", () => {
    expect(reasonFor(signals({ oppSide: "NO", oppCount: 2 }), scored())?.text).toBe(
      "2 of your Rivals are backing NO",
    );
  });

  /**
   * The case that matters most. The overlay read `cache[0]` for its entire
   * history, so every stored row has a side and no count — and a viewer whose
   * DNA has not formed yet still has none. If a count were required, the
   * relationship sentence would vanish for everyone it used to work for.
   */
  it("still speaks with a side and no count at all", () => {
    expect(reasonFor(signals({ tribeSide: "YES", tribeCount: 0 }), scored())?.text).toBe(
      "Your Tribe is backing YES",
    );
    expect(reasonFor(signals({ oppSide: "NO", oppCount: 0 }), scored())?.text).toBe(
      "A Rival is backing NO",
    );
  });

  it("does not say '1 people' — one person is the singular sentence", () => {
    expect(reasonFor(signals({ tribeSide: "YES", tribeCount: 1 }), scored())?.text).toBe(
      "Your Tribe is backing YES",
    );
  });
});

describe("the fallbacks still hold", () => {
  it("falls through to category interest when nothing social applies", () => {
    const r = reasonFor(signals(), scored({ driver: "personal" }));
    expect(r).toEqual({ code: "interest", text: "Picked from your interest in crypto" });
  });

  it("says nothing rather than something empty", () => {
    expect(reasonFor(signals({ category: null }), scored({ driver: "personal" }))).toBeNull();
  });
});
