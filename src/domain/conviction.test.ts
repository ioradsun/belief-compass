import { describe, it, expect } from "vitest";
import {
  convictionSignal,
  whaleWallets,
  type ConvictionHolder,
  type SidePosition,
} from "./conviction";

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

describe("whaleWallets — big money, relative to the market", () => {
  const p = (wallet: string, side: "YES" | "NO", valueUsd: number): SidePosition => ({
    wallet,
    side,
    valueUsd,
  });

  it("flags a position that towers over its side's median", () => {
    const whales = whaleWallets([
      p("0xbig", "YES", 3000),
      p("0xa", "YES", 100),
      p("0xb", "YES", 120),
      p("0xc", "YES", 90),
    ]);
    expect(whales.has("0xbig")).toBe(true);
    expect(whales.has("0xa")).toBe(false);
  });

  it("flags a lone big holder with no peers (absolute floor)", () => {
    const whales = whaleWallets([p("0xsolo", "NO", 8000)]);
    expect(whales.has("0xsolo")).toBe(true);
  });

  it("does not crown a small dominant position below the USD floor", () => {
    const whales = whaleWallets([p("0xtop", "YES", 40), p("0xrest", "YES", 5)]);
    expect(whales.size).toBe(0);
  });

  it("caps the number of whales per side", () => {
    const positions = Array.from({ length: 5 }, (_, i) => p(`0x${i}`, "YES", 10000));
    expect(whaleWallets(positions).size).toBe(2);
  });

  it("judges each side independently and ignores zero/negative values", () => {
    const whales = whaleWallets([
      p("0xyes", "YES", 9000),
      p("0xno", "NO", 0),
      p("0xno2", "NO", 12000),
    ]);
    expect(whales.has("0xyes")).toBe(true);
    expect(whales.has("0xno")).toBe(false);
    expect(whales.has("0xno2")).toBe(true);
  });
});

describe("convictionSignal — whale vs diamond hands", () => {
  it("calls a fresh big holder a whale, not diamond hands", () => {
    const s = convictionSignal([h({ shares: 9999, daysHeld: 2, whale: true })], "YES");
    expect(s?.kind).toBe("whale");
    expect(s?.label).toBe("Whale");
  });

  it("still calls a long-held whale diamond hands (conviction is earned)", () => {
    const s = convictionSignal([h({ shares: 9999, daysHeld: 30, whale: true })], "YES");
    expect(s?.kind).toBe("diamond");
    expect(s?.label).toBe("Diamond hands");
  });

  it("keeps a network match ahead of the whale label", () => {
    const network = new Map([["0xabc", "twin"]]);
    const s = convictionSignal([h({ whale: true, daysHeld: 1 })], "YES", { network });
    expect(s?.kind).toBe("network");
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
