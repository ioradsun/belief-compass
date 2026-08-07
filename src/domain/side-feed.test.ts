import { describe, it, expect } from "vitest";
import { sideFeed, type SideFeedInput } from "./side-feed";
import type { TapeTrade } from "./conviction-series";
import type { NetTag } from "./feed-event";

const NOW = 1_000_000_000_000;
const min = (m: number) => NOW - m * 60_000;

const buy = (w: string, eth: number, tMin: number, side: "YES" | "NO" = "YES"): TapeTrade => ({
  w,
  side,
  action: "BUY",
  eth,
  price: 0.5,
  t: min(tMin),
});
const sell = (w: string, eth: number, tMin: number, side: "YES" | "NO" = "YES"): TapeTrade => ({
  w,
  side,
  action: "SELL",
  eth,
  price: 0.5,
  t: min(tMin),
});

const base = (over: Partial<SideFeedInput>): SideFeedInput => ({
  trades: [],
  side: "YES",
  win: "24h",
  nowMs: NOW,
  ethUsd: 2000,
  marketBelievers: 30,
  believersNow: 18,
  capitalEthNow: 0.4,
  money: (eth) => `$${(eth * 2000).toFixed(2)}`,
  ...over,
});

describe("side feed — the anatomy of one side", () => {
  it("reports believers joining with a current-state line", () => {
    const trades = [buy("a", 0.02, 20), buy("b", 0.02, 19), buy("c", 0.02, 18)];
    const items = sideFeed(base({ trades, believersNow: 18 }));
    const people = items.find((i) => i.emoji === "👥");
    expect(people).toBeTruthy();
    expect(people!.headline).toContain("3 believers joined YES");
    expect(people!.current).toBe("YES now has 18 believers");
    expect(people!.tone).toBe("up");
  });

  it("reports capital leaving with the money leading and its own current state", () => {
    const trades = [buy("a", 0.5, 200, "NO"), sell("a", 0.3, 20, "NO")];
    const items = sideFeed(base({ trades, side: "NO", believersNow: 4, capitalEthNow: 0.4 }));
    const cap = items.find((i) => i.emoji === "↩");
    expect(cap).toBeTruthy();
    expect(cap!.headline).toContain("left NO");
    expect(cap!.headline).toContain("$"); // money leads
    expect(cap!.tone).toBe("down");
    expect(cap!.current).toBe("NO now holds $800.00");
  });

  it("stays chronological — newest first, never re-sorted by tier", () => {
    const trades = [
      buy("a", 0.02, 60),
      buy("b", 0.02, 59),
      buy("c", 0.02, 58), // older beat
      buy("d", 0.9, 5), // newer, bigger
    ];
    const items = sideFeed(base({ trades }));
    for (let i = 1; i < items.length; i += 1)
      expect(items[i - 1].t).toBeGreaterThanOrEqual(items[i].t);
  });

  it("attaches current state to only the most recent beat of each dimension", () => {
    const trades = [
      buy("a", 0.02, 60),
      buy("b", 0.02, 59), // older people beat (different bucket)
      buy("c", 0.02, 5),
      buy("d", 0.02, 4), // newer people beat
    ];
    const items = sideFeed(base({ trades }));
    const people = items.filter((i) => i.emoji === "👥");
    expect(people.length).toBeGreaterThanOrEqual(2);
    expect(people[0].current).toBe("YES now has 18 believers"); // newest carries it
    expect(people[1].current).toBeNull(); // older does not repeat it
  });
});

describe("importance gating — dust vs meaning", () => {
  it("drops a lone tiny buy in a whale market", () => {
    const trades = [buy("a", 0.001, 10)]; // ~$2 in a huge market
    const items = sideFeed(base({ trades, marketBelievers: 4000, believersNow: 4000 }));
    expect(items.length).toBe(0);
  });

  it("keeps the same tiny buy in a tiny market", () => {
    const trades = [buy("a", 0.003, 10)]; // ~$6 in a 2-believer market
    const items = sideFeed(base({ trades, marketBelievers: 2, believersNow: 1 }));
    expect(items.length).toBeGreaterThan(0);
  });
});

describe("social tagging", () => {
  const net = (pairs: [string, NetTag][]) => new Map(pairs.map(([w, t]) => [w.toLowerCase(), t]));

  it("names your Twin", () => {
    const items = sideFeed(
      base({ trades: [buy("twinwallet", 0.02, 10)], network: net([["twinwallet", "twin"]]) }),
    );
    const people = items.find((i) => i.emoji === "👥");
    expect(people!.headline).toBe("Your Twin joined YES");
    expect(people!.dimension).toBe("social");
  });

  it("counts Tribe members joining", () => {
    const trades = [buy("t1", 0.02, 12), buy("t2", 0.02, 11), buy("t3", 0.02, 10)];
    const items = sideFeed(
      base({
        trades,
        network: net([
          ["t1", "tribe"],
          ["t2", "tribe"],
          ["t3", "tribe"],
        ]),
      }),
    );
    const people = items.find((i) => i.emoji === "👥");
    expect(people!.headline).toContain("members of your Tribe joined YES");
  });

  it("reads opp as Rival", () => {
    const items = sideFeed(base({ trades: [buy("r1", 0.02, 10)], network: net([["r1", "opp"]]) }));
    const people = items.find((i) => i.emoji === "👥");
    expect(people!.headline).toBe("Your Rival joined YES");
  });
});

describe("structural beats", () => {
  it("emits a believer milestone as a Tier-1 beat", () => {
    // Nine before the window, one inside → crosses 10.
    const trades: TapeTrade[] = [];
    for (let i = 0; i < 9; i += 1) trades.push(buy(`old${i}`, 0.02, 2000));
    trades.push(buy("newbie", 0.02, 10));
    const items = sideFeed(base({ trades, believersNow: 10 }));
    const mile = items.find((i) => i.emoji === "🏆");
    expect(mile).toBeTruthy();
    expect(mile!.headline).toBe("YES reached 10 believers");
    expect(mile!.tier).toBe(1);
  });

  it("pulls an outsized single buy out as a whale beat", () => {
    const trades = [
      buy("a", 0.02, 30),
      buy("b", 0.02, 29),
      buy("c", 0.02, 28),
      buy("whale", 0.6, 10), // ≥6× the median
    ];
    const items = sideFeed(base({ trades }));
    const whale = items.find((i) => i.emoji === "🐋");
    expect(whale).toBeTruthy();
    expect(whale!.headline).toContain("backed YES with");
  });
});
