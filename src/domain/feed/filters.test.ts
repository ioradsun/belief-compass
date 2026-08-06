import { describe, it, expect } from "vitest";
import {
  ALL,
  filterTitle,
  isAll,
  matches,
  normalize,
  orderingMode,
  toggleNetwork,
  toggleTopic,
  type FilterCandidate,
} from "./filters";

const m = (o: Partial<FilterCandidate> = {}): FilterCandidate => ({
  category: "ai",
  tribeCount: 0,
  oppCount: 0,
  followedHere: 0,
  ...o,
});

describe("All is the empty selection", () => {
  it("titles itself All", () => {
    expect(filterTitle(ALL)).toBe("All");
    expect(isAll(ALL)).toBe(true);
  });

  it("treats Everyone alone as All — it says nothing extra", () => {
    const f = toggleNetwork(ALL, "everyone");
    expect(isAll(f)).toBe(true);
    expect(filterTitle(f)).toBe("All");
  });

  it("admits every market", () => {
    expect(matches(ALL, m({ category: null }))).toBe(true);
  });
});

describe("within a group, selections are OR", () => {
  it("returns both topics", () => {
    const f = toggleTopic(toggleTopic(ALL, "ai"), "crypto");
    expect(matches(f, m({ category: "ai" }))).toBe(true);
    expect(matches(f, m({ category: "crypto" }))).toBe(true);
    expect(matches(f, m({ category: "sports" }))).toBe(false);
  });

  it("accepts a market matching either network", () => {
    const f = toggleNetwork(toggleNetwork(ALL, "tribe"), "following");
    expect(matches(f, m({ tribeCount: 1 }))).toBe(true);
    expect(matches(f, m({ followedHere: 2 }))).toBe(true);
    expect(matches(f, m({ oppCount: 3 }))).toBe(false);
  });
});

describe("across groups, selections are AND", () => {
  it("My Tribe + AI means AI markets the tribe is in", () => {
    const f = toggleTopic(toggleNetwork(ALL, "tribe"), "ai");
    expect(matches(f, m({ category: "ai", tribeCount: 1 }))).toBe(true);
    expect(matches(f, m({ category: "ai" }))).toBe(false);
    expect(matches(f, m({ category: "crypto", tribeCount: 1 }))).toBe(false);
  });
});

describe("uncategorised markets are Other, not invisible", () => {
  it("matches Other when the category is unknown or missing", () => {
    const f = toggleTopic(ALL, "other");
    expect(matches(f, m({ category: null }))).toBe(true);
    expect(matches(f, m({ category: "weather" }))).toBe(true);
    expect(matches(f, m({ category: "AI" }))).toBe(false);
  });
});

describe("the title stays short", () => {
  it("names one or two selections", () => {
    expect(filterTitle(toggleTopic(ALL, "ai"))).toBe("AI");
    expect(filterTitle(toggleTopic(toggleNetwork(ALL, "tribe"), "ai"))).toBe("AI + My Tribe");
  });

  it("counts instead of listing beyond two", () => {
    let f = toggleTopic(ALL, "ai");
    f = toggleTopic(f, "crypto");
    f = toggleNetwork(f, "following");
    expect(filterTitle(f)).toBe("3 Filters");
  });
});

describe("a single network is also an ordering", () => {
  it("uses the tribe ranking when only the tribe is asked for", () => {
    expect(orderingMode(toggleNetwork(ALL, "tribe"))).toBe("tribe");
    expect(orderingMode(toggleNetwork(ALL, "rivals"))).toBe("rivals");
  });

  it("keeps the blend for anything combined", () => {
    expect(orderingMode(toggleNetwork(toggleNetwork(ALL, "tribe"), "rivals"))).toBe("for_you");
    expect(orderingMode(toggleTopic(ALL, "ai"))).toBe("for_you");
  });
});

describe("normalisation", () => {
  it("is order-independent and drops unknown keys", () => {
    expect(normalize({ networks: ["tribe"], topics: ["crypto", "ai"] })).toEqual(
      normalize({ networks: ["tribe"], topics: ["ai", "crypto"] }),
    );
    expect(normalize({ networks: [], topics: ["nope"] }).topics).toEqual([]);
  });

  it("toggling twice returns to All", () => {
    expect(isAll(toggleTopic(toggleTopic(ALL, "ai"), "ai"))).toBe(true);
  });
});
