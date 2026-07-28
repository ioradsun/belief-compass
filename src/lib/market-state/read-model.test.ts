import { describe, it, expect } from "vitest";
import {
  peopleYesPct,
  peopleNoPct,
  directionalBelievers,
  divergencePctPoints,
  sellRate,
  buySellRatio,
  circulation,
  marketAgeDays,
  inactiveForSeconds,
  transitionKind,
  isNewBeliever,
  selectLiveLine,
  believerMilestoneAtOrBelow,
  type LiveLineInput,
} from "./read-model";

describe("participation metrics", () => {
  it("people% excludes MIXED/INACTIVE (uses directional totals only)", () => {
    // 6 YES, 4 NO directional believers (mixed/inactive are simply not passed in).
    expect(peopleYesPct(6, 4)).toBe(60);
    expect(peopleNoPct(6, 4)).toBe(40);
    expect(directionalBelievers(6, 4)).toBe(10);
  });
  it("people% is null with no directional believers", () => {
    expect(peopleYesPct(0, 0)).toBeNull();
  });
});

describe("divergence = people_yes − money_yes (percentage points)", () => {
  it("computes signed percentage points", () => {
    expect(divergencePctPoints(60, 45)).toBe(15);
    expect(divergencePctPoints(30, 45)).toBe(-15);
  });
  it("is null when either side is null (never fabricated)", () => {
    expect(divergencePctPoints(null, 45)).toBeNull();
    expect(divergencePctPoints(60, null)).toBeNull();
  });
});

describe("activity rates", () => {
  it("sell_rate = sells / (buys+sells), guarded at zero", () => {
    expect(sellRate(6, 4)).toBeCloseTo(0.4, 9);
    expect(sellRate(0, 0)).toBe(0);
  });
  it("buy_sell_ratio guarded at zero sells", () => {
    expect(buySellRatio(10, 0)).toBe(10);
    expect(buySellRatio(6, 3)).toBe(2);
  });
});

describe("circulation has one explicit formula with correct zero-capital behavior", () => {
  it("volume / total capital", () => {
    expect(circulation(320, 100)).toBeCloseTo(3.2, 9);
  });
  it("null (not Infinity, not zero) when capital is zero/absent", () => {
    expect(circulation(320, 0)).toBeNull();
    expect(circulation(320, null)).toBeNull();
  });
});

describe("lifecycle", () => {
  const now = Date.UTC(2026, 0, 8, 0, 0, 0);
  it("age in days from created_at", () => {
    expect(marketAgeDays(new Date(Date.UTC(2026, 0, 1)).toISOString(), now)).toBeCloseTo(7, 6);
    expect(marketAgeDays(null, now)).toBeNull();
  });
  it("inactive seconds from last trade", () => {
    expect(inactiveForSeconds(new Date(now - 5000).toISOString(), now)).toBe(5);
    expect(inactiveForSeconds(null, now)).toBeNull();
  });
});

describe("position transitions (new believers vs side flips)", () => {
  it("INACTIVE/MIXED → directional is a NEW believer", () => {
    expect(transitionKind("INACTIVE", "YES")).toBe("position_became_directional");
    expect(transitionKind("MIXED", "NO")).toBe("position_became_directional");
    expect(isNewBeliever("INACTIVE", "YES")).toBe(true);
  });
  it("YES → NO is a SIDE FLIP, NOT a new believer", () => {
    expect(transitionKind("YES", "NO")).toBe("position_changed_side");
    expect(isNewBeliever("YES", "NO")).toBe(false);
  });
  it("directional → MIXED / INACTIVE are exits", () => {
    expect(transitionKind("YES", "MIXED")).toBe("position_became_mixed");
    expect(transitionKind("NO", "INACTIVE")).toBe("position_became_inactive");
  });
  it("same-side and INACTIVE↔MIXED are not transitions (repeated same-side buys)", () => {
    expect(transitionKind("YES", "YES")).toBeNull();
    expect(transitionKind("INACTIVE", "MIXED")).toBeNull();
    expect(transitionKind("MIXED", "INACTIVE")).toBeNull();
  });
});

