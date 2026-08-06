import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPool, POOL, POOL_SLICES, sliceLabel, type PoolSlice } from "./pool";

/** Markets numbered inside a band so each slice's ids are recognisable. */
const slice = (base: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ onchainId: base + i }));

const ALL_SLICES = (n: number) =>
  POOL_SLICES.reduce(
    (acc, s, i) => ((acc[s] = slice((i + 1) * 1000, n)), acc),
    {} as Record<PoolSlice, { onchainId: number }[]>,
  );

describe("the pool is a union of questions, not one ordering", () => {
  /**
   * The whole point. The old pool was `ORDER BY volume DESC LIMIT 50`, so a
   * market created an hour ago sat near rank 2,000 and `freshness` — 15% of the
   * weight vector — had nothing to apply itself to. A quota is the only thing
   * that makes a slice real.
   */
  it("guarantees every slice its floor even when another slice could fill the pool", () => {
    const { kept } = buildPool({
      bySlice: { ...ALL_SLICES(5), active: slice(1000, 500) },
    });
    for (const s of POOL_SLICES) expect(kept[s]).toBeGreaterThan(0);
    expect(kept.fresh).toBe(5);
  });

  it("cannot be crowded out: a small slice keeps its quota against a huge one", () => {
    const { kept } = buildPool({
      bySlice: { active: slice(1000, 1000), fresh: slice(2000, 50) },
    });
    expect(kept.fresh).toBeGreaterThanOrEqual(POOL.slices.fresh.quota);
  });

  it("gives an empty slice's space away rather than shrinking the pool", () => {
    const full = buildPool({ bySlice: ALL_SLICES(200) });
    const noFresh = buildPool({ bySlice: { ...ALL_SLICES(200), fresh: [] } });
    expect(full.markets).toHaveLength(POOL.total);
    expect(noFresh.markets).toHaveLength(POOL.total);
    expect(noFresh.kept.fresh).toBe(0);
  });

  it("never exceeds the ceiling", () => {
    expect(buildPool({ bySlice: ALL_SLICES(500) }).markets.length).toBe(POOL.total);
    expect(buildPool({ bySlice: ALL_SLICES(500), total: 12 }).markets.length).toBe(12);
  });

  /**
   * The quotas must not sum to the ceiling, or the second pass is dead and a
   * busy day cannot spend a quiet slice's unused space.
   */
  it("leaves genuinely contested space above the quotas", () => {
    const quotas = POOL_SLICES.reduce((n, s) => n + POOL.slices[s].quota, 0);
    expect(quotas).toBeLessThan(POOL.total);
  });

  it("asks for at least as many rows as it could keep from each slice", () => {
    for (const s of POOL_SLICES) {
      expect(POOL.slices[s].fetch).toBeGreaterThanOrEqual(POOL.slices[s].quota);
    }
  });
});

describe("a market appears once, however many doors it came through", () => {
  it("deduplicates and records every slice that offered it", () => {
    const { markets } = buildPool({
      bySlice: { active: [{ onchainId: 7 }], fresh: [{ onchainId: 7 }], deep: [{ onchainId: 7 }] },
    });
    expect(markets).toHaveLength(1);
    expect(markets[0]!.slices).toEqual(["active", "fresh", "deep"]);
  });

  /**
   * A duplicate must cost the pool nothing. If an overlapping market consumed a
   * slice's quota, a slice whose rows the other slices already carry would
   * silently contribute fewer distinct markets than its quota promises — which
   * is the crowding-out bug the quotas exist to prevent, wearing a disguise.
   *
   * Which slice CLAIMS a shared market is not specified and must not be: the
   * passes interleave, so whoever reaches it first gets it. What is specified is
   * that every distinct market survives and the overlap is free.
   */
  it("does not let overlap cost the pool distinct markets", () => {
    const shared = slice(1000, 20);
    const onlyFresh = slice(9000, 20);
    const { markets, claimed } = buildPool({
      bySlice: { active: shared, fresh: [...shared, ...onlyFresh] },
    });
    expect(markets).toHaveLength(40);
    const ids = new Set(markets.map((m) => m.row.onchainId));
    for (const r of onlyFresh) expect(ids.has(r.onchainId)).toBe(true);
    // Every distinct market is claimed exactly once, by exactly one slice.
    expect(claimed.active + claimed.fresh).toBe(40);
  });

  it("keeps provenance in a stable order regardless of arrival", () => {
    const a = buildPool({ bySlice: { deep: [{ onchainId: 1 }], active: [{ onchainId: 1 }] } });
    expect(a.markets[0]!.slices).toEqual(["active", "deep"]);
  });
});

