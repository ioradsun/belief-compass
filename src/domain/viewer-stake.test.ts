import { describe, it, expect } from "vitest";
import {
  stakeBoost,
  stakeReason,
  stakesIn,
  STAKE_WEIGHT,
  MAX_STAKE_BOOST,
  NO_STAKES,
  type ViewerStakes,
} from "./viewer-stake";
import { MAX_RELATIONSHIP_BOOST } from "./viewer-relationship";
import { CADENCE } from "./feed-cadence";

const stakes = (o: Partial<Record<keyof ViewerStakes, number[]>> = {}): ViewerStakes => ({
  created: new Set(o.created ?? []),
  holding: new Set(o.holding ?? []),
});

describe("the ranker finally knows about your own markets", () => {
  it("ranks a question you asked above one you merely hold", () => {
    const s = stakes({ created: [1], holding: [2] });
    expect(stakeBoost(1, s)).toBeGreaterThan(stakeBoost(2, s));
  });

  it("ranks a question you asked above a position you hold", () => {
    expect(STAKE_WEIGHT.created).toBeGreaterThan(STAKE_WEIGHT.holding);
  });

  /**
   * There is no market-following stake: `follows` is wallet-to-wallet, so a
   * followed PERSON's rows travel on the discovery axis instead. Shipping a
   * weight nothing could populate is the bug that left the celebration family
   * reserved and empty.
   */
  it("has no stake it cannot populate", () => {
    expect(Object.keys(STAKE_WEIGHT).sort()).toEqual(["created", "holding"]);
  });

  it("says nothing about a market you have no stake in", () => {
    expect(stakeBoost(9, stakes({ created: [1] }))).toBe(0);
    expect(stakeReason(9, stakes({ created: [1] }))).toBeNull();
    expect(stakeBoost(1, NO_STAKES)).toBe(0);
  });

  /**
   * Creating a market and also holding it is ONE relationship to it, not two.
   * Summing them would let a bookkeeping detail outrank a genuinely bigger
   * stake elsewhere — the same rule `relationshipBoost` applies to people.
   */
  it("takes the strongest stake, never the sum", () => {
    const both = stakes({ created: [1], holding: [1] });
    expect(stakesIn(1, both)).toEqual(["created", "holding"]);
    expect(stakeBoost(1, both)).toBe(stakeBoost(1, stakes({ created: [1] })));
  });
});

/**
 * Personalization competes inside the queue; it never skips it. A market flip in
 * a stranger's market is still bigger news than a dust trade in yours, and a
 * feed that inverted that would be a feed about you rather than the platform.
 */
describe("your own markets compete, they do not interrupt", () => {
  it("cannot lift a weak row into the breaking band on its own", () => {
    const dust = 0.2;
    expect(dust + stakeBoost(1, stakes({ created: [1] }))).toBeLessThan(CADENCE.breakingAt);
  });

  it("cannot carry a row from below the quality floor to above it by much", () => {
    // A row that does not deserve to be there is not rescued by being yours.
    expect(MAX_STAKE_BOOST).toBeLessThan(CADENCE.breakingAt - CADENCE.minQuality);
  });

  it("shares the ceiling with relationship personalization", () => {
    // Two axes, one bound — so they cannot outbid each other into a different
    // product, whichever one a given reader happens to have more of.
    expect(MAX_STAKE_BOOST).toBe(MAX_RELATIONSHIP_BOOST);
  });

  it("never exceeds that ceiling, whatever the combination", () => {
    const everything = stakes({ created: [1], holding: [1] });
    expect(stakeBoost(1, everything)).toBeLessThanOrEqual(MAX_STAKE_BOOST);
  });
});

describe("why a row is here, in the reader's own words", () => {
  it("names the strongest stake and only that one", () => {
    expect(stakeReason(1, stakes({ created: [1], holding: [1] }))).toBe("Your question");
    expect(stakeReason(1, stakes({ holding: [1] }))).toBe("You're in this");
  });

  it("stays silent rather than labelling the absence of a reason", () => {
    expect(stakeReason(1, NO_STAKES)).toBeNull();
  });
});
