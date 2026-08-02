import { describe, expect, it } from "vitest";
import { windowChange } from "./window-change";

describe("windowChange", () => {
  it("measures the move against a real positive baseline", () => {
    expect(windowChange(12, 8)).toEqual({ delta: 4, pct: 50 });
    expect(windowChange(6, 8)).toEqual({ delta: -2, pct: -25 });
  });

  it("reports no change as an explicit zero, not null", () => {
    expect(windowChange(8, 8)).toEqual({ delta: 0, pct: 0 });
  });

  it("gives an absolute delta but no % when the market opened inside the window (base 0)", () => {
    // A real zero base: honest that 5 arrived, but a % has no denominator.
    expect(windowChange(5, 0)).toEqual({ delta: 5, pct: null });
  });

  it("claims no change at all when there is no baseline yet (null / undefined)", () => {
    // Distinct from "no change": we simply cannot establish the boundary state.
    expect(windowChange(5, null)).toEqual({ delta: null, pct: null });
    expect(windowChange(5, undefined)).toEqual({ delta: null, pct: null });
  });

  it("rejects non-finite inputs rather than inventing a move", () => {
    expect(windowChange(Number.NaN, 8)).toEqual({ delta: null, pct: null });
    expect(windowChange(8, Number.POSITIVE_INFINITY)).toEqual({ delta: null, pct: null });
  });
});
