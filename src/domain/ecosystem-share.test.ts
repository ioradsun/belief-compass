import { describe, expect, it } from "vitest";
import { buildShare, sharePct, type ShareRpc } from "./ecosystem-share";

const ETH_USD = 2000;
// 2026-08-02T00:00:00Z — fixed so the generated day window is deterministic.
const NOW = Date.UTC(2026, 7, 2);
const day = (offset: number) => new Date(NOW - offset * 86_400_000).toISOString().slice(0, 10);

const eth = (n: number) => String(BigInt(Math.round(n * 1e6)) * BigInt(1e12)); // n ETH in wei

const rpc = (over: Partial<ShareRpc> = {}): ShareRpc => ({
  totals: { ecoBuyWei: eth(100), convBuyWei: eth(1), ecoMarkets: 200, convMarkets: 4 },
  baseline: { ecoBuyWei: eth(0), convBuyWei: eth(0), ecoMarkets: 0, convMarkets: 0 },
  byDay: [],
  ...over,
});

describe("sharePct", () => {
  it("is zero for an empty ecosystem rather than NaN", () => {
    expect(sharePct(0, 0)).toBe(0);
    expect(sharePct(5, 0)).toBe(0);
  });

  it("computes a plain percentage", () => {
    expect(sharePct(1, 100)).toBeCloseTo(1);
    expect(sharePct(25, 200)).toBeCloseTo(12.5);
  });
});

describe("buildShare", () => {
  it("returns null when the RPC gave nothing", () => {
    expect(buildShare(null, ETH_USD, NOW, 90)).toBeNull();
  });

  it("converts wei totals to USD and divides into a share", () => {
    const s = buildShare(rpc(), ETH_USD, NOW, 90)!;
    expect(s.volume.ecoUsd).toBeCloseTo(200_000); // 100 ETH * $2000
    expect(s.volume.convUsd).toBeCloseTo(2_000); // 1 ETH * $2000
    expect(s.volume.pct).toBeCloseTo(1); // 1 of 100 ETH
    expect(s.markets.pct).toBeCloseTo(2); // 4 of 200
  });

  it("reads 0.00% before anything is attributed, without dividing by zero", () => {
    const s = buildShare(
      rpc({ totals: { ecoBuyWei: eth(100), convBuyWei: eth(0), ecoMarkets: 200, convMarkets: 0 } }),
      ETH_USD,
      NOW,
      90,
    )!;
    expect(s.volume.pct).toBe(0);
    expect(s.markets.pct).toBe(0);
    expect(Number.isFinite(s.volume.pct)).toBe(true);
  });

  it("emits one point per day inclusive of both ends", () => {
    const s = buildShare(rpc(), ETH_USD, NOW, 90)!;
    expect(s.series).toHaveLength(91);
    expect(s.series[0].day).toBe(day(90));
    expect(s.series[s.series.length - 1].day).toBe(day(0));
  });

  it("accumulates daily buckets into a monotonic cumulative curve", () => {
    const s = buildShare(
      rpc({
        byDay: [
          { day: day(2), ecoBuyWei: eth(10), convBuyWei: eth(1), ecoMarkets: 3, convMarkets: 1 },
          { day: day(1), ecoBuyWei: eth(20), convBuyWei: eth(2), ecoMarkets: 5, convMarkets: 2 },
        ],
      }),
      ETH_USD,
      NOW,
      90,
    )!;
    const at = (o: number) => s.series.find((p) => p.day === day(o))!;

    expect(at(3).ecoVolumeUsd).toBe(0);
    expect(at(2).ecoVolumeUsd).toBeCloseTo(20_000); // 10 ETH
    expect(at(1).ecoVolumeUsd).toBeCloseTo(60_000); // +20 ETH
    expect(at(0).ecoVolumeUsd).toBeCloseTo(60_000); // carries forward on a quiet day

    expect(at(1).convMarkets).toBe(3); // 1 + 2
    expect(at(1).ecoMarkets).toBe(8); // 3 + 5

    // A cumulative curve must never go backwards.
    for (let i = 1; i < s.series.length; i++) {
      expect(s.series[i].ecoVolumeUsd).toBeGreaterThanOrEqual(s.series[i - 1].ecoVolumeUsd);
      expect(s.series[i].ecoMarkets).toBeGreaterThanOrEqual(s.series[i - 1].ecoMarkets);
    }
  });

  it("starts the curve at the pre-window baseline, not at zero", () => {
    const s = buildShare(
      rpc({
        baseline: { ecoBuyWei: eth(50), convBuyWei: eth(5), ecoMarkets: 100, convMarkets: 2 },
        byDay: [{ day: day(0), ecoBuyWei: eth(10), convBuyWei: eth(1), ecoMarkets: 1, convMarkets: 1 }],
      }),
      ETH_USD,
      NOW,
      90,
    )!;
    expect(s.series[0].ecoVolumeUsd).toBeCloseTo(100_000); // 50 ETH baseline
    expect(s.series[0].ecoMarkets).toBe(100);
    const last = s.series[s.series.length - 1];
    expect(last.ecoVolumeUsd).toBeCloseTo(120_000); // baseline + 10 ETH
    expect(last.convMarkets).toBe(3);
  });

  it("ignores buckets that fall outside the generated window", () => {
    const s = buildShare(
      rpc({ byDay: [{ day: day(400), ecoBuyWei: eth(99), convBuyWei: eth(99), ecoMarkets: 9, convMarkets: 9 }] }),
      ETH_USD,
      NOW,
      90,
    )!;
    expect(s.series[s.series.length - 1].ecoVolumeUsd).toBe(0);
  });

  it("never lets our slice exceed the whole market", () => {
    const s = buildShare(
      rpc({
        byDay: [{ day: day(1), ecoBuyWei: eth(10), convBuyWei: eth(4), ecoMarkets: 4, convMarkets: 2 }],
      }),
      ETH_USD,
      NOW,
      90,
    )!;
    for (const p of s.series) {
      expect(p.convVolumeUsd).toBeLessThanOrEqual(p.ecoVolumeUsd);
      expect(p.convMarkets).toBeLessThanOrEqual(p.ecoMarkets);
    }
  });
});
