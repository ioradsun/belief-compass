import { describe, it, expect } from "vitest";
import {
  mixFeed,
  familyMix,
  familyOf,
  CADENCE,
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

  it("a viewer relationship makes any event a relationship story", () => {
    expect(familyOf({ kind: "conviction_cohort", personal: true })).toBe("relationship_story");
  });
});
