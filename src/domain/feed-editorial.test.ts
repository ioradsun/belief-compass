import { describe, expect, it } from "vitest";
import { earnsSlot, editFeed, pruneRepeats, type EditorialRow } from "./feed-editorial";

const row = (o: Partial<EditorialRow>): EditorialRow => ({
  id: Math.random().toString(36).slice(2),
  kind: "trade",
  marketId: "1",
  occurredAt: "2026-08-09T10:00:00.000Z",
  ...o,
});

describe("a second row must say something the first didn't", () => {
  it("collapses repeated snapshots of one fact to the newest", () => {
    const a = row({ id: "a", motif: "drain", occurredAt: "2026-08-09T10:00:00.000Z", amountUsd: 10 });
    const b = row({ id: "b", motif: "drain", occurredAt: "2026-08-09T08:00:00.000Z", amountUsd: 11 });
    const c = row({ id: "c", motif: "drain", occurredAt: "2026-08-09T05:00:00.000Z", amountUsd: 9 });
    expect(pruneRepeats([a, b, c]).map((r) => r.id)).toEqual(["a"]);
  });

  it("keeps a second telling when the magnitude materially escalated", () => {
    const a = row({ id: "a", motif: "drain", occurredAt: "2026-08-09T10:00:00.000Z", amountUsd: 100 });
    const b = row({ id: "b", motif: "drain", occurredAt: "2026-08-09T08:00:00.000Z", amountUsd: 10 });
    expect(pruneRepeats([a, b]).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("does not collapse the same motif across different markets", () => {
    const a = row({ id: "a", marketId: "1", motif: "divergence" });
    const b = row({ id: "b", marketId: "2", motif: "divergence" });
    expect(pruneRepeats([a, b])).toHaveLength(2);
  });

  it("leaves rows without a motif alone", () => {
    expect(pruneRepeats([row({ id: "a" }), row({ id: "b" })])).toHaveLength(2);
  });

  it("preserves input order", () => {
    const rows = [
      row({ id: "old", motif: "m", occurredAt: "2026-08-09T01:00:00.000Z" }),
      row({ id: "other", motif: null }),
      row({ id: "new", motif: "m", occurredAt: "2026-08-09T09:00:00.000Z" }),
    ];
    expect(pruneRepeats(rows).map((r) => r.id)).toEqual(["other", "new"]);
  });
});

describe("low-value truth is not news", () => {
  it("refuses a penny exit", () => {
    expect(earnsSlot(row({ action: "exit", amountUsd: 0.01 }))).toBe(false);
    expect(earnsSlot(row({ action: "exit", amountUsd: 40 }))).toBe(true);
  });

  it("refuses a 3-conviction milestone from a stranger", () => {
    expect(earnsSlot(row({ kind: "person_milestone", rung: 3 }))).toBe(false);
    expect(earnsSlot(row({ kind: "person_milestone", rung: 3, personal: true }))).toBe(true);
    expect(earnsSlot(row({ kind: "person_milestone", rung: 25 }))).toBe(true);
  });
});

describe("editFeed", () => {
  it("subtracts, never adds or reorders", () => {
    const rows = [
      row({ id: "penny", action: "exit", amountUsd: 0.01 }),
      row({ id: "keep", action: "exit", amountUsd: 12 }),
    ];
    expect(editFeed(rows).map((r) => r.id)).toEqual(["keep"]);
  });
});
