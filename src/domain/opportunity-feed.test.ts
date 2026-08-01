import { describe, it, expect } from "vitest";
import {
  FEED,
  baseRankFor,
  relevanceFor,
  sequenceFeed,
  applyCategoryDiversity,
  primaryReasonFor,
  EMPTY_VIEWER_CONTEXT,
  type FeedMarketCandidate,
  type ViewerFeedContext,
} from "./opportunity-feed";

const mkt = (id: number, over: Partial<FeedMarketCandidate> = {}): FeedMarketCandidate => ({
  onchainId: id,
  category: "crypto",
  opportunityEligible: true,
  opportunityScore: 50,
  opportunityType: "hot",
  opportunityReason: "Volume is climbing.",
  windowVolumeUsd: 1000,
  ...over,
});

const viewer = (over: Partial<ViewerFeedContext> = {}): ViewerFeedContext => ({
  ...EMPTY_VIEWER_CONTEXT,
  ...over,
});

describe("baseRankFor", () => {
  it("uses the global opportunity score when eligible", () => {
    expect(baseRankFor(mkt(1, { opportunityScore: 42 }))).toBe(42);
  });

  it("ranks ineligible markets below every eligible one", () => {
    const ineligible = baseRankFor(mkt(1, { opportunityEligible: false }));
    expect(ineligible).toBeLessThan(0);
    expect(ineligible).toBeLessThan(baseRankFor(mkt(2, { opportunityScore: 0 })));
  });

  it("orders ineligible markets by window volume", () => {
    const big = baseRankFor(mkt(1, { opportunityEligible: false, windowVolumeUsd: 10_000 }));
    const small = baseRankFor(mkt(2, { opportunityEligible: false, windowVolumeUsd: 10 }));
    expect(big).toBeGreaterThan(small);
  });
});

describe("relevanceFor", () => {
  it("is neutral with no viewer context", () => {
    const r = relevanceFor(mkt(1), EMPTY_VIEWER_CONTEXT);
    expect(r.multiplier).toBe(1);
    expect(r.reasons).toEqual([]);
  });

  it("boosts a category the viewer acts in, with a reason", () => {
    const r = relevanceFor(mkt(1), viewer({ categoryAffinity: { crypto: 1 } }));
    expect(r.multiplier).toBeCloseTo(1 + FEED.BOOST.CATEGORY_AFFINITY);
    expect(r.reasons[0]?.code).toBe("category_affinity");
  });

  it("boosts held positions and tribe/opp activity", () => {
    const r = relevanceFor(
      mkt(1),
      viewer({ heldMarkets: [1], tribeMarkets: [1], oppMarkets: [1] }),
    );
    expect(r.reasons.map((x) => x.code)).toEqual(["held_position", "tribe_active", "opp_active"]);
    expect(r.multiplier).toBeGreaterThan(1);
  });

  it("demotes markets the viewer already answered", () => {
    const r = relevanceFor(mkt(1), viewer({ decidedMarkets: [1] }));
    expect(r.multiplier).toBeLessThan(1);
    expect(r.reasons.some((x) => x.code === "already_decided")).toBe(true);
  });

  it("never escapes the bounded personalization band", () => {
    const r = relevanceFor(
      mkt(1),
      viewer({
        categoryAffinity: { crypto: 5 },
        heldMarkets: [1],
        tribeMarkets: [1],
        oppMarkets: [1],
      }),
    );
    expect(r.multiplier).toBeLessThanOrEqual(FEED.MAX_MULTIPLIER);
    expect(r.multiplier).toBeGreaterThanOrEqual(FEED.MIN_MULTIPLIER);
  });

  it("cannot lift a dead (ineligible) market above a live one", () => {
    const { items } = sequenceFeed({
      markets: [
        mkt(1, { opportunityEligible: false, opportunityScore: null }),
        mkt(2, { opportunityScore: 1, category: "sports" }),
      ],
      viewer: viewer({ categoryAffinity: { crypto: 1 }, heldMarkets: [1], tribeMarkets: [1] }),
    });
    expect(items[0]).toMatchObject({ kind: "market", onchainId: 2 });
  });
});

