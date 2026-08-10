import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  applyMarketStateRow,
  applyMarketStateBatch,
  affectedPulseKeys,
  affectedMarketKeys,
  affectedInsiderActivityKeys,
  affectedViewerValuationKeys,
  viewerPositionKeys,
  liveFieldsOf,
  versionOf,
  type MarketStateRow,
} from "./reduce";

/** A cached feed payload with server-computed enrichments the reducer must keep. */
const feedData = (id: number, over: Record<string, unknown> = {}) => ({
  items: [{ kind: "market", onchainId: id }],
  rows: {
    [id]: {
      onchain_id: id,
      yes_price_usd: 0.5,
      believers_yes: 10,
      // Enrichments market_state does NOT own — must survive a patch:
      story: { headline: "keep me" },
      yes_volume_usd: 1234,
      tribe_side: "YES",
      markets: { title: "Will X happen?", author_name: "Ada" },
      ...over,
    },
  },
  idea: null,
  ethUsd: 3000,
});

const stateRow = (id: number, over: Partial<MarketStateRow> = {}): MarketStateRow => ({
  onchain_id: id,
  read_model_version: 1,
  yes_price_usd: 0.73,
  no_price_usd: 0.27,
  believers_yes: 12,
  live_line: "3 new believers",
  opportunity_eligible: true,
  ...over,
});

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient();
});

describe("liveFieldsOf", () => {
  it("coerces numeric strings (PostgREST) to numbers", () => {
    const live = liveFieldsOf(stateRow(1, { yes_price_usd: "0.61" as unknown as number }));
    expect(live.yes_price_usd).toBe(0.61);
  });
  it("ignores fields market_state does not own", () => {
    const live = liveFieldsOf(stateRow(1, { story: { x: 1 } } as never));
    expect("story" in live).toBe(false);
  });
  it("normalizes opportunity_eligible to a boolean", () => {
    expect(
      liveFieldsOf(stateRow(1, { opportunity_eligible: "t" as never })).opportunity_eligible,
    ).toBe(true);
  });
});

describe("applyMarketStateRow", () => {
  it("patches canonical fields but preserves enrichments + joined metadata", () => {
    qc.setQueryData(["opp-feed", null, "24h", "all"], feedData(42));
    const touched = applyMarketStateRow(qc, stateRow(42));
    expect(touched).toBe(1);
    const row = (
      qc.getQueryData(["opp-feed", null, "24h", "all"]) as {
        rows: Record<number, Record<string, unknown>>;
      }
    ).rows[42];
    // canonical fields moved
    expect(row.yes_price_usd).toBe(0.73);
    expect(row.believers_yes).toBe(12);
    expect(row.live_line).toBe("3 new believers");
    // enrichments untouched
    expect(row.story).toEqual({ headline: "keep me" });
    expect(row.yes_volume_usd).toBe(1234);
    expect(row.tribe_side).toBe("YES");
    expect(row.markets).toEqual({ title: "Will X happen?", author_name: "Ada" });
  });

  it("patches every opp-feed variant that lists the market", () => {
    qc.setQueryData(["opp-feed", null, "24h", "all"], feedData(42));
    qc.setQueryData(["opp-feed", "0xabc", "7d", "hot"], feedData(42));
    qc.setQueryData(["opp-feed", null, "24h", "all-other"], feedData(99)); // no market 42
    const touched = applyMarketStateRow(qc, stateRow(42));
    expect(touched).toBe(2);
  });

  it("patches the solo market-row cache", () => {
    qc.setQueryData(["market-row", 42], { row: { onchain_id: 42, yes_price_usd: 0.5 } });
    applyMarketStateRow(qc, stateRow(42));
    expect(
      (qc.getQueryData(["market-row", 42]) as { row: { yes_price_usd: number } }).row.yes_price_usd,
    ).toBe(0.73);
  });

  it("keeps market-change prices live without that query's poll", () => {
    qc.setQueryData(["market-change", 42], { yesPrice: 0.5, noPrice: 0.5, flows: {}, tape: [] });
    applyMarketStateRow(qc, stateRow(42));
    const c = qc.getQueryData(["market-change", 42]) as { yesPrice: number; noPrice: number };
    expect(c.yesPrice).toBe(0.73);
    expect(c.noPrice).toBe(0.27);
  });

  it("does nothing when the market is not in any cache", () => {
    expect(applyMarketStateRow(qc, stateRow(7))).toBe(0);
  });
});

