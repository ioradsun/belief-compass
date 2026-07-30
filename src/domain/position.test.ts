import { describe, expect, it } from "vitest";
import { positionPnl } from "@/domain/position";

describe("positionPnl", () => {
  it("computes gain from authoritative invested vs worth", () => {
    const p = positionPnl({ invested: 100, worth: 118 });
    expect(p).toEqual({ investedUsd: 100, worthUsd: 118, gainUsd: 18, gainPct: 18 });
  });

  it("reports a loss honestly", () => {
    const p = positionPnl({ invested: 100, worth: 80 });
    expect(p.gainUsd).toBe(-20);
    expect(p.gainPct).toBe(-20);
  });

  it("omits invested/gain when cost basis is missing (never fabricates)", () => {
    const p = positionPnl({ invested: null, worth: 118 });
    expect(p.investedUsd).toBeNull();
    expect(p.gainUsd).toBeNull();
    expect(p.gainPct).toBeNull();
    expect(p.worthUsd).toBe(118); // worth still shows
  });

  it("treats a zero cost basis (fully exited) as no invested, not a 0-division", () => {
    const p = positionPnl({ invested: 0, worth: 0 });
    expect(p.investedUsd).toBeNull();
    expect(p.gainPct).toBeNull();
  });

  it("does not invent gain when worth is unknown", () => {
    const p = positionPnl({ invested: 100, worth: null });
    expect(p.investedUsd).toBe(100);
    expect(p.gainUsd).toBeNull();
    expect(p.gainPct).toBeNull();
  });

  it("ignores non-finite inputs", () => {
    const p = positionPnl({ invested: Number.NaN, worth: Number.POSITIVE_INFINITY });
    expect(p).toEqual({ investedUsd: null, worthUsd: null, gainUsd: null, gainPct: null });
  });
});