describe("milestone rung", () => {
  it("largest round threshold at or below n", () => {
    expect(believerMilestoneAtOrBelow(100)).toBe(100);
    expect(believerMilestoneAtOrBelow(137)).toBe(100);
    expect(believerMilestoneAtOrBelow(9)).toBeNull();
    expect(believerMilestoneAtOrBelow(600)).toBe(500);
  });
});

const base = (over: Partial<LiveLineInput> = {}): LiveLineInput => ({
  now: Date.UTC(2026, 0, 8, 12, 0, 0),
  newBelievers: { "1h": 0, "24h": 0, "7d": 0 },
  newBelieversSide: null,
  volumeUsd: { "1h": 0, "24h": 0, "7d": 0 },
  tradeCount: { "1h": 0, "24h": 0, "7d": 0 },
  buyCount24h: 0,
  sellCount24h: 0,
  directionalBelievers: 0,
  directionalBelieversMilestone: null,
  peopleYesCrossed: null,
  peopleYesCrossedAt: null,
  firstTradeAt: null,
  lastTradeAt: null,
  isFirstTrade: false,
  ...over,
});

describe("live line: fully supported by structured evidence", () => {
  it("returns null when there is no evidence (never fabricates)", () => {
    expect(selectLiveLine(base())).toBeNull();
  });

  it("new believers line matches its payload and window", () => {
    const ll = selectLiveLine(
      base({
        newBelievers: { "1h": 18, "24h": 20, "7d": 25 },
        newBelieversSide: "YES",
        tradeCount: { "1h": 27, "24h": 30, "7d": 35 },
        lastTradeAt: "2026-01-08T11:59:00Z",
      }),
    )!;
    expect(ll.kind).toBe("new_believers");
    expect(ll.window).toBe("1h");
    expect(ll.line).toBe("18 believers backed YES in the last hour.");
    expect(ll.payload).toMatchObject({ window: "1h", wallets: 18, side: "YES", trade_count: 27 });
  });

  it("evidence ladder: sparse 1h falls back to 24h and DISCLOSES the window", () => {
    const ll = selectLiveLine(
      base({
        newBelievers: { "1h": 0, "24h": 9, "7d": 12 },
        tradeCount: { "1h": 0, "24h": 14, "7d": 20 },
      }),
    )!;
    expect(ll.window).toBe("24h");
    expect(ll.line).toContain("today");
    expect(ll.payload).toMatchObject({ window: "24h", wallets: 9 });
  });

  it("further fallback to 7d is disclosed", () => {
    const ll = selectLiveLine(
      base({
        newBelievers: { "1h": 0, "24h": 0, "7d": 4 },
        tradeCount: { "1h": 0, "24h": 0, "7d": 4 },
      }),
    )!;
    expect(ll.window).toBe("7d");
    expect(ll.line).toContain("the last 7 days");
  });

  it("a people% overtake is the highest-priority change", () => {
    const ll = selectLiveLine(
      base({
        peopleYesCrossed: "NO_over_YES",
        peopleYesCrossedAt: "2026-01-08T11:48:00Z",
        newBelievers: { "1h": 5, "24h": 5, "7d": 5 },
      }),
    )!;
    expect(ll.kind).toBe("side_overtake");
    expect(ll.line).toBe("NO overtook YES.");
    expect(ll.occurredAt).toBe("2026-01-08T11:48:00Z");
  });

  it("first-trade line only when supported", () => {
    const ll = selectLiveLine(base({ isFirstTrade: true, firstTradeAt: "2026-01-08T10:00:00Z" }))!;
    expect(ll.kind).toBe("first_trade");
    expect(ll.occurredAt).toBe("2026-01-08T10:00:00Z");
  });

  it("selection is deterministic regardless of candidate discovery order", () => {
    const input = base({
      newBelievers: { "1h": 3, "24h": 3, "7d": 3 },
      volumeUsd: { "1h": 500, "24h": 500, "7d": 500 },
      tradeCount: { "1h": 4, "24h": 4, "7d": 4 },
      buyCount24h: 2,
      sellCount24h: 3,
    });
    expect(selectLiveLine(input)).toEqual(selectLiveLine({ ...input }));
  });
});