describe("applyMarketStateBatch — deterministic ordering", () => {
  it("collapses a burst to the newest version per market", () => {
    qc.setQueryData(["opp-feed", null, "24h", "all"], feedData(42));
    const last = new Map<number, number>();
    applyMarketStateBatch(
      qc,
      [
        stateRow(42, { read_model_version: 1, yes_price_usd: 0.6 }),
        stateRow(42, { read_model_version: 3, yes_price_usd: 0.9 }),
        stateRow(42, { read_model_version: 2, yes_price_usd: 0.7 }),
      ],
      last,
    );
    const row = (
      qc.getQueryData(["opp-feed", null, "24h", "all"]) as {
        rows: Record<number, Record<string, unknown>>;
      }
    ).rows[42];
    expect(row.yes_price_usd).toBe(0.9); // highest version wins
    expect(last.get(42)).toBe(3);
  });

  it("ignores a row not newer than the high-water mark (late/duplicate)", () => {
    qc.setQueryData(["opp-feed", null, "24h", "all"], feedData(42));
    const last = new Map<number, number>([[42, 5]]);
    const touched = applyMarketStateBatch(
      qc,
      [stateRow(42, { read_model_version: 4, yes_price_usd: 0.1 })],
      last,
    );
    expect(touched).toBe(0);
    const row = (
      qc.getQueryData(["opp-feed", null, "24h", "all"]) as {
        rows: Record<number, Record<string, unknown>>;
      }
    ).rows[42];
    expect(row.yes_price_usd).toBe(0.5); // unchanged
  });
});

describe("affectedPulseKeys", () => {
  it("selects only pulse caches that hold a traded market (both key shapes)", () => {
    qc.setQueryData(["insider", "pulse", "12,45,88"], { pulses: {} }); // feed id-list
    qc.setQueryData(["insider", "pulse", "42"], { pulses: {} }); // single market
    qc.setQueryData(["insider", "pulse", "7,9"], { pulses: {} }); // unrelated
    const keys = affectedPulseKeys(qc, new Set([42, 88]));
    const specs = keys.map((k) => k[2]).sort();
    expect(specs).toEqual(["12,45,88", "42"]);
  });

  it("returns nothing when no cache intersects (or the set is empty)", () => {
    qc.setQueryData(["insider", "pulse", "7,9"], { pulses: {} });
    expect(affectedPulseKeys(qc, new Set([1, 2]))).toEqual([]);
    expect(affectedPulseKeys(qc, new Set())).toEqual([]);
  });
});

describe("affectedInsiderActivityKeys", () => {
  it("selects only the traded market's own rails, never another market's", () => {
    qc.setQueryData(["insider", 42, "activity", null, 200], { rows: [] });
    qc.setQueryData(["insider", 7, "activity", "0xabc", 200], { rows: [] });
    qc.setQueryData(["insider", "now", null, null, null, 120], { rows: [] });
    const keys = affectedInsiderActivityKeys(qc, new Set([42]));
    expect(keys).toEqual([["insider", 42, "activity", null, 200]]);
  });

  it("returns nothing when the traded market has no open rail", () => {
    qc.setQueryData(["insider", 7, "activity", null, 200], { rows: [] });
    expect(affectedInsiderActivityKeys(qc, new Set([42]))).toEqual([]);
    expect(affectedInsiderActivityKeys(qc, new Set())).toEqual([]);
  });
});

