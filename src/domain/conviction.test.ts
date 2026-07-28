import { describe, it, expect } from "vitest";
import { convictionSignal, type ConvictionHolder } from "./conviction";

const h = (over: Partial<ConvictionHolder>): ConvictionHolder => ({
  wallet: "0xabc",
  name: "Someone",
  avatarUrl: null,
  side: "YES",
  shares: 100,
  daysHeld: 10,
  ...over,
});

describe("convictionSignal — diamond hands (time × size)", () => {
  it("picks the strongest holder by time × size, not time alone", () => {
    const holders = [
      h({ wallet: "0xlong", name: "Patient dust", shares: 1, daysHeld: 90 }), // 90
      h({ wallet: "0xbig", name: "Big & held", shares: 500, daysHeld: 30 }), // 15000
    ];
    const s = convictionSignal(holders, "YES");
    expect(s?.kind).toBe("diamond");
    expect(s?.wallet).toBe("0xbig");
    expect(s?.label).toBe("Diamond hands");
    expect(s?.detail).toBe("30d");
  });

  it("labels a fresh (<1 day) champion as a top holder, not diamond hands", () => {
    const s = convictionSignal([h({ shares: 500, daysHeld: 0 })], "YES");
    expect(s?.label).toBe("Top holder");
    expect(s?.detail).toBe("just in");
  });

  it("only considers holders on the requested side", () => {
    const holders = [
      h({ wallet: "0xyes", side: "YES", shares: 100, daysHeld: 5 }),
      h({ wallet: "0xno", side: "NO", shares: 900, daysHeld: 40 }),
    ];
    expect(convictionSignal(holders, "YES")?.wallet).toBe("0xyes");
    expect(convictionSignal(holders, "NO")?.wallet).toBe("0xno");
  });

  it("ignores zero-share (expressed-only) positions", () => {
    const s = convictionSignal([h({ shares: 0, daysHeld: 50 })], "YES");
    expect(s).toBeNull();
  });
});

describe("convictionSignal — network takes priority", () => {
  it("shows a trusted twin/tribe holder over a bigger stranger", () => {
    const holders = [
      h({ wallet: "0xstranger", name: "Whale", shares: 9999, daysHeld: 99 }),
      h({ wallet: "0xfriend", name: "Your person", shares: 10, daysHeld: 2 }),
    ];
    const network = new Map([["0xfriend", "tribe"]]);
    const s = convictionSignal(holders, "YES", { network });
    expect(s?.kind).toBe("network");
    expect(s?.wallet).toBe("0xfriend");
    expect(s?.label).toBe("Your tribe");
    expect(s?.yours).toBe(true);
  });

  it("distinguishes twin from tribe", () => {
    const network = new Map([["0xabc", "twin"]]);
    expect(convictionSignal([h({})], "YES", { network })?.label).toBe("Your twin");
  });

  it("ignores opp/inverse relationships for the conviction slot", () => {
    const network = new Map([["0xabc", "opp"]]);
    const s = convictionSignal([h({ shares: 200, daysHeld: 20 })], "YES", { network });
    expect(s?.kind).toBe("diamond"); // falls through to the diamond tier
    expect(s?.yours).toBe(false);
  });
});

describe("convictionSignal — momentum fallback and dead sides", () => {
  it("shows momentum only when no one holds and the price is moving", () => {
    const s = convictionSignal([], "YES", { momentumPct: 8 });
    expect(s?.kind).toBe("momentum");
    expect(s?.detail).toBe("▲ 8%");
    expect(s?.wallet).toBeNull();
  });

  it("stays silent when momentum is weak or negative", () => {
    expect(convictionSignal([], "YES", { momentumPct: 1 })).toBeNull();
    expect(convictionSignal([], "YES", { momentumPct: -10 })).toBeNull();
  });

  it("prefers a real holder over momentum", () => {
    const s = convictionSignal([h({ shares: 100, daysHeld: 5 })], "YES", { momentumPct: 20 });
    expect(s?.kind).toBe("diamond");
  });

  it("returns null for a dead side with no signal", () => {
    expect(convictionSignal([], "YES")).toBeNull();
  });
});
