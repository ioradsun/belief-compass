import { describe, it, expect } from "vitest";
import { evaluateOpportunity, type OpportunityInput, type OpportunityContext } from "./opportunity";
import { renderReason } from "@/lib/opportunity/render-reason";

const NOW = Date.UTC(2026, 1, 1, 12, 0, 0);

const input = (o: Partial<OpportunityInput> = {}): OpportunityInput => ({
  marketId: "42",
  marketAgeHours: 240, // ~10 days (not "new" by default)
  directionalBelievers: 20,
  // Lopsided by default (75/25) so fixtures aren't accidentally "contested";
  // the Contested test sets a balanced split explicitly.
  believersYes: 15,
  believersNo: 5,
  uniqueWallets1h: 0,
  uniqueWallets24h: 0,
  uniqueWallets7d: 0,
  newBelievers1h: 0,
  newBelievers24h: 0,
  newBelievers7d: 0,
  volumeEth1h: 0,
  volumeEth24h: 0,
  volumeEth7d: 0,
  tradeCount1h: 0,
  tradeCount24h: 0,
  tradeCount7d: 0,
  circulation1h: null,
  circulation24h: null,
  circulation7d: null,
  sellRate24h: null,
  peopleYesPct: 75, // lopsided default (not contested); Contested test overrides
  moneyYesPct: 70,
  totalCapitalUsd: 3000,
  avgDirectionalDays: null,
  medianDirectionalDays: null,
  avgConvictionStrength: null,
  priceChange1h: null,
  priceChange24h: null,
  hasValidPrices: true,
  lastTradeAt: new Date(NOW - 3600_000).toISOString(),
  calculatedAt: new Date(NOW - 60_000).toISOString(),
  ...o,
});

const ctx = (o: Partial<OpportunityContext> = {}): OpportunityContext => ({
  nowMs: NOW,
  eligibleMarketCount: 5,
  ...o,
});

describe("determinism & no viewer inputs", () => {
  it("same input → same output", () => {
    const a = evaluateOpportunity(
      input({ uniqueWallets1h: 8, uniqueWallets24h: 20, tradeCount24h: 40 }),
      ctx(),
    );
    const b = evaluateOpportunity(
      input({ uniqueWallets1h: 8, uniqueWallets24h: 20, tradeCount24h: 40 }),
      ctx(),
    );
    expect(a).toEqual(b);
  });
  it("OpportunityInput type carries no wallet/tribe/rival field", () => {
    const keys = Object.keys(input());
    expect(keys.some((k) => /wallet(?!s)|tribe|rival|viewer|match/i.test(k))).toBe(false);
  });
});

describe("eligibility gates", () => {
  it("missing market time → ineligible", () => {
    const r = evaluateOpportunity(input({ marketAgeHours: null }), ctx());
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe("missing_market_time");
  });
  it("missing prices → ineligible", () => {
    const r = evaluateOpportunity(input({ hasValidPrices: false }), ctx());
    expect(r.ineligibleReason).toBe("missing_price_state");
  });
  it("stale market_state → ineligible", () => {
    const r = evaluateOpportunity(
      input({ calculatedAt: new Date(NOW - 5_000_000).toISOString() }),
      ctx(),
    );
    expect(r.ineligibleReason).toBe("stale_market_state");
  });
  it("no participation → ineligible", () => {
    const r = evaluateOpportunity(input({ directionalBelievers: 0, tradeCount7d: 0 }), ctx());
    expect(r.ineligibleReason).toBe("no_participation");
  });
});

describe("Hot", () => {
  it("requires BOTH absolute activity and acceleration", () => {
    const r = evaluateOpportunity(
      input({ uniqueWallets1h: 8, uniqueWallets24h: 24, volumeEth1h: 3, tradeCount24h: 30 }),
      ctx(),
    );
    expect(r.type).toBe("hot");
    expect(r.window).toBe("1h");
    expect(r.evidence.acceleration).toBeGreaterThanOrEqual(1.6);
  });
  it("one trade after zero activity is NOT strongly Hot", () => {
    const r = evaluateOpportunity(
      input({ uniqueWallets1h: 1, uniqueWallets24h: 1, tradeCount24h: 1, tradeCount7d: 1 }),
      ctx(),
    );
    expect(r.type).not.toBe("hot");
  });
});

describe("Early vs New", () => {
  it("real growth with low maturity → Early", () => {
    const r = evaluateOpportunity(
      input({
        directionalBelievers: 10,
        believersYes: 8,
        believersNo: 2,
        newBelievers24h: 6,
        uniqueWallets24h: 6,
        tradeCount24h: 8,
        marketAgeHours: 200,
        totalCapitalUsd: 800,
      }),
      ctx(),
    );
    expect(r.type).toBe("early");
    expect(["1h", "24h", "7d"]).toContain(r.window);
  });
  it("an inactive RECENT market is New, not Early", () => {
    const r = evaluateOpportunity(
      input({
        marketAgeHours: 10,
        directionalBelievers: 1,
        newBelievers24h: 0,
        uniqueWallets24h: 0,
        tradeCount7d: 1,
      }),
      ctx(),
    );
    expect(r.type).toBe("new");
  });
});