describe("sequenceFeed", () => {
  it("orders by global score for an anonymous viewer", () => {
    const { items } = sequenceFeed({
      markets: [mkt(1, { opportunityScore: 10 }), mkt(2, { opportunityScore: 90 })],
    });
    expect(items.map((i) => (i.kind === "market" ? i.onchainId : "idea"))).toEqual([2, 1]);
  });

  it("is deterministic for identical input", () => {
    const input = { markets: [mkt(1), mkt(2), mkt(3)] };
    expect(sequenceFeed(input)).toEqual(sequenceFeed(input));
  });

  it("assigns contiguous positions", () => {
    const { items } = sequenceFeed({ markets: [mkt(1), mkt(2), mkt(3)] });
    expect(items.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("respects the limit", () => {
    const { items } = sequenceFeed({
      markets: [mkt(1), mkt(2), mkt(3), mkt(4)],
      limit: 2,
    });
    expect(items).toHaveLength(2);
  });

  it("steps back markets already seen this session", () => {
    const { items } = sequenceFeed({
      markets: [mkt(1, { opportunityScore: 50 }), mkt(2, { opportunityScore: 49 })],
      seenIds: [1],
    });
    expect(items[0]).toMatchObject({ onchainId: 2 });
  });

  it("carries the personal reason as the headline when there is one", () => {
    const { items } = sequenceFeed({
      markets: [mkt(1)],
      viewer: viewer({ heldMarkets: [1] }),
    });
    expect(items[0]).toMatchObject({ primaryReason: "You hold a position here." });
  });

  it("falls back to the global reason with no personal facts", () => {
    const { items } = sequenceFeed({ markets: [mkt(1)] });
    expect(items[0]).toMatchObject({ primaryReason: "Volume is climbing." });
  });

  it("returns an empty sequence for no candidates", () => {
    expect(sequenceFeed({ markets: [] }).items).toEqual([]);
  });
});

describe("idea placement", () => {
  const markets = [1, 2, 3, 4, 5, 6].map((i) => mkt(i, { opportunityScore: 100 - i }));
  const idea = { id: "s1", question: "Will X?", category: "crypto", shortReason: "You act here." };

  it("inserts the idea as a first-class item in the same sequence", () => {
    const { items } = sequenceFeed({ markets, idea });
    const ideas = items.filter((i) => i.kind === "market_idea");
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({ kind: "market_idea", suggestionId: "s1" });
  });

  it("never places the idea in the first slots", () => {
    const { items } = sequenceFeed({ markets, idea, ideaSlot: 0 });
    const at = items.findIndex((i) => i.kind === "market_idea");
    expect(at).toBeGreaterThanOrEqual(FEED.IDEA_MIN_POSITION);
  });

  it("re-numbers positions after insertion", () => {
    const { items } = sequenceFeed({ markets, idea });
    expect(items.map((i) => i.position)).toEqual(items.map((_, i) => i));
  });

  it("runs a pure market feed when no idea is ready", () => {
    const { items } = sequenceFeed({ markets, idea: null });
    expect(items.every((i) => i.kind === "market")).toBe(true);
  });
});

describe("applyCategoryDiversity", () => {
  it("breaks runs longer than the cap", () => {
    const rows = [
      { candidate: mkt(1, { category: "a" }) },
      { candidate: mkt(2, { category: "a" }) },
      { candidate: mkt(3, { category: "a" }) },
      { candidate: mkt(4, { category: "b" }) },
    ];
    const out = applyCategoryDiversity(rows).map((r) => r.candidate.category);
    expect(out.slice(0, 3)).toEqual(["a", "a", "b"]);
  });

  it("keeps every item exactly once", () => {
    const rows = [1, 2, 3, 4, 5].map((i) => ({ candidate: mkt(i, { category: "a" }) }));
    const out = applyCategoryDiversity(rows);
    expect(out.map((r) => r.candidate.onchainId).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("primaryReasonFor", () => {
  it("never headlines a demotion", () => {
    const rel = relevanceFor(mkt(1), viewer({ decidedMarkets: [1] }));
    expect(primaryReasonFor(mkt(1), rel)).toBe("Volume is climbing.");
  });

  it("returns null when there is nothing honest to say", () => {
    const rel = relevanceFor(mkt(1), EMPTY_VIEWER_CONTEXT);
    expect(primaryReasonFor(mkt(1, { opportunityReason: null }), rel)).toBeNull();
  });
});
