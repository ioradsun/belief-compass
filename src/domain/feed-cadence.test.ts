import { describe, it, expect } from "vitest";
import {
  mixFeed,
  familyMix,
  familyOf,
  CADENCE,
  FAMILY_TARGET,
  familyTargets,
  type MixCandidate,
  type EventFamily,
} from "./feed-cadence";

let seq = 0;
const c = (o: Partial<MixCandidate> = {}): MixCandidate => {
  seq += 1;
  return {
    id: `e${seq}`,
    family: "live_action",
    significance: 0.5,
    // Descending time, so the natural chronological order is the input order.
    occurredAt: new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - seq * 60_000).toISOString(),
    marketId: "1",
    side: null,
    ...o,
  };
};

const families = (rows: MixCandidate[]) => rows.map((r) => r.family);

describe("variety: repeated families are separated when alternatives exist", () => {
  it("does not stack four live actions when other families are available", () => {
    const rows = mixFeed([
      c({ family: "live_action" }),
      c({ family: "live_action" }),
      c({ family: "live_action" }),
      c({ family: "live_action" }),
      c({ family: "collective_story" }),
      c({ family: "market_transition" }),
      c({ family: "conviction_celebration" }),
    ]);
    // The first four rows must not all be the same family.
    expect(new Set(families(rows).slice(0, 4)).size).toBeGreaterThan(1);
  });

  it("separates two cohorts telling the same kind of story", () => {
    const rows = mixFeed([
      c({ family: "collective_story", motif: "cohort:YES:holding:30", marketId: "1" }),
      c({ family: "collective_story", motif: "cohort:YES:holding:30", marketId: "2" }),
      c({ family: "live_action", marketId: "3" }),
    ]);
    const idx = rows.map((r) => r.motif ?? "");
    const a = idx.indexOf("cohort:YES:holding:30");
    const b = idx.lastIndexOf("cohort:YES:holding:30");
    expect(b - a).toBeGreaterThan(1);
  });

  it("still returns everything when there is no alternative", () => {
    const only = [c({ family: "conviction_celebration" }), c({ family: "conviction_celebration" })];
    const rows = mixFeed(only);
    expect(rows).toHaveLength(2);
    expect(families(rows)).toEqual(["conviction_celebration", "conviction_celebration"]);
  });
});

describe("significance outranks pacing", () => {
  it("a breaking event leads, whatever the sequencing would prefer", () => {
    const breaking = c({ family: "market_transition", significance: 0.95, id: "BREAKING" });
    const rows = mixFeed([
      c({ family: "live_action", significance: 0.6 }),
      c({ family: "live_action", significance: 0.6 }),
      breaking,
    ]);
    expect(rows[0].id).toBe("BREAKING");
  });

  it("two breaking events are not held apart from each other", () => {
    const rows = mixFeed([
      c({ family: "market_transition", significance: 0.9, id: "B1", marketId: "1" }),
      c({ family: "market_transition", significance: 0.9, id: "B2", marketId: "1" }),
      c({ family: "live_action", significance: 0.4 }),
    ]);
    expect(
      rows
        .slice(0, 2)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["B1", "B2"]);
  });

  it("never promotes a weak event just to fill a family target", () => {
    const weak = c({ family: "relationship_story", significance: 0.05, id: "WEAK" });
    const rows = mixFeed([
      c({ family: "live_action", significance: 0.7 }),
      c({ family: "live_action", significance: 0.65 }),
      weak,
    ]);
    // Below minQuality it earns no nudge, so it cannot jump strong events.
    expect(rows[0].id).not.toBe("WEAK");
    expect(weak.significance).toBeLessThan(CADENCE.minQuality);
  });
});

