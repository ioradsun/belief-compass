import { describe, it, expect } from "vitest";
import { flowForWindow, composePulseStory, type FlowTrade } from "./market-flow";

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

describe("composePulseStory", () => {
  const flow = (win: FlowTrade[]) => flowForWindow(win, "24h", NOW);

  it("says nothing when nothing happened", () => {
    const s = composePulseStory(flow([]), { yes: 6, no: -6 }, "24h");
    expect(s.kind).toBe("quiet");
    expect(s.metrics).toHaveLength(0);
  });

  it("leads with believers, then money, then price", () => {
    const s = composePulseStory(
      flow([
        t({ wallet: "0xa", usd: 20 }),
        t({ wallet: "0xb", usd: 12 }),
        t({ wallet: "0xc", usd: 10 }),
      ]),
      { yes: 6.3, no: -6.3 },
      "24h",
    );
    expect(s.headline).toBe("Growing conviction on YES");
    expect(s.metrics.map((m) => m.key)).toEqual(["believers", "money", "price"]);
    expect(s.metrics[0].text).toBe("+3 believers");
    expect(s.metrics[1].text).toBe("+$42 backed");
    expect(s.metrics[2].text).toBe("Price +6.3%");
  });

  it("calls out one big investor with no crowd", () => {
    const s = composePulseStory(
      flow([t({ wallet: "0xa", usd: 18000 })]),
      { yes: 2, no: -2 },
      "24h",
    );
    expect(s.kind).toBe("whale");
    expect(s.note).toContain("$18k");
  });

  it("recognises many small joiners as grassroots", () => {
    const trades = Array.from({ length: 6 }, (_, i) =>
      t({ wallet: `0x${i}`, usd: 5, side: "NO" }),
    );
    const s = composePulseStory(flow(trades), { yes: 0, no: 1 }, "24h");
    expect(s.kind).toBe("grassroots");
    expect(s.side).toBe("NO");
  });

  it("reports a balanced fight as divided", () => {
    const s = composePulseStory(
      flow([t({ wallet: "0xa", usd: 60 }), t({ wallet: "0xb", side: "NO", usd: 60 })]),
      { yes: 1, no: -1 },
      "24h",
    );
    expect(s.kind).toBe("divided");
  });

  it("never quotes a total, only change", () => {
    const s = composePulseStory(
      flow([t({ wallet: "0xa", usd: 20 }), t({ wallet: "0xb", usd: 22 })]),
      { yes: 6.3, no: -6.3 },
      "24h",
    );
    for (const m of s.metrics) expect(m.text).toMatch(/^(\+|−|Price)/);
  });
});
