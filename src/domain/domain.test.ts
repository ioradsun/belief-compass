import { describe, it, expect } from "vitest";
import {
  applyTrade, evaluate, emptyRow, reduce, matchScore, circleMatches,
  MIN_SHARED_MARKETS,
  type Trade, type BeliefRow, type BeliefFactor,
} from "./domain";


const ts = (iso: string) => new Date(iso);
const buy = (side: "YES" | "NO", shares: number, cost: number, at: string): Trade =>
  ({ side, direction: "BUY", token_amount: shares, eth_amount: cost, ts: ts(at) });
const sell = (side: "YES" | "NO", shares: number, proceeds: number, at: string): Trade =>
  ({ side, direction: "SELL", token_amount: shares, eth_amount: proceeds, ts: ts(at) });

describe("applyTrade — trade-driven state", () => {
  it("initial buy sets expressed_side, directional_since, first_backed_at", () => {
    const r = applyTrade(emptyRow(), buy("YES", 100, 50, "2026-01-01"));
    expect(r.yes_shares).toBe(100);
    expect(r.yes_cost).toBe(50);
    expect(r.expressed_side).toBe("YES");
    expect(r.directional_since?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(r.first_backed_at?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("YES→YES add preserves directional_since", () => {
    const t1 = ts("2026-01-01"), t2 = ts("2026-02-01");
    const r1 = applyTrade(emptyRow(), buy("YES", 100, 50, t1.toISOString()));
    const r2 = applyTrade(r1, buy("YES", 100, 60, t2.toISOString()));
    expect(r2.directional_since?.toISOString()).toBe(t1.toISOString());
    expect(r2.yes_cost).toBeCloseTo(110);
  });

  it("YES→NO flip resets directional_since to flip ts", () => {
    const r1 = applyTrade(emptyRow(), buy("YES", 100, 50, "2026-01-01"));
    const r2 = applyTrade(r1, buy("NO", 300, 60, "2026-02-01"));
    expect(r2.expressed_side).toBe("NO");
    expect(r2.directional_since?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("full exit nulls directional_since and zeroes cost", () => {
    const r1 = applyTrade(emptyRow(), buy("YES", 100, 50, "2026-01-01"));
    const r2 = applyTrade(r1, sell("YES", 100, 40, "2026-02-01"));
    expect(r2.yes_shares).toBe(0);
    expect(r2.yes_cost).toBe(0);
    expect(r2.expressed_side).toBe("INACTIVE");
    expect(r2.directional_since).toBeNull();
  });

  it("partial sell scales cost proportionally", () => {
    const r1 = applyTrade(emptyRow(), buy("YES", 100, 80, "2026-01-01"));
    const r2 = applyTrade(r1, sell("YES", 40, 30, "2026-02-01"));
    expect(r2.yes_shares).toBe(60);
    expect(r2.yes_cost).toBeCloseTo(48); // 80 * (1 - 40/100)
    expect(r2.expressed_side).toBe("YES");
  });

  it("balanced dual-side buy → MIXED, directional_since nulled", () => {
    const r1 = applyTrade(emptyRow(), buy("YES", 100, 50, "2026-01-01"));
    const r2 = applyTrade(r1, buy("NO", 100, 50, "2026-02-01"));
    expect(r2.expressed_side).toBe("MIXED");
    expect(r2.directional_since).toBeNull();
  });
});

describe("evaluate — price-driven view", () => {
  it("computes stance and side from live prices", () => {
    const r = applyTrade(emptyRow(), buy("YES", 100, 50, "2026-01-01"));
    const v = evaluate(r, { yesPriceUsd: 1, noPriceUsd: 0.5 }, ts("2026-01-31"));
    expect(v.stance).toBeCloseTo(1); // no NO shares
    expect(v.stance_side).toBe("YES");
    expect(v.days_held).toBeCloseTo(30, 0);
    expect(v.conviction).toBeGreaterThan(0.6);
    expect(v.conviction).toBeLessThan(1);
  });

  it("conviction floor 0.60 for a brand-new direction", () => {
    const r = applyTrade(emptyRow(), buy("YES", 1, 0.01, "2026-01-01"));
    const v = evaluate(r, { yesPriceUsd: 1, noPriceUsd: 1 }, ts("2026-01-01"));
    expect(v.conviction).toBeGreaterThanOrEqual(0.6 - 0.001);
  });
});

describe("Invariant (a): price-only changes never mutate expressed_side / directional_since", () => {
  it("evaluate returns view without touching row fields", () => {
    const r = applyTrade(emptyRow(), buy("YES", 100, 50, "2026-01-01"));
    const snapshot: BeliefRow = { ...r };
    for (const p of [
      { yesPriceUsd: 1, noPriceUsd: 0.5 },
      { yesPriceUsd: 0.4, noPriceUsd: 0.6 }, // would flip by value alone
      { yesPriceUsd: 0.01, noPriceUsd: 0.5 },
    ]) {
      evaluate(r, p, ts("2026-06-01"));
      expect(r.expressed_side).toBe(snapshot.expressed_side);
      expect(r.directional_since?.getTime()).toBe(snapshot.directional_since?.getTime());
      expect(r.yes_shares).toBe(snapshot.yes_shares);
    }
  });

  it("value-driven stance_side can be MIXED even when expressed_side is YES", () => {
    // wallet is 60/40 YES by shares → expressed YES.
    const r1 = applyTrade(emptyRow(), buy("YES", 60, 60, "2026-01-01"));
    const r2 = applyTrade(r1, buy("NO", 40, 40, "2026-01-02"));
    expect(r2.expressed_side).toBe("YES");
    // Prices drift so NO position ~ equals YES position in value.
    const v = evaluate(r2, { yesPriceUsd: 1, noPriceUsd: 1.5 }, ts("2026-01-10"));
    expect(v.stance_side).toBe("MIXED");
    // Row unchanged.
    expect(r2.expressed_side).toBe("YES");
  });
});

describe("Invariant (b): reduce(all) === reduce(a) + reduce(b)", () => {
  const trades: Trade[] = [
    buy("YES", 100, 50, "2026-01-01"),
    buy("NO", 40, 30, "2026-01-05"),
    buy("YES", 50, 30, "2026-01-10"),
    sell("YES", 30, 20, "2026-01-15"),
    buy("NO", 200, 100, "2026-01-20"),
  ];

  it.each([1, 2, 3, 4])("split at %i", (i: number) => {
    const full = reduce(trades);
    const partial = reduce(trades.slice(i), reduce(trades.slice(0, i)));
    expect(partial.yes_shares).toBeCloseTo(full.yes_shares);
    expect(partial.no_shares).toBeCloseTo(full.no_shares);
    expect(partial.yes_cost).toBeCloseTo(full.yes_cost);
    expect(partial.no_cost).toBeCloseTo(full.no_cost);
    expect(partial.expressed_side).toBe(full.expressed_side);
    expect(partial.directional_since?.getTime()).toBe(full.directional_since?.getTime());
  });
});

describe("Invariant (c): idempotent replay", () => {
  it("same ordered trades → identical row twice", () => {
    const trades: Trade[] = [
      buy("YES", 100, 50, "2026-01-01"),
      buy("YES", 25, 20, "2026-01-02"),
      sell("YES", 40, 35, "2026-01-05"),
    ];
    const r1 = reduce(trades);
    const r2 = reduce(trades);
    expect(r2).toEqual(r1);
  });
});

describe("matchScore", () => {
  it("returns insufficient when < 5 shared markets", () => {
    const a = Array.from({ length: 3 }, (_, i) => ({
      onchain_id: i, stance: 1, stance_side: "YES" as const, conviction: 0.8,
    }));
    const b = Array.from({ length: 3 }, (_, i) => ({
      onchain_id: i, stance: 1, stance_side: "YES" as const, conviction: 0.8,
    }));
    const m = matchScore(a, b);
    expect(m.shared).toBe(3);
    expect(m.insufficient).toBe(true);
    expect(MIN_SHARED_MARKETS).toBe(5);
  });

  it("agreement across 10 markets scores high", () => {
    const a = Array.from({ length: 10 }, (_, i) => ({
      onchain_id: i, stance: 1, stance_side: "YES" as const, conviction: 0.9,
    }));
    const b = Array.from({ length: 10 }, (_, i) => ({
      onchain_id: i, stance: 1, stance_side: "YES" as const, conviction: 0.9,
    }));
    const m = matchScore(a, b);
    expect(m.raw).toBeCloseTo(1);
    expect(m.agreements).toBe(10);
    expect(m.disagreements).toBe(0);
    expect(m.match_score).toBeGreaterThan(75);
  });

  it("total disagreement scores below 50", () => {
    const a = Array.from({ length: 10 }, (_, i) => ({
      onchain_id: i, stance: 1, stance_side: "YES" as const, conviction: 0.9,
    }));
    const b = Array.from({ length: 10 }, (_, i) => ({
      onchain_id: i, stance: -1, stance_side: "NO" as const, conviction: 0.9,
    }));
    const m = matchScore(a, b);
    expect(m.raw).toBeCloseTo(-1);
    expect(m.match_score).toBeLessThan(30);
    expect(m.agreements).toBe(0);
    expect(m.disagreements).toBe(10);
  });

  it("thin evidence shrinks toward 50", () => {
    const a = Array.from({ length: 5 }, (_, i) => ({
      onchain_id: i, stance: 1, stance_side: "YES" as const, conviction: 0.9,
    }));
    const b = Array.from({ length: 5 }, (_, i) => ({
      onchain_id: i, stance: 1, stance_side: "YES" as const, conviction: 0.9,
    }));
    const m = matchScore(a, b);
    // 5/(5+8) = 0.385 confidence — heavily shrunk
    expect(m.match_score).toBeGreaterThan(60);
    expect(m.match_score).toBeLessThan(80);
  });
});
