import { describe, it, expect } from "vitest";
import { flowForWindow, type FlowTrade } from "./market-flow";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const ago = (mins: number) => NOW - mins * 60_000;

const t = (o: Partial<FlowTrade>): FlowTrade => ({
  wallet: "0xa",
  side: "YES",
  action: "BUY",
  usd: 10,
  at: ago(10),
  ...o,
});

describe("flowForWindow", () => {
  it("counts a wallet's first buy as a new believer only once", () => {
    const f = flowForWindow(
      [t({ wallet: "0xa", at: ago(30) }), t({ wallet: "0xa", at: ago(10) })],
      "24h",
      NOW,
    );
    expect(f.yes.newBelievers).toBe(1);
    expect(f.yes.netUsd).toBe(20);
  });

  it("does not call an old holder a new believer", () => {
    const f = flowForWindow(
      [t({ wallet: "0xa", at: ago(60 * 48) }), t({ wallet: "0xa", at: ago(5) })],
      "1h",
      NOW,
    );
    expect(f.yes.newBelievers).toBe(0);
    expect(f.yes.netUsd).toBe(10);
  });

  it("nets sells out of money added", () => {
    const f = flowForWindow(
      [t({ usd: 100 }), t({ wallet: "0xb", action: "SELL", usd: 40 })],
      "24h",
      NOW,
    );
    expect(f.yes.netUsd).toBe(60);
  });

  it("keeps sides separate", () => {
    const f = flowForWindow([t({}), t({ wallet: "0xb", side: "NO", usd: 55 })], "24h", NOW);
    expect(f.yes.newBelievers).toBe(1);
    expect(f.no.newBelievers).toBe(1);
    expect(f.no.netUsd).toBe(55);
  });
});
