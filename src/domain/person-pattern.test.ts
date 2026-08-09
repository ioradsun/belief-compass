import { describe, it, expect } from "vitest";
import { findPersonPatterns, type PatternRow } from "./person-pattern";

const row = (r: Partial<PatternRow> & { id: string }): PatternRow => ({
  wallet: "0xabc",
  marketId: "1",
  side: "YES",
  action: "enter",
  amountUsd: 50,
  occurredAt: "2026-08-09T12:00:00.000Z",
  ...r,
});

describe("findPersonPatterns", () => {
  it("says nothing about one market", () => {
    expect(findPersonPatterns([row({ id: "a" }), row({ id: "b" })])).toEqual([]);
  });

  it("notices a one-sided pair", () => {
    const p = findPersonPatterns([
      row({ id: "a", marketId: "1", side: "NO" }),
      row({ id: "b", marketId: "2", side: "NO", occurredAt: "2026-08-09T13:00:00.000Z" }),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]!.kind).toBe("one_way");
    expect(p[0]!.note).toContain("both on NO");
    expect(p[0]!.rowId).toBe("b"); // newest row carries the aside
  });

  it("calls three entries a run", () => {
    const p = findPersonPatterns([
      row({ id: "a", marketId: "1", side: "YES" }),
      row({ id: "b", marketId: "2", side: "NO" }),
      row({ id: "c", marketId: "3", side: "YES" }),
    ]);
    expect(p[0]!.kind).toBe("sweep");
    expect(p[0]!.note).toContain("third question");
  });

  it("notices money rotating out of one belief into another", () => {
    const p = findPersonPatterns([
      row({ id: "a", marketId: "1", action: "exit" }),
      row({ id: "b", marketId: "2", action: "enter" }),
    ]);
    expect(p[0]!.kind).toBe("rotation");
  });

  it("notices an unwind", () => {
    const p = findPersonPatterns([
      row({ id: "a", marketId: "1", action: "exit" }),
      row({ id: "b", marketId: "2", action: "reduce" }),
    ]);
    expect(p[0]!.kind).toBe("unwinding");
  });

  it("ignores dust and non-belief rows", () => {
    expect(
      findPersonPatterns([
        row({ id: "a", marketId: "1", amountUsd: 0.02 }),
        row({ id: "b", marketId: "2", action: "milestone" }),
        row({ id: "c", marketId: "3", wallet: null }),
      ]),
    ).toEqual([]);
  });

  it("is deterministic and gives a person at most one aside", () => {
    const rows = [
      row({ id: "a", marketId: "1" }),
      row({ id: "b", marketId: "2", occurredAt: "2026-08-09T14:00:00.000Z" }),
      row({ id: "c", marketId: "2", occurredAt: "2026-08-09T13:00:00.000Z" }),
    ];
    const one = findPersonPatterns(rows);
    expect(one).toHaveLength(1);
    expect(findPersonPatterns([...rows].reverse())).toEqual(one);
  });
});

describe("when the pattern is the story, it gets the headline", () => {
  const r = (id: string, market: string, action: string, side: "YES" | "NO", at: string) => ({
    id,
    wallet: "0xk",
    name: "Kodak",
    marketId: market,
    side,
    action,
    amountUsd: 20,
    occurredAt: at,
  });

  it("leads with the person backing away", () => {
    const p = findPersonPatterns([
      r("a", "1", "exit", "YES", "2026-08-09T10:00:00.000Z"),
      r("b", "2", "exit", "NO", "2026-08-09T09:00:00.000Z"),
    ])[0]!;
    expect(p.lead?.headline).toBe("KODAK is backing away");
    expect(p.lead?.body).toContain("two positions");
  });

  it("leads with a one-way lean", () => {
    const p = findPersonPatterns([
      r("a", "1", "enter", "YES", "2026-08-09T10:00:00.000Z"),
      r("b", "2", "enter", "YES", "2026-08-09T09:00:00.000Z"),
    ])[0]!;
    expect(p.lead?.headline).toBe("KODAK keeps leaning YES");
  });

  it("has no headline when we cannot name the person", () => {
    const p = findPersonPatterns([
      { ...r("a", "1", "exit", "YES", "2026-08-09T10:00:00.000Z"), name: null },
      { ...r("b", "2", "exit", "NO", "2026-08-09T09:00:00.000Z"), name: null },
    ])[0]!;
    expect(p.lead).toBeNull();
  });
});
