import { describe, it, expect } from "vitest";
import {
  priceAt,
  priceProofSince,
  groupPricePaths,
  PROOF_MAX_STALENESS_MS,
  PROOF_MIN_ELAPSED_MS,
} from "./price-proof";

const H = 3_600_000;
const path = (n: number, start: number, price = (i: number) => 2 + i * 0.1) =>
  Array.from({ length: n }, (_, i) => ({ atMs: start + i * H, price: price(i) }));

describe("priceAt", () => {
  it("returns the newest observation at or before the moment", () => {
    const p = path(5, 0);
    expect(priceAt(p, 2 * H + 100)?.atMs).toBe(2 * H);
  });

  it("refuses when the nearest observation is too stale — a hole is not proof", () => {
    const p = [{ atMs: 0, price: 2 }];
    expect(priceAt(p, PROOF_MAX_STALENESS_MS + 1)).toBeNull();
  });

  it("refuses an empty or missing path", () => {
    expect(priceAt([], 1)).toBeNull();
    expect(priceAt(null, 1)).toBeNull();
  });

  it("ignores non-positive and non-finite prices", () => {
    expect(priceAt([{ atMs: 0, price: 0 }], 1000)).toBeNull();
  });
});

describe("priceProofSince", () => {
  it("proves a move measured from the moment, not from a 24h window", () => {
    const p = path(6, 0, (i) => (i < 3 ? 2 : 2.4));
    const proof = priceProofSince(p, 2 * H, 6 * H);
    expect(proof).not.toBeNull();
    expect(proof!.priceThen).toBe(2);
    expect(proof!.priceNow).toBeCloseTo(2.4);
    expect(proof!.relMove).toBeCloseTo(0.2);
  });

  it("returns null when nothing has been observed since the moment yet", () => {
    const p = path(3, 0);
    const recent = 2 * H + PROOF_MIN_ELAPSED_MS - 1;
    expect(priceProofSince(p, recent, recent + 10)).toBeNull();
  });

  it("returns null when the before-side is missing", () => {
    const p = path(3, 10 * H);
    expect(priceProofSince(p, 0, 13 * H)).toBeNull();
  });
});

describe("groupPricePaths", () => {
  it("groups by market and sorts oldest-first, dropping unusable rows", () => {
    const grouped = groupPricePaths([
      { onchain_id: 7, captured_at: "2026-01-01T02:00:00Z", yes_price_usd: "2.2" },
      { onchain_id: 7, captured_at: "2026-01-01T01:00:00Z", yes_price_usd: 2 },
      { onchain_id: 7, captured_at: "2026-01-01T03:00:00Z", yes_price_usd: null },
      { onchain_id: 9, captured_at: "2026-01-01T01:00:00Z", yes_price_usd: 1 },
    ]);
    expect(grouped.get(7)!.map((s) => s.price)).toEqual([2, 2.2]);
    expect(grouped.get(9)).toHaveLength(1);
  });
});
