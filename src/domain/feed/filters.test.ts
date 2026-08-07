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
  filterKey,
  MOMENTUM_OPTIONS,
  type FeedFilters,
  type FilterCandidate,
} from "./filters";
import { MOMENTUM_LENSES } from "./momentum";
import { NETWORK_OPTIONS } from "./filters";
import { bandLabel } from "@/domain/relationship-spectrum";

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
    expect(filterTitle(toggleTopic(toggleNetwork(ALL, "tribe"), "ai"))).toBe("AI + Tribe");
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

describe("momentum is the third dimension", () => {
  const market = (o: Partial<FilterCandidate> = {}): FilterCandidate => ({
    category: "crypto",
    tribeCount: 0,
    oppCount: 0,
    followedHere: 0,
    ...o,
  });

  it("ORs within the group", () => {
    const f = normalize({ networks: [], topics: [], momentum: ["gaining", "waking"] });
    expect(matches(f, market({ momentum: ["waking"] }))).toBe(true);
    expect(matches(f, market({ momentum: ["gaining", "moving"] }))).toBe(true);
    expect(matches(f, market({ momentum: ["dropping"] }))).toBe(false);
    expect(matches(f, market({ momentum: [] }))).toBe(false);
  });

  it("ANDs across the groups", () => {
    const f = normalize({ networks: ["tribe"], topics: ["ai"], momentum: ["moving"] });
    const hit = market({ category: "ai", tribeCount: 1, momentum: ["moving"] });
    expect(matches(f, hit)).toBe(true);
    // Each group, failed one at a time.
    expect(matches(f, { ...hit, category: "sports" })).toBe(false);
    expect(matches(f, { ...hit, tribeCount: 0 })).toBe(false);
    expect(matches(f, { ...hit, momentum: ["waking"] })).toBe(false);
  });

  it("says nothing when nothing is chosen", () => {
    const f = normalize({ networks: [], topics: [], momentum: [] });
    expect(matches(f, market({ momentum: [] }))).toBe(true);
    expect(isAll(f)).toBe(true);
  });

  /**
   * A saved link or a client that predates this dimension sends two groups. It
   * must parse into a valid selection rather than throwing or silently matching
   * nothing.
   */
  it("tolerates a selection made before momentum existed", () => {
    const old = { networks: ["tribe"], topics: ["ai"] } as FeedFilters;
    expect(normalize(old).momentum).toEqual([]);
    expect(isAll({ networks: [], topics: [] } as FeedFilters)).toBe(true);
    expect(matches(old, market({ category: "ai", tribeCount: 1 }))).toBe(true);
  });

  it("keeps the cache key distinct per momentum selection", () => {
    const a = normalize({ networks: [], topics: [], momentum: ["gaining"] });
    const b = normalize({ networks: [], topics: [], momentum: ["dropping"] });
    expect(filterKey(a)).not.toBe(filterKey(b));
    expect(filterKey(a)).toBe(filterKey({ ...a }));
  });

  it("offers no lens the classifier cannot produce", () => {
    for (const o of MOMENTUM_OPTIONS) expect(MOMENTUM_LENSES).toContain(o.key);
    expect(MOMENTUM_OPTIONS).toHaveLength(MOMENTUM_LENSES.length);
  });

  it("names every chosen lens in the title", () => {
    const f = normalize({ networks: [], topics: [], momentum: ["waking"] });
    expect(filterTitle(f)).toContain("Waking up");
  });
});

describe("a stricter floor narrows what is said, never what is shown", () => {
  /**
   * THE GRACEFUL-FALLBACK GUARANTEE, and it is structural rather than a rescue
   * path. Sensitivity changes what momentum SAYS about a market — its lenses,
   * its headline, its weight — and the filter only consults momentum when the
   * reader has asked for a momentum lens. So raising the floor cannot empty a
   * feed on its own; it reorders one. There is no "fall back to other stories"
   * branch because there is no cliff to fall off.
   */
  it("keeps a market that no longer moves, as long as no momentum lens is chosen", () => {
    const f = normalize({ networks: [], topics: [], momentum: [] });
    const stillMoving = { category: "ai", tribeCount: 0, oppCount: 0, followedHere: 0 };
    expect(matches(f, { ...stillMoving, momentum: ["moving", "gaining"] })).toBe(true);
    // Same market, now below the reader's floor: momentum has nothing to say.
    expect(matches(f, { ...stillMoving, momentum: [] })).toBe(true);
  });

  it("only lets the floor remove a market when the reader asked about movement", () => {
    const f = normalize({ networks: [], topics: [], momentum: ["gaining"] });
    const m = { category: "ai", tribeCount: 0, oppCount: 0, followedHere: 0 };
    expect(matches(f, { ...m, momentum: ["gaining"] })).toBe(true);
    expect(matches(f, { ...m, momentum: [] })).toBe(false);
  });
});

describe("My Markets is the one Focus option that was missing", () => {
  const m = (o: Partial<FilterCandidate> = {}): FilterCandidate => ({
    category: "ai",
    tribeCount: 0,
    oppCount: 0,
    followedHere: 0,
    ...o,
  });

  it("matches a market the viewer created or holds", () => {
    const f = normalize({ networks: ["mine"], topics: [], momentum: [] });
    expect(matches(f, m({ mine: true }))).toBe(true);
    expect(matches(f, m({ mine: false }))).toBe(false);
    expect(matches(f, m())).toBe(false);
  });

  it("ORs with the other network groups rather than narrowing them", () => {
    const f = normalize({ networks: ["mine", "tribe"], topics: [], momentum: [] });
    expect(matches(f, m({ mine: true }))).toBe(true);
    expect(matches(f, m({ tribeCount: 1 }))).toBe(true);
    expect(matches(f, m())).toBe(false);
  });
});

/**
 * ONE VOCABULARY FOR ONE RELATIONSHIP.
 *
 * Explore's People narrowing and the People tab describe the same population
 * through the same DNA engine, and for a while they used different words for it
 * — "My Tribe" in one place, "Tribe" in the other, one tab apart.
 *
 * Twin and Opponent are deliberately NOT offered here. They are not peer levels:
 * `bandFor` returns "twin" only when the relationship also carries the earned
 * badge and "tribe" for everyone else on the same side, so twin ⊆ tribe and
 * opponent ⊆ rival by construction — narrowing to Tribe already includes them.
 */
describe("Explore narrows by the same relationship words the People tab shows", () => {
  it("uses the spectrum's own labels", () => {
    const label = (k: string) => NETWORK_OPTIONS.find((n) => n.key === k)?.label;
    expect(label("tribe")).toBe(bandLabel("tribe"));
    // Plural for a group of markets, singular for one person — the same word.
    expect(label("rivals")).toBe(`${bandLabel("rival")}s`);
  });

  it("offers no relationship level the feed cannot actually evaluate", () => {
    // The DNA overlay collapses closest ∪ tribe and inverse ∪ opp, so
    // `tribe_count` / `opp_count` are the only per-market figures that exist.
    // A Twin or Opponent option would be a filter with nothing behind it.
    const keys = NETWORK_OPTIONS.map((n) => n.key);
    expect(keys).not.toContain("twin");
    expect(keys).not.toContain("opponent");
    // And never `neutral` — the band for people the evidence cannot place.
    expect(keys).not.toContain("neutral");
  });

  it("still narrows by every level it does offer", () => {
    const has = (k: string) => NETWORK_OPTIONS.some((n) => n.key === k);
    for (const k of ["everyone", "mine", "tribe", "rivals", "following"]) {
      expect(has(k), k).toBe(true);
    }
  });
});
