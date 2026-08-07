import { describe, it, expect } from "vitest";
import {
  composeForYou,
  reasonFor,
  FOR_YOU,
  type ForYouCandidate,
  type NamedPerson,
} from "./for-you";

const T0 = Date.parse("2026-08-07T00:00:00Z");
const p = (name: string | null, wallet = `0x${name ?? "anon"}`): NamedPerson => ({ wallet, name });

const invited = (over: Partial<Extract<ForYouCandidate, { kind: "invited" }>> = {}) =>
  ({
    kind: "invited",
    marketId: 1,
    title: "Q",
    atMs: T0,
    reason: "You agree 87% of the time across 12 markets",
    from: [p("Sarah")],
    ...over,
  }) satisfies ForYouCandidate;

const tribe = (over: Partial<Extract<ForYouCandidate, { kind: "tribe" }>> = {}) =>
  ({
    kind: "tribe",
    marketId: 2,
    title: "Q",
    atMs: T0,
    people: [p("Ana")],
    topic: null,
    ...over,
  }) satisfies ForYouCandidate;

const similar = (over: Partial<Extract<ForYouCandidate, { kind: "similar" }>> = {}) =>
  ({
    kind: "similar",
    marketId: 3,
    title: "Q",
    atMs: T0,
    backedSimilar: 3,
    ...over,
  }) satisfies ForYouCandidate;

/**
 * THE RULE IS THE FEATURE. Everything else in this module is presentation; the
 * one thing that must never bend is that a row without a reason about THIS
 * person does not exist.
 */
describe("a row may appear only if the system can say why THIS person", () => {
  it("gives every surviving row a non-empty reason", () => {
    const rows = composeForYou([
      invited(),
      tribe(),
      similar(),
      { kind: "rival", marketId: 4, title: "Q", atMs: T0, people: [p("Ivo")], viewerSide: "YES" },
      { kind: "followed", marketId: 5, title: "Q", atMs: T0, people: [p("Kim")] },
    ]);
    expect(rows.length).toBe(5);
    for (const r of rows) expect(r.reason.trim().length).toBeGreaterThan(0);
  });

  it("drops a candidate whose evidence is missing rather than softening it", () => {
    // Each of these is the same market with the reason knocked out. None may
    // survive as a quieter row — a fallback string is what would kill the rule.
    const unjustifiable: ForYouCandidate[] = [
      invited({ reason: "   " }),
      tribe({ people: [] }),
      { kind: "rival", marketId: 4, title: "Q", atMs: T0, people: [p("Ivo")], viewerSide: null },
      { kind: "rival", marketId: 4, title: "Q", atMs: T0, people: [], viewerSide: "NO" },
      { kind: "followed", marketId: 5, title: "Q", atMs: T0, people: [] },
      similar({ backedSimilar: FOR_YOU.minSimilar - 1 }),
      similar({ backedSimilar: Number.NaN }),
    ];
    for (const c of unjustifiable) expect(reasonFor(c), c.kind).toBeNull();
    expect(composeForYou(unjustifiable)).toEqual([]);
  });

  it("has no reason a generic market could ever satisfy", () => {
    // The negative statement of the rule: there is no candidate shape carrying
    // no viewer-specific evidence, so "new market" has nowhere to enter.
    const kinds = ["invited", "tribe", "rival", "followed", "similar"] as const;
    const empty = kinds.map(
      (kind) =>
        ({
          kind,
          marketId: 9,
          title: "Q",
          atMs: T0,
          reason: "",
          from: [],
          people: [],
          topic: null,
          viewerSide: null,
          backedSimilar: 0,
        }) as unknown as ForYouCandidate,
    );
    expect(composeForYou(empty)).toEqual([]);
  });
});

describe("the sentences name people when they can and count them when they cannot", () => {
  it("uses a stored invitation reason verbatim, never a recomputed one", () => {
    const r = reasonFor(invited({ reason: "You agree 87% of the time across 12 markets" }));
    expect(r).toContain("You agree 87% of the time across 12 markets");
    expect(r).toContain("Sarah");
  });

  it("still speaks when the sender has never set a name", () => {
    const r = reasonFor(invited({ from: [p(null)] }));
    expect(r).toContain("1 person invited you");
  });

  it("leads with a name and folds the rest into a count", () => {
    const r = reasonFor(tribe({ people: [p("Ana"), p("Bo"), p(null), p(null)] }));
    expect(r).toBe("Ana and Bo and 2 others from your Tribe took sides here");
  });

  it("counts an all-anonymous group rather than going silent", () => {
    expect(reasonFor(tribe({ people: [p(null), p(null)] }))).toBe(
      "2 people from your Tribe took sides here",
    );
  });

  it("sharpens with a shared topic when there is one, and works without", () => {
    expect(reasonFor(tribe({ topic: "AI" }))).toContain("you usually agree on AI");
    expect(reasonFor(tribe({ topic: null }))).not.toContain("usually agree on");
  });

  it("names the viewer's own side, because that is what makes it a challenge", () => {
    const r = reasonFor({
      kind: "rival",
      marketId: 4,
      title: "Q",
      atMs: T0,
      people: [p("Ivo")],
      viewerSide: "NO",
    });
    expect(r).toContain("the other side of your NO");
  });
});

describe("one market says one thing, and the strongest thing", () => {
  it("keeps the invitation over a computed match for the same market", () => {
    const rows = composeForYou([
      similar({ marketId: 1, backedSimilar: 9, atMs: T0 + 10_000 }),
      invited({ marketId: 1 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("invited");
  });

  it("breaks a same-kind collision by recency", () => {
    const rows = composeForYou([
      tribe({ marketId: 2, people: [p("Old")], atMs: T0 }),
      tribe({ marketId: 2, people: [p("New")], atMs: T0 + 60_000 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toContain("New");
  });

  it("never recommends a market the viewer is already in", () => {
    const rows = composeForYou([invited({ marketId: 1 }), tribe({ marketId: 2 })], {
      alreadyIn: new Set([1]),
    });
    expect(rows.map((r) => r.marketId)).toEqual([2]);
  });
});

describe("ordering and bounds", () => {
  it("puts a person naming you above anything computed, however stale", () => {
    const rows = composeForYou([
      similar({ marketId: 3, atMs: T0 + 999_999 }),
      tribe({ marketId: 2, atMs: T0 + 999_999 }),
      invited({ marketId: 1, atMs: T0 - 999_999 }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["invited", "tribe", "similar"]);
  });

  it("is a total order, so the shelf cannot reshuffle between loads", () => {
    const cands = [
      tribe({ marketId: 5, atMs: T0 }),
      tribe({ marketId: 2, atMs: T0 }),
      tribe({ marketId: 9, atMs: T0 }),
    ];
    const forward = composeForYou(cands).map((r) => r.marketId);
    const backward = composeForYou([...cands].reverse()).map((r) => r.marketId);
    expect(backward).toEqual(forward);
    expect(forward).toEqual([2, 5, 9]);
  });

  it("stays a shelf rather than becoming a second feed", () => {
    const many = Array.from({ length: 30 }, (_, i) => tribe({ marketId: i + 1 }));
    expect(composeForYou(many).length).toBe(FOR_YOU.maxRows);
  });

  it("is empty when nothing can be justified, which is the common case today", () => {
    // Measured platform-wide: Tribe is 0 for 95% of wallets, Rivals is 0 for
    // everyone, and there are no follow edges. An empty shelf is the honest
    // answer, and it must be reachable without special-casing.
    expect(composeForYou([])).toEqual([]);
  });
});