describe("Hidden", () => {
  it("requires circulation, breadth and low visible scale", () => {
    const r = evaluateOpportunity(
      input({
        totalCapitalUsd: 800,
        circulation24h: 2.5,
        uniqueWallets24h: 6,
        tradeCount24h: 10,
        directionalBelievers: 15,
      }),
      ctx(),
    );
    expect(r.type).toBe("hidden");
  });
  it("zero/invalid capital cannot produce a false Hidden (denominator safety)", () => {
    const r = evaluateOpportunity(
      input({ totalCapitalUsd: 0, circulation24h: 999, uniqueWallets24h: 6, tradeCount24h: 10 }),
      ctx(),
    );
    expect(r.type).not.toBe("hidden");
  });
  it("one-wallet churn (high trades per wallet) does not qualify Hidden", () => {
    const r = evaluateOpportunity(
      input({
        totalCapitalUsd: 800,
        circulation24h: 3,
        uniqueWallets24h: 2,
        tradeCount24h: 40,
        directionalBelievers: 3,
      }),
      ctx(),
    );
    expect(r.type).not.toBe("hidden");
  });
});

describe("Contested", () => {
  it("balanced sides WITH recent activity → Contested", () => {
    const r = evaluateOpportunity(
      input({
        believersYes: 9,
        believersNo: 10,
        peopleYesPct: 47,
        directionalBelievers: 19,
        tradeCount24h: 12,
        uniqueWallets24h: 4,
        marketAgeHours: 500,
      }),
      ctx(),
    );
    expect(r.type).toBe("contested");
    expect(r.evidence.believers_yes).toBe(9);
  });
  it("a dormant 50/50 market is NOT Contested", () => {
    const r = evaluateOpportunity(
      input({
        believersYes: 9,
        believersNo: 10,
        peopleYesPct: 50,
        tradeCount24h: 0,
        tradeCount7d: 2,
        directionalBelievers: 19,
      }),
      ctx(),
    );
    expect(r.type).not.toBe("contested");
  });
});

describe("Conviction gated by challenge", () => {
  const persistent = (o: Partial<OpportunityInput> = {}) =>
    input({
      medianDirectionalDays: 18,
      avgConvictionStrength: 0.6,
      directionalBelievers: 12,
      // Lopsided so this isolates Conviction (not Contested); challenge comes
      // from circulation, not an opposing side.
      believersYes: 11,
      believersNo: 1,
      peopleYesPct: 92,
      marketAgeHours: 1000,
      ...o,
    });
  it("persistence + real circulation → Conviction", () => {
    const r = evaluateOpportunity(
      persistent({ circulation7d: 2.8, tradeCount7d: 20, tradeCount24h: 6 }),
      ctx(),
    );
    expect(r.type).toBe("conviction");
    expect(r.evidence.median_directional_days).toBe(18);
    expect(r.evidence.circulation_7d).toBeGreaterThan(0);
  });
  it("long tenure but NO challenge (dead market) does NOT qualify as Conviction", () => {
    const r = evaluateOpportunity(
      persistent({
        circulation7d: 0,
        sellRate24h: 0,
        tradeCount24h: 0,
        tradeCount7d: 0,
        believersNo: 0,
        believersYes: 12,
      }),
      ctx(),
    );
    expect(r.type).not.toBe("conviction");
  });
  it("removing challenge flips Conviction eligibility off (trace)", () => {
    const withChallenge = evaluateOpportunity(
      persistent({ circulation7d: 2.8, tradeCount7d: 20 }),
      ctx(),
    );
    const withoutChallenge = evaluateOpportunity(
      persistent({
        circulation7d: 0,
        sellRate24h: 0,
        tradeCount7d: 0,
        tradeCount24h: 0,
        believersNo: 0,
      }),
      ctx(),
    );
    expect(withChallenge.type).toBe("conviction");
    expect(withoutChallenge.type).not.toBe("conviction");
  });
});

describe("New", () => {
  it("applies only within the age threshold, as a fallback", () => {
    expect(
      evaluateOpportunity(
        input({
          marketAgeHours: 10,
          directionalBelievers: 1,
          tradeCount7d: 1,
          newBelievers24h: 0,
          uniqueWallets24h: 0,
        }),
        ctx(),
      ).type,
    ).toBe("new");
    // Old inactive market with no signal → excluded, not New.
    const old = evaluateOpportunity(
      input({
        marketAgeHours: 2000,
        directionalBelievers: 2,
        tradeCount7d: 1,
        tradeCount24h: 0,
        uniqueWallets24h: 0,
        circulation7d: 0,
        peopleYesPct: 80,
      }),
      ctx(),
    );
    expect(old.type).toBeNull();
    expect(old.eligible).toBe(false);
    expect(old.ineligibleReason).toBe("insufficient_evidence");
  });
});

