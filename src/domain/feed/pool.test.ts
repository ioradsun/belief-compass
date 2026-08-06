import { describe, it, expect } from "vitest";
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
