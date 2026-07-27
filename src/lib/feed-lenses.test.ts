import { describe, it, expect } from "vitest";
import {
  scoreFeed,
  marketsInCategory,
  categoriesOf,
  LENSES,
  type MarketSignals,
} from "./feed-lenses";

function mk(over: Partial<MarketSignals> & { onchainId: number }): MarketSignals {
  return {
    category: "AI",
    volumeTotalUsd: 0,
    volumeWindowUsd: 0,
    poolUsd: 0,
    believers: 0,
    newBelievers: 0,
    velocity: 0,
    convictionAvg: null,
    avgDaysHeld: null,
    ageDays: null,
    flipRate: null,
    tribeMatchPct: null,
    oppMatchPct: null,
    tribeSide: null,
    oppSide: null,
    comments: null,
    shares: null,
    ...over,
  };
}

describe("the same markets rank differently per lens (opinion, not sort)", () => {
  const hotMarket = mk({
    onchainId: 1,
    volumeTotalUsd: 9850,
    volumeWindowUsd: 4000,
    poolUsd: 2580,
    believers: 40,
    newBelievers: 30,
    velocity: 20,
    convictionAvg: 0.2,
    avgDaysHeld: 2,
  });
  const convictionMarket = mk({
    onchainId: 2,
    volumeTotalUsd: 3000,
    volumeWindowUsd: 100,
    poolUsd: 20000,
    believers: 200,
    newBelievers: 1,
    velocity: 1,
    convictionAvg: 0.9,
    avgDaysHeld: 63,
  });
  const batch = [hotMarket, convictionMarket];

  it("Hot ranks the churning market first", () => {
    expect(scoreFeed("hot", batch)[0].onchainId).toBe(1);
  });
  it("Conviction ranks the long-held market first", () => {
    expect(scoreFeed("conviction", batch)[0].onchainId).toBe(2);
  });
  it("a market's score changes with the lens", () => {
    const hotScore = scoreFeed("hot", batch).find((s) => s.onchainId === 1)!.score;
    const convScore = scoreFeed("conviction", batch).find((s) => s.onchainId === 1)!.score;
    expect(hotScore).not.toBe(convScore);
  });
});

describe("Early penalises mature, well-capitalised markets", () => {
  const fresh = mk({
    onchainId: 1,
    velocity: 30,
    newBelievers: 20,
    poolUsd: 500,
    ageDays: 1,
    believers: 10,
  });
  const mature = mk({
    onchainId: 2,
    velocity: 2,
    newBelievers: 0,
    poolUsd: 90000,
    ageDays: 200,
    believers: 800,
  });
  it("the young, small, fast market wins Early", () => {
    expect(scoreFeed("early", [fresh, mature])[0].onchainId).toBe(1);
  });
});

describe("Hidden Gems reward small crowd + high conviction", () => {
  const gem = mk({
    onchainId: 1,
    believers: 20,
    convictionAvg: 0.9,
    flipRate: 0.05,
    volumeTotalUsd: 4000,
    poolUsd: 1500,
  });
  const crowded = mk({
    onchainId: 2,
    believers: 900,
    convictionAvg: 0.4,
    flipRate: 0.5,
    volumeTotalUsd: 4000,
    poolUsd: 1500,
  });
  it("the quiet high-conviction market wins Hidden", () => {
    expect(scoreFeed("hidden", [gem, crowded])[0].onchainId).toBe(1);
  });
});

describe("viewer lenses are gated", () => {
  const batch = [mk({ onchainId: 1, tribeMatchPct: 94, tribeSide: "YES" })];
  it("Tribe/Rivals return nothing without a viewer", () => {
    expect(scoreFeed("tribe", batch, { hasViewer: false })).toEqual([]);
    expect(scoreFeed("rivals", batch, { hasViewer: false })).toEqual([]);
  });
  it("Tribe ranks by DNA match when a viewer is present", () => {
    const two = [
      mk({ onchainId: 1, tribeMatchPct: 94, tribeSide: "YES", volumeWindowUsd: 10 }),
      mk({ onchainId: 2, tribeMatchPct: 60, tribeSide: "NO", volumeWindowUsd: 10 }),
    ];
    expect(scoreFeed("tribe", two, { hasViewer: true })[0].onchainId).toBe(1);
  });
});

describe("reasons only claim what the data proves", () => {
  it("Hot uses the circulation story when turnover is high", () => {
    const r = scoreFeed("hot", [mk({ onchainId: 1, volumeTotalUsd: 9850, poolUsd: 2580 })])[0]
      .reason;
    expect(r).toContain("changed hands");
  });
  it("Conviction only cites a hold time when it's known", () => {
    const withDays = scoreFeed("conviction", [
      mk({ onchainId: 1, avgDaysHeld: 63, poolUsd: 100 }),
    ])[0].reason;
    expect(withDays).toContain("63 days");
    const noDays = scoreFeed("conviction", [mk({ onchainId: 1, poolUsd: 100 })])[0].reason;
    expect(noDays).not.toMatch(/\d+ days/);
  });
});

describe("categories filter candidates, they don't rank", () => {
  const batch = [mk({ onchainId: 1, category: "AI" }), mk({ onchainId: 2, category: "Politics" })];
  it("narrows to a category, case-insensitive", () => {
    expect(marketsInCategory(batch, "ai").map((m) => m.onchainId)).toEqual([1]);
    expect(marketsInCategory(batch, "Everything")).toHaveLength(2);
    expect(marketsInCategory(batch, null)).toHaveLength(2);
  });
  it("lists the distinct categories present", () => {
    expect(categoriesOf(batch)).toEqual(["AI", "Politics"]);
  });
});

describe("every lens has intent metadata", () => {
  it("exposes a question and label per lens", () => {
    for (const l of LENSES) {
      expect(l.question.length).toBeGreaterThan(0);
      expect(l.label.length).toBeGreaterThan(0);
    }
    expect(LENSES.map((l) => l.key)).toEqual([
      "hot",
      "conviction",
      "tribe",
      "rivals",
      "early",
      "hidden",
    ]);
  });
});
