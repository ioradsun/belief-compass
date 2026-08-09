import { describe, it, expect } from "vitest";
import { activity } from "./activity";
import { signalsFromActivityRows, type ActivityFactRow } from "../signals";

const row = (over: Partial<ActivityFactRow> & { id: string }): ActivityFactRow => ({
  kind: "trade_burst",
  marketId: "42",
  side: "YES",
  occurredAt: "2026-01-01T00:00:00.000Z",
  payload: { action: "BUY" },
  ...over,
});

// A mixed market history: two YES, one NO, one market-wide (null side, e.g. the
// market opening), plus a row from a DIFFERENT market.
const signals = signalsFromActivityRows([
  row({ id: "yes-2", side: "YES", occurredAt: "2026-01-01T02:00:00.000Z" }),
  row({ id: "no-1", side: "NO", occurredAt: "2026-01-01T01:30:00.000Z" }),
  row({ id: "yes-1", side: "YES", occurredAt: "2026-01-01T01:00:00.000Z" }),
  row({ id: "open", side: null, kind: "market_created", occurredAt: "2026-01-01T00:00:00.000Z" }),
  row({ id: "other", side: "YES", marketId: "99", occurredAt: "2026-01-01T03:00:00.000Z" }),
]);

describe("insider projection — activity", () => {
  it("scopes to the market and drops other markets", () => {
    const out = activity(signals, { marketId: 42 });
    expect(out.signals.some((s) => s.id === "other")).toBe(false);
    expect(out.marketId).toBe(42);
  });

  it("no side → the whole market, market-wide rows included, newest first", () => {
    const out = activity(signals, { marketId: 42 });
    expect(out.signals.map((s) => s.id)).toEqual(["yes-2", "no-1", "yes-1", "open"]);
    expect(out.side).toBeNull();
  });

  it("a side query keeps only that side and EXCLUDES market-wide rows (parity with eq(side))", () => {
    const yes = activity(signals, { marketId: 42, side: "YES" });
    expect(yes.signals.map((s) => s.id)).toEqual(["yes-2", "yes-1"]);
    // "open" is null-side (market-wide) and must not appear inside a side column.
    expect(yes.signals.some((s) => s.id === "open")).toBe(false);

    const no = activity(signals, { marketId: 42, side: "NO" });
    expect(no.signals.map((s) => s.id)).toEqual(["no-1"]);
    expect(no.side).toBe("NO");
  });

  it("applies the limit after scope + order", () => {
    const out = activity(signals, { marketId: 42, limit: 2 });
    expect(out.signals.map((s) => s.id)).toEqual(["yes-2", "no-1"]);
  });

  it("does not mutate or reorder the caller's array", () => {
    const input = signalsFromActivityRows([
      row({ id: "a", occurredAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: "b", occurredAt: "2026-01-01T05:00:00.000Z" }),
    ]);
    const before = input.map((s) => s.id);
    activity(input, { marketId: 42 });
    expect(input.map((s) => s.id)).toEqual(before);
  });
});
