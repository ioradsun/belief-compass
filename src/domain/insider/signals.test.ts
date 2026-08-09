import { describe, it, expect } from "vitest";
import {
  signalsFromActivityRows,
  insiderKindFromRow,
  INSIDER_BUILDER_VERSION,
  type ActivityFactRow,
} from "./signals";

const row = (over: Partial<ActivityFactRow> = {}): ActivityFactRow => ({
  id: "chain:8453:0xabc:3",
  kind: "trade_burst",
  marketId: "42",
  side: "YES",
  occurredAt: "2026-01-01T00:00:00.000Z",
  payload: { action: "BUY" },
  ...over,
});

describe("insider builder — signalsFromActivityRows", () => {
  it("is a pure, deterministic replay: identical rows → identical signals", () => {
    const rows = [row({ id: "a" }), row({ id: "b", side: "NO" })];
    const a = signalsFromActivityRows(rows);
    const b = signalsFromActivityRows(rows);
    expect(a).toEqual(b);
    // Order preserved from the input (groupLiveRows already sorts newest-first).
    expect(a.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("carries provenance back to the canonical row + a versioned builder", () => {
    const [s] = signalsFromActivityRows([row({ id: "chain:8453:0xdef:7" })]);
    expect(s.provenance.sourceEventIds).toEqual(["chain:8453:0xdef:7"]);
    expect(s.provenance.builderVersion).toBe(INSIDER_BUILDER_VERSION);
    expect(s.provenance.reasonCodes).toContain("row:trade_burst");
    expect(s.provenance.reasonCodes).toContain("action:BUY");
  });

  it("does not score activity — evidence stays uncomputed (null != zero), no judgment", () => {
    const [s] = signalsFromActivityRows([row()]);
    expect(Object.values(s.evidence).every((v) => v === null)).toBe(true);
    expect(s.judgment).toBeUndefined();
  });

  it("parses the string marketId to a number", () => {
    const [s] = signalsFromActivityRows([row({ marketId: "77" })]);
    expect(s.marketId).toBe(77);
  });

  it("maps row families to signal kinds conservatively", () => {
    expect(insiderKindFromRow(row({ kind: "trade_burst" }))).toBe("trade");
    expect(insiderKindFromRow(row({ kind: "large_trade" }))).toBe("trade");
    expect(insiderKindFromRow(row({ kind: "round_trip" }))).toBe("trade");
    expect(insiderKindFromRow(row({ kind: "wallet_sweep" }))).toBe("trade");
    expect(insiderKindFromRow(row({ kind: "market_created" }))).toBe("market_created");
    expect(insiderKindFromRow(row({ kind: "side_shift" }))).toBe("side_flip");
    expect(insiderKindFromRow(row({ kind: "believer_milestone" }))).toBe("milestone");
    expect(insiderKindFromRow(row({ kind: "tribe_doubled" }))).toBe("milestone");
  });

  it("treats a timeless row as a standing signal", () => {
    const [s] = signalsFromActivityRows([row({ kind: "trade_burst", timeless: true })]);
    expect(s.kind).toBe("standing");
    expect(s.provenance.reasonCodes).toContain("timeless");
  });
});