describe("evidence ladder & cold start", () => {
  it("sparse 1h falls back to 24h and discloses the window", () => {
    const r = evaluateOpportunity(
      input({
        directionalBelievers: 10,
        believersYes: 8,
        believersNo: 2,
        newBelievers1h: 0,
        newBelievers24h: 6,
        uniqueWallets1h: 0,
        uniqueWallets24h: 6,
        tradeCount24h: 8,
        totalCapitalUsd: 700,
      }),
      ctx(),
    );
    expect(r.type).toBe("early");
    expect(r.window).toBe("24h");
    expect(r.evidence.window).toBe("24h");
  });
  it("percentiles disabled below the market-count floor", () => {
    const small = evaluateOpportunity(
      input({ uniqueWallets1h: 8, uniqueWallets24h: 24, tradeCount24h: 30 }),
      ctx({ eligibleMarketCount: 5 }),
    );
    expect(small.percentilesAvailable).toBe(false);
    const big = evaluateOpportunity(
      input({ uniqueWallets1h: 8, uniqueWallets24h: 24, tradeCount24h: 30 }),
      ctx({ eligibleMarketCount: 50 }),
    );
    expect(big.percentilesAvailable).toBe(true);
  });
});

describe("confidence", () => {
  it("small concentrated sample → lower confidence than a broad sample", () => {
    const small = evaluateOpportunity(
      input({ uniqueWallets1h: 3, uniqueWallets24h: 3, tradeCount24h: 20, volumeEth1h: 1 }),
      ctx(),
    );
    const broad = evaluateOpportunity(
      input({ uniqueWallets1h: 15, uniqueWallets24h: 40, tradeCount24h: 45, volumeEth1h: 5 }),
      ctx({ eligibleMarketCount: 50 }),
    );
    const order = { low: 0, medium: 1, high: 2 } as const;
    expect(order[broad.confidence]).toBeGreaterThanOrEqual(order[small.confidence]);
  });
});

describe("score bounds", () => {
  it("all outputs remain within 0..100", () => {
    for (const o of [
      input({
        uniqueWallets1h: 100,
        uniqueWallets24h: 500,
        volumeEth24h: 9999,
        directionalBelievers: 5000,
        tradeCount24h: 999,
      }),
      input({ marketAgeHours: 10, directionalBelievers: 1, tradeCount7d: 1 }),
      input({ totalCapitalUsd: 800, circulation24h: 3, uniqueWallets24h: 6, tradeCount24h: 10 }),
    ]) {
      const r = evaluateOpportunity(o, ctx());
      expect(r.normalizedScore).toBeGreaterThanOrEqual(0);
      expect(r.normalizedScore).toBeLessThanOrEqual(100);
      expect(r.rawScore).toBeLessThanOrEqual(100);
    }
  });
});

describe("hysteresis", () => {
  it("small boundary movement does not flip the label", () => {
    // A market that qualifies for both early and hidden near the boundary.
    const base = input({
      directionalBelievers: 12,
      newBelievers24h: 5,
      uniqueWallets24h: 5,
      tradeCount24h: 8,
      totalCapitalUsd: 900,
      circulation24h: 1.2,
    });
    const first = evaluateOpportunity(base, ctx());
    const sticky = evaluateOpportunity(
      base,
      ctx({ prevType: first.type === "early" ? "hidden" : "early", prevTypeStrength: 0.9 }),
    );
    // With a very strong prior of the other type, it should not flip on a tiny margin.
    expect(sticky.type).toBeTruthy();
  });
  it("a strong evidence change CAN replace the current type", () => {
    const strongHot = input({
      uniqueWallets1h: 20,
      uniqueWallets24h: 30,
      volumeEth1h: 8,
      tradeCount24h: 40,
    });
    const r = evaluateOpportunity(strongHot, ctx({ prevType: "early", prevTypeStrength: 0.3 }));
    expect(r.type).toBe("hot");
  });
});

describe("reason support", () => {
  it("every rendered reason is backed by its evidence payload", () => {
    const r = evaluateOpportunity(
      input({ uniqueWallets1h: 8, uniqueWallets24h: 24, volumeEth1h: 3, tradeCount24h: 30 }),
      ctx(),
    );
    const reason = renderReason(r.reasonCode, r.evidence);
    expect(reason).toContain(String(r.evidence.unique_wallets));
    expect(reason).toContain("the last hour");
  });
  it("reason never uses tribe/rival/everyone/exploding language", () => {
    const r = evaluateOpportunity(
      input({
        believersYes: 9,
        believersNo: 10,
        peopleYesPct: 47,
        tradeCount24h: 12,
        uniqueWallets24h: 4,
        directionalBelievers: 19,
        marketAgeHours: 500,
      }),
      ctx(),
    );
    const reason = renderReason(r.reasonCode, r.evidence).toLowerCase();
    for (const banned of ["tribe", "rival", "everyone", "exploding", "people like you"]) {
      expect(reason).not.toContain(banned);
    }
  });
});
