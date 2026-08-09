import { describe, expect, it } from "vitest";
import {
  capFamilies,
  collapseCausal,
  earnsSlot,
  editFeed,
  pruneRepeats,
  type EditorialRow,
} from "./feed-editorial";

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

  it("refuses a small milestone from a stranger", () => {
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

describe("a derived move must not restate a named one", () => {
  const trade = row({
    id: "trade",
    kind: "trade",
    marketId: "7",
    side: "NO",
    occurredAt: "2026-08-09T10:00:00.000Z",
  });

  it("drops the capital reading that a believer's exit already explained", () => {
    const derived = row({
      id: "capital",
      kind: "market_transition",
      marketId: "7",
      side: "NO",
      derived: true,
      metric: "capital",
      occurredAt: "2026-08-09T09:30:00.000Z",
    });
    expect(collapseCausal([trade, derived]).map((r) => r.id)).toEqual(["trade"]);
  });

  it("drops the price reading for the same reason", () => {
    const derived = row({
      id: "price",
      kind: "market_transition",
      marketId: "7",
      side: "NO",
      derived: true,
      metric: "price",
      occurredAt: "2026-08-09T11:00:00.000Z",
    });
    expect(collapseCausal([trade, derived])).toHaveLength(1);
  });

  it("keeps a derived move on the other side", () => {
    const derived = row({
      id: "yes",
      marketId: "7",
      side: "YES",
      derived: true,
      metric: "capital",
      occurredAt: "2026-08-09T10:05:00.000Z",
    });
    expect(collapseCausal([trade, derived])).toHaveLength(2);
  });

  it("keeps a derived move far outside the causal window", () => {
    const derived = row({
      id: "old",
      marketId: "7",
      side: "NO",
      derived: true,
      occurredAt: "2026-08-08T10:00:00.000Z",
    });
    expect(collapseCausal([trade, derived])).toHaveLength(2);
  });

  it("keeps a derived move in a market with no named story", () => {
    const derived = row({ id: "lonely", marketId: "9", side: "NO", derived: true });
    expect(collapseCausal([trade, derived]).map((r) => r.id)).toEqual(["trade", "lonely"]);
  });
});

describe("a row the reader cannot place is not a story", () => {
  it("drops a row with no market context", () => {
    expect(earnsSlot(row({ context: false }))).toBe(false);
    expect(earnsSlot(row({ context: true }))).toBe(true);
    expect(earnsSlot(row({}))).toBe(true);
  });
});

describe("rolling-window state is one story, re-read", () => {
  const roll = (id: string, at: string, amt: number) =>
    row({ id, marketId: "5", motif: "people_capital_divergence", rolling: true, occurredAt: at, amountUsd: amt });

  it("replaces the earlier reading even when the numbers moved a lot", () => {
    const a = roll("late", "2026-08-09T10:00:00.000Z", 85);
    const b = roll("early", "2026-08-09T09:10:00.000Z", 215);
    expect(pruneRepeats([a, b]).map((r) => r.id)).toEqual(["late"]);
  });

  it("still allows a different category on the same market", () => {
    const a = roll("div", "2026-08-09T10:00:00.000Z", 85);
    const b = row({ id: "drain", marketId: "5", motif: "material_move:capital", rolling: true });
    expect(pruneRepeats([a, b])).toHaveLength(2);
  });

  it("keeps the escalation exemption for moment events", () => {
    const a = row({ id: "a", motif: "big_backing", amountUsd: 500, occurredAt: "2026-08-09T10:00:00.000Z" });
    const b = row({ id: "b", motif: "big_backing", amountUsd: 20, occurredAt: "2026-08-09T09:00:00.000Z" });
    expect(pruneRepeats([a, b])).toHaveLength(2);
  });
});

describe("one family may not own the feed", () => {
  it("keeps only the two strongest resurrections", () => {
    const rows = ["a", "b", "c", "d"].map((id) =>
      row({ id, marketId: id, family: "market_reawakened" }),
    );
    expect(capFamilies(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("does not cap uncapped families", () => {
    const rows = ["a", "b", "c"].map((id) => row({ id, marketId: id, family: "trade" }));
    expect(capFamilies(rows)).toHaveLength(3);
  });
});

describe("small conviction counts are not global news", () => {
  it("needs 25 from a stranger, any rung from someone you know", () => {
    expect(earnsSlot(row({ kind: "person_milestone", rung: 5 }))).toBe(false);
    expect(earnsSlot(row({ kind: "person_milestone", rung: 5, personal: true }))).toBe(true);
    expect(earnsSlot(row({ kind: "person_milestone", rung: 25 }))).toBe(true);
  });
});