describe("the merged order alternates between the questions", () => {
  /**
   * Round-robin rather than slice-by-slice: draining `active` first would put
   * every fresh market at the bottom, and any caller that truncates would undo
   * the quota the first pass just enforced.
   */
  it("interleaves slices instead of draining one at a time", () => {
    const { markets } = buildPool({
      bySlice: { active: slice(1000, 10), fresh: slice(2000, 10) },
      total: 6,
    });
    const bands = markets.map((m) => Math.floor(m.row.onchainId / 1000));
    expect(bands).toEqual([1, 2, 1, 2, 1, 2]);
  });

  it("preserves each slice's own ordering within the pool", () => {
    const { markets } = buildPool({ bySlice: { active: slice(1000, 40) }, total: 5 });
    expect(markets.map((m) => m.row.onchainId)).toEqual([1000, 1001, 1002, 1003, 1004]);
  });
});

describe("degenerate inputs", () => {
  it("returns nothing from nothing", () => {
    expect(buildPool({ bySlice: {} }).markets).toEqual([]);
    expect(buildPool({ bySlice: ALL_SLICES(0) }).markets).toEqual([]);
  });

  it("survives a zero ceiling without looping", () => {
    expect(buildPool({ bySlice: ALL_SLICES(10), total: 0 }).markets).toEqual([]);
  });

  it("names every slice for diagnostics", () => {
    for (const s of POOL_SLICES) expect(sliceLabel(s).length).toBeGreaterThan(0);
  });
});

/**
 * A LENS LABEL IS A PROMISE, AND THE POOL IS WHAT KEEPS IT.
 *
 * Explore ranks on capital and on participants. A ranking lens can only rank
 * what the pool admits, so each of those measures needs its OWN ordering with a
 * quota big enough to seat the whole Top 20 a reader might scroll. Measured
 * before the capital slice existed: 14 of the platform's true top 20 by capital
 * were in the pool, and 25 of the top 40 — the label meant "most capital among
 * whatever the other rules admitted".
 */
describe("the pool can back every lens label", () => {
  /** The deepest a reader is measured against — see scripts/check-lens-coverage. */
  const TOP_N = 20;

  it("has an ordering for each measure a lens names", () => {
    expect(POOL_SLICES).toContain("capital");
    expect(POOL_SLICES).toContain("participants");
  });

  it("guarantees each ranking lens enough room for its whole Top 20", () => {
    // The quota is the floor no other slice can eat. Below TOP_N the coverage
    // guarantee stops being structural and becomes a coincidence of the day's data.
    for (const s of ["capital", "participants", "fresh", "active"] as const) {
      expect(POOL.slices[s].quota, s).toBeGreaterThanOrEqual(TOP_N);
    }
  });

  it("fetches deeper than it seats, so eligibility can drop rows without starving a lens", () => {
    for (const s of POOL_SLICES) {
      expect(POOL.slices[s].fetch, s).toBeGreaterThanOrEqual(POOL.slices[s].quota);
    }
  });

  it("keeps the quotas collectively contestable rather than pre-allocating the pool", () => {
    // If the quotas summed to the ceiling, the second pass would never run and a
    // quiet slice's unclaimed space could not go to a busy one.
    const quotas = POOL_SLICES.reduce((n, s) => n + POOL.slices[s].quota, 0);
    expect(quotas).toBeLessThan(POOL.total);
  });

  it("did not solve coverage by loading the platform", () => {
    // 2,779 markets. The pool is a candidate set, not a table scan — every id
    // here is carried into the window aggregate, the baseline RPC and the
    // viewer's belief overlay.
    expect(POOL.total).toBeLessThanOrEqual(300);
  });

  it("every slice can still claim its floor when they all overflow", () => {
    // The guarantee is only real if a slice's quota survives six rivals.
    const rows = (base: number) => Array.from({ length: 90 }, (_, i) => ({ onchainId: base + i }));
    const { claimed } = buildPool({
      bySlice: {
        active: rows(1000),
        fresh: rows(2000),
        classified: rows(3000),
        believed: rows(4000),
        deep: rows(5000),
        capital: rows(6000),
        participants: rows(7000),
      },
    });
    for (const s of POOL_SLICES) {
      expect(claimed[s], s).toBeGreaterThanOrEqual(POOL.slices[s].quota);
    }
  });
});

/**
 * A DEGRADED POOL MUST NOT BE A SILENT ONE. Two slices are the only reason a
 * lens LABEL is true, so losing one is a semantic failure wearing a working
 * interface — measured, "Most Capital" drops from 20/20 to 14/20 and keeps
 * rendering. The server says so out loud rather than quietly serving it.
 */
describe("a failed slice is reported, not swallowed", () => {
  const code = readFileSync(join(process.cwd(), "src/lib/markets.functions.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("logs the slice that failed and what it costs", () => {
    expect(code).toMatch(/candidate pool slice .* failed/);
    expect(code).toMatch(/Most Capital.*incomplete pool/);
    expect(code).toMatch(/Most Participants.*incomplete pool/);
  });

  it("still tolerates it rather than taking the feed down", () => {
    // The whole read failing throws so it is never cached; one slice failing is
    // a degraded pool, and a reader with a degraded feed beats a reader with none.
    expect(code).toMatch(/errs\.length === Object\.keys\(results\)\.length/);
  });
});