describe("discovery is the other half of quality", () => {
  it("a small event that introduces someone leads a bigger one that introduces nobody", () => {
    // Same instant, so the comparison is purely about quality — recency is a
    // real third term and is deliberately not being tested here.
    const at = new Date(Date.UTC(2026, 0, 1, 12)).toISOString();
    const rows = mixFeed([
      c({ id: "WHALE", significance: 0.75, discovery: 0.05, marketId: "1", occurredAt: at }),
      c({
        id: "TWIN",
        significance: 0.55,
        discovery: 0.9,
        marketId: "2",
        subjects: ["0xtwin"],
        occurredAt: at,
      }),
    ]);
    expect(rows[0].id).toBe("TWIN");
  });

  it("but an anonymous market flip still leads everything", () => {
    const rows = mixFeed([
      c({ id: "TWIN", significance: 0.6, discovery: 1, marketId: "2", subjects: ["0xtwin"] }),
      c({ id: "FLIP", family: "market_transition", significance: 0.95, marketId: "1" }),
    ]);
    expect(rows[0].id).toBe("FLIP");
  });

  it("discovery alone never reaches the breaking band — it competes, it does not interrupt", () => {
    // Two rows that would each be held apart by adjacency; a perfect discovery
    // score must not buy the queue-skipping that only significance grants.
    const rows = mixFeed([
      c({ id: "A", significance: 0.5, discovery: 1, marketId: "1", subjects: ["w"] }),
      c({ id: "B", significance: 0.5, discovery: 1, marketId: "1", subjects: ["w"] }),
      c({ id: "BREAK", significance: CADENCE.breakingAt + 0.05, marketId: "9" }),
    ]);
    expect(rows[0].id).toBe("BREAK");
  });

  it("changes nothing at all for a feed with no discovery data", () => {
    const build = () => {
      seq = 0;
      return [
        c({ significance: 0.6, marketId: "1" }),
        c({ significance: 0.4, marketId: "2", family: "collective_story" }),
        c({ significance: 0.7, marketId: "3", family: "market_transition" }),
      ];
    };
    const plain = mixFeed(build()).map((r) => r.id);
    const zeroed = mixFeed(build().map((r) => ({ ...r, discovery: 0 }))).map((r) => r.id);
    expect(zeroed).toEqual(plain);
  });

  it("cannot overshoot, whatever the two dimensions are", () => {
    const rows = mixFeed([
      c({ significance: 1, discovery: 1 }),
      c({ significance: 0.99, discovery: 5 }),
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe("every session should introduce someone new", () => {
  it("prefers an unmet person over one already in the window, all else equal", () => {
    const rows = mixFeed([
      c({ id: "KNOWN1", significance: 0.6, subjects: ["0xa"], marketId: "1" }),
      c({ id: "KNOWN2", significance: 0.6, subjects: ["0xa"], marketId: "2" }),
      c({ id: "NEW", significance: 0.6, subjects: ["0xb"], marketId: "3" }),
    ]);
    // Whoever leads, the second row must not be the same person again.
    expect(rows[1].subjects).not.toEqual(rows[0].subjects);
  });

  it("never promotes a weak row just because its person is new", () => {
    const rows = mixFeed([
      c({ id: "STRONG", significance: 0.8, subjects: ["0xa"], marketId: "1" }),
      c({ id: "DUST", significance: 0.05, subjects: ["0xnew"], marketId: "2" }),
    ]);
    expect(rows[0].id).toBe("STRONG");
  });

  it("the bonus is bounded well below the significance range", () => {
    expect(CADENCE.newPersonBonus).toBeLessThan(CADENCE.penalty.subject);
  });
});

describe("nobody dominates", () => {
  it("one wallet cannot take over the visible window", () => {
    const hog = Array.from({ length: 6 }, () => c({ subjects: ["0xhog"], significance: 0.55 }));
    const others = Array.from({ length: 6 }, (_, i) =>
      c({ subjects: [`0x${i}`], significance: 0.5, marketId: String(i + 10) }),
    );
    const top = mixFeed([...hog, ...others]).slice(0, 6);
    const hogRows = top.filter((r) => (r.subjects ?? []).includes("0xhog")).length;
    expect(hogRows).toBeLessThanOrEqual(CADENCE.maxPerWallet + 1);
  });

  it("one market cannot take over when comparable alternatives exist", () => {
    const busy = Array.from({ length: 8 }, () => c({ marketId: "busy", significance: 0.55 }));
    const rest = Array.from({ length: 8 }, (_, i) => c({ marketId: `m${i}`, significance: 0.5 }));
    const top = mixFeed([...busy, ...rest]).slice(0, 8);
    expect(top.filter((r) => r.marketId === "busy").length).toBeLessThanOrEqual(
      CADENCE.maxPerMarket + 1,
    );
  });
});

describe("adaptive to what actually exists", () => {
  it("a quiet feed surfaces the conviction stories it does have", () => {
    const rows = mixFeed([
      c({ family: "collective_story", significance: 0.5 }),
      c({ family: "conviction_celebration", significance: 0.45 }),
      c({ family: "live_action", significance: 0.4 }),
    ]);
    const mix = familyMix(rows);
    expect(mix.collective_story + mix.conviction_celebration).toBeGreaterThan(0.5);
  });

  it("a busy feed stays mostly live action", () => {
    const rows = mixFeed([
      ...Array.from({ length: 12 }, (_, i) =>
        c({ family: "live_action", significance: 0.6, marketId: `m${i}`, subjects: [`w${i}`] }),
      ),
      c({ family: "collective_story", significance: 0.5 }),
      c({ family: "conviction_celebration", significance: 0.45 }),
    ]);
    expect(familyMix(rows.slice(0, 10)).live_action).toBeGreaterThan(0.5);
  });

  it("does not starve other families for one that has nothing to offer", () => {
    // No relationship stories exist; its target must not distort the rest.
    const rows = mixFeed([
      c({ family: "live_action", significance: 0.5 }),
      c({ family: "collective_story", significance: 0.5 }),
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe("determinism and pagination", () => {
  const build = (): MixCandidate[] => {
    seq = 0;
    return [
      c({ family: "live_action", significance: 0.6, marketId: "1", subjects: ["a"] }),
      c({ family: "collective_story", significance: 0.55, marketId: "2", subjects: ["b"] }),
      c({ family: "market_transition", significance: 0.7, marketId: "1" }),
      c({ family: "live_action", significance: 0.6, marketId: "3", subjects: ["a"] }),
      c({ family: "conviction_celebration", significance: 0.5, marketId: "2" }),
      c({ family: "relationship_story", significance: 0.65, marketId: "4", subjects: ["c"] }),
    ];
  };

  it("is the same every time for the same input", () => {
    const one = mixFeed(build()).map((r) => r.id);
    const two = mixFeed(build()).map((r) => r.id);
    expect(one).toEqual(two);
  });

  it("does not depend on the order the candidates arrived in", () => {
    const forward = mixFeed(build()).map((r) => r.id);
    const backward = mixFeed([...build()].reverse()).map((r) => r.id);
    expect(new Set(backward)).toEqual(new Set(forward));
  });

  it("returns every candidate exactly once, so pages can never duplicate or drop", () => {
    const input = build();
    const rows = mixFeed(input);
    expect(rows).toHaveLength(input.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(input.length);
  });

  it("slicing a stable ordering keeps pages disjoint", () => {
    const rows = mixFeed(build());
    const p1 = rows.slice(0, 3).map((r) => r.id);
    const p2 = rows.slice(3, 6).map((r) => r.id);
    expect(p1.filter((id) => p2.includes(id))).toHaveLength(0);
  });

  it("holds nothing back — trimming is the caller's job", () => {
    const input = build();
    expect(mixFeed(input)).toHaveLength(input.length);
  });
});

describe("families come from the vocabulary that already exists", () => {
  it("maps existing kinds without inventing events", () => {
    const cases: Array<[{ kind: string; personal?: boolean }, EventFamily]> = [
      [{ kind: "trade_burst" }, "live_action"],
      [{ kind: "large_trade" }, "live_action"],
      [{ kind: "conviction_cohort" }, "collective_story"],
      [{ kind: "market_transition" }, "market_transition"],
      [{ kind: "believer_milestone" }, "market_transition"],
      [{ kind: "trade_burst", personal: true }, "relationship_story"],
    ];
    for (const [input, expected] of cases) expect(familyOf(input)).toBe(expected);
  });

  /**
   * Personalization is no longer a family. A Tribe member's first-believer row
   * used to become a `relationship_story` — competing for a 7.5% slot, with the
   * fact that it was a FIRST BELIEVER discarded. Who a row is about is carried
   * by the discovery lift, which is the bounded mechanism built for it; WHAT
   * happened decides the family.
   */
  it("does not let a relationship overwrite a stronger story", () => {
    expect(familyOf({ kind: "conviction_cohort", personal: true })).toBe("collective_story");
    expect(familyOf({ kind: "trade", celebration: true, personal: true })).toBe(
      "conviction_celebration",
    );
    expect(familyOf({ kind: "market_transition", personal: true })).toBe("market_transition");
  });

  it("still files a plain personal row as a relationship story", () => {
    expect(familyOf({ kind: "trade", personal: true })).toBe("relationship_story");
    expect(familyOf({ kind: "discovery_moment" })).toBe("relationship_story");
  });

  /**
   * The 18% the mixer reserves for celebrations was unreachable: every one of
   * them arrives as a `trade`, and the family was read from the kind.
   */
  it("lets a celebration reach the family that was reserved for it", () => {
    expect(familyOf({ kind: "trade", celebration: true })).toBe("conviction_celebration");
    expect(familyOf({ kind: "trade" })).toBe("live_action");
    expect(FAMILY_TARGET.conviction_celebration).toBeGreaterThan(0);
  });

  it("treats a market opening and a milestone as moments, whatever the kind", () => {
    expect(familyOf({ kind: "trade", category: "fresh_market" })).toBe("conviction_celebration");
    expect(familyOf({ kind: "trade", category: "milestone" })).toBe("conviction_celebration");
  });
});

/**
 * THE BUDGET FOR THE DAY THAT ACTUALLY HAPPENED.
 *
 * `FAMILY_TARGET` describes a healthy feed. It was applied as a constant, which
 * is right exactly once a day. Measured, nine of a thousand markets traded in
 * the last 24 hours — so holding 47.5% of the budget for live action starved the
 * families that had something to say, on precisely the days it mattered.
 */
describe("the pacing budget follows what actually happened", () => {
  const many = (family: EventFamily, n: number) => Array.from({ length: n }, () => c({ family }));

  it("hands a quiet day's freed budget to the families that can fill it", () => {
    const t = familyTargets([...many("conviction_celebration", 8), ...many("collective_story", 4)]);
    // Nothing traded, so live action asks for nothing.
    expect(t.live_action).toBe(0);
    // Preference alone would want 60/40 (0.18 vs 0.12), but collective can only
    // fill a third of the rows — so it gets exactly its third and celebrations
    // take the rest. Both rules at once, which is why one pass is not enough.
    expect(t.collective_story).toBeCloseTo(4 / 12, 6);
    expect(t.conviction_celebration).toBeCloseTo(8 / 12, 6);
  });

  it("settles rather than oscillating when several families are supply-bound", () => {
    const t = familyTargets([
      ...many("live_action", 1),
      ...many("conviction_celebration", 1),
      ...many("collective_story", 8),
    ]);
    // Each capped family gets exactly what it has; the rest goes to the one that
    // can absorb it. No family ever exceeds its own supply.
    expect(t.live_action).toBeCloseTo(0.1, 6);
    expect(t.conviction_celebration).toBeCloseTo(0.1, 6);
    expect(t.collective_story).toBeCloseTo(0.8, 6);
  });

  it("never asks a family for more than it has", () => {
    // One live action among twenty rows is asked to be one row, not half a feed.
    const t = familyTargets([...many("live_action", 1), ...many("conviction_celebration", 19)]);
    expect(t.live_action).toBeCloseTo(0.05, 6); // exactly the one row it has
    expect(t.conviction_celebration).toBeCloseTo(0.95, 6);
  });

  /** One rule, and the healthy mix is its own special case. */
  it("returns the healthy mix unchanged when supply exceeds every cap", () => {
    const busy = [
      ...many("live_action", 48),
      ...many("conviction_celebration", 18),
      ...many("collective_story", 12),
      ...many("market_transition", 15),
      ...many("relationship_story", 7),
    ];
    const t = familyTargets(busy);
    for (const f of Object.keys(FAMILY_TARGET) as EventFamily[]) {
      expect(t[f]).toBeCloseTo(FAMILY_TARGET[f], 2);
    }
  });

  it("always spends the whole budget, or none of it", () => {
    for (const set of [
      [...many("live_action", 3)],
      [...many("conviction_celebration", 2), ...many("market_transition", 9)],
      [...many("relationship_story", 1)],
    ]) {
      const t = familyTargets(set);
      const total = Object.values(t).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 6);
    }
    expect(Object.values(familyTargets([])).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("lifts a celebration over a live action on a quiet day, all else equal", () => {
    const at = new Date(Date.UTC(2026, 0, 1, 12)).toISOString();
    const rows = mixFeed([
      c({ id: "TRADE", family: "live_action", significance: 0.5, marketId: "1", occurredAt: at }),
      c({
        id: "PARTY",
        family: "conviction_celebration",
        significance: 0.5,
        marketId: "2",
        occurredAt: at,
      }),
      c({
        id: "PARTY2",
        family: "conviction_celebration",
        significance: 0.5,
        marketId: "3",
        occurredAt: at,
      }),
      c({
        id: "PARTY3",
        family: "conviction_celebration",
        significance: 0.5,
        marketId: "4",
        occurredAt: at,
      }),
    ]);
    expect(rows[0].family).toBe("conviction_celebration");
  });

  /** Pacing never outranks news — the bound this all sits under is unchanged. */
  it("still cannot promote a weak row or outrank breaking news", () => {
    const rows = mixFeed([
      c({ id: "WEAK", family: "conviction_celebration", significance: 0.05 }),
      c({ id: "BREAK", family: "live_action", significance: 0.95, marketId: "9" }),
    ]);
    expect(rows[0].id).toBe("BREAK");
    expect(CADENCE.targetNudge).toBeLessThan(CADENCE.breakingAt - CADENCE.minQuality);
  });
});

/**
 * A KIND OF STORY CAN DOMINATE TOO.
 *
 * A real feed showed "Back from the dead" six times in ten rows. Each row was
 * true and each earned its place, but the phrase stopped meaning anything — and
 * the adjacency penalty could not see it, because adjacency looks back three
 * rows and decays, so repeats that sit apart cost almost nothing.
 */
describe("no single kind of story takes over the window", () => {
  const woken = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      c({
        family: "market_transition",
        significance: 0.5,
        marketId: `m${i}`,
        motif: "market_transition:market:Back from the dead",
      }),
    );

  it("pushes repeats of one motif below other stories of equal strength", () => {
    // Genuinely varied alternatives — different families, markets and motifs —
    // so this measures the motif cap rather than the alternatives penalising
    // each other for sharing a family.
    const fams: EventFamily[] = [
      "live_action",
      "conviction_celebration",
      "collective_story",
      "relationship_story",
      "live_action",
      "conviction_celebration",
    ];
    const varied = fams.map((family, i) =>
      c({ family, significance: 0.5, marketId: `v${i}`, motif: `varied:${i}` }),
    );
    // Judged on what a reader actually sees first. Twelve candidates into ten
    // rows would force four repeats however good the ordering, so the property
    // that matters is that they sink — not that they vanish.
    const top = mixFeed([...woken(6), ...varied]).slice(0, 6);
    const repeats = top.filter((r) => r.motif?.includes("Back from the dead")).length;
    expect(repeats).toBeLessThanOrEqual(CADENCE.maxPerMotif + 1);
  });

  it("still shows them when they are the only thing that happened", () => {
    // A penalty, never a filter: a quiet day of one kind is still a feed.
    expect(mixFeed(woken(5))).toHaveLength(5);
  });

  it("never holds back genuinely breaking news of a repeated kind", () => {
    const breaking = c({
      family: "market_transition",
      significance: 0.95,
      marketId: "big",
      motif: "market_transition:market:Back from the dead",
    });
    const rows = mixFeed([...woken(4), breaking]);
    expect(rows[0].id).toBe(breaking.id);
  });
});