describe("viewerPositionKeys", () => {
  it("returns the viewer position families, lowercased, with no tape family", () => {
    expect(viewerPositionKeys("0xABC")).toEqual([
      ["my-convictions", "0xabc"],
      ["position-summary", "0xabc"],
    ]);
  });
});

describe("versionOf", () => {
  it("treats a missing version as 0 (always applies)", () => {
    expect(versionOf({ onchain_id: 1 })).toBe(0);
    expect(versionOf({ onchain_id: 1, read_model_version: "8" })).toBe(8);
  });
});

describe("affectedMarketKeys", () => {
  // The two per-market reads that used to poll to discover a trade the socket
  // had already delivered. See lib/market-queries.ts.
  it("returns the change and evidence keys for markets that traded", () => {
    const qc = new QueryClient();
    qc.setQueryData(["market-change", 42], { yesPrice: 0.5 });
    qc.setQueryData(["evidence", 42], { believers: [] });
    qc.setQueryData(["market-change", 99], { yesPrice: 0.7 });
    const keys = affectedMarketKeys(qc, new Set([42]));
    expect(keys).toContainEqual(["market-change", 42]);
    expect(keys).toContainEqual(["evidence", 42]);
    // A market nobody traded is never refetched, however deep the cache is.
    expect(keys).not.toContainEqual(["market-change", 99]);
  });

  it("costs nothing for a market that is not cached", () => {
    const qc = new QueryClient();
    qc.setQueryData(["market-change", 42], { yesPrice: 0.5 });
    // The busiest market on the platform trades ~3 times an hour; the other
    // 2,700 do not trade at all. Invalidating what is not held would put those
    // back on the fetch path the poll removal took them off.
    expect(affectedMarketKeys(qc, new Set([7]))).toEqual([]);
    expect(affectedMarketKeys(qc, new Set())).toEqual([]);
  });
});

describe("affectedViewerValuationKeys", () => {
  // usePositionStream covers the viewer trading. This covers everyone else
  // trading a market the viewer holds — the other half of what their shares are
  // worth, and the only thing the 30s/20s portfolio polls were watching for.
  it("matches a position summary by the market id in its key", () => {
    const qc = new QueryClient();
    qc.setQueryData(["position-summary", "0xab", 42], { yesShares: 3 });
    qc.setQueryData(["position-summary", "0xab", 99], { yesShares: 1 });
    const keys = affectedViewerValuationKeys(qc, new Set([42]));
    expect(keys).toEqual([["position-summary", "0xab", 42]]);
  });

  it("matches a portfolio by the markets inside its data", () => {
    const qc = new QueryClient();
    // The window is in the key; the holdings are only in the payload, so this
    // is the one place the viewer's actual positions can be read from.
    qc.setQueryData(["my-convictions", "0xab", "24h"], {
      wallet: "0xab",
      positions: [{ onchain_id: 42 }, { onchain_id: 7 }],
    });
    expect(affectedViewerValuationKeys(qc, new Set([7]))).toEqual([
      ["my-convictions", "0xab", "24h"],
    ]);
  });

  it("refetches nothing for a reader who holds none of the traded markets", () => {
    const qc = new QueryClient();
    qc.setQueryData(["position-summary", "0xab", 42], { yesShares: 3 });
    qc.setQueryData(["my-convictions", "0xab", "24h"], { positions: [{ onchain_id: 42 }] });
    expect(affectedViewerValuationKeys(qc, new Set([1234]))).toEqual([]);
    expect(affectedViewerValuationKeys(qc, new Set())).toEqual([]);
  });

  it("survives a portfolio that has not loaded, or loaded empty", () => {
    const qc = new QueryClient();
    qc.setQueryData(["my-convictions", "0xab", "24h"], undefined);
    qc.setQueryData(["my-convictions", "0xcd", "7d"], { positions: [] });
    expect(affectedViewerValuationKeys(qc, new Set([42]))).toEqual([]);
  });
});
