import { describe, it, expect, vi } from "vitest";
import {
  uniqueBlockNumbers,
  fetchBlockTimes,
  occurredAtFor,
  isRecentByEventTime,
  canonicalCompare,
  recencyCompare,
  tradeRowWithOccurredAt,
} from "./block-time";

const BLOCK_100 = 1_700_000_000; // seconds
const iso = (secs: number) => new Date(secs * 1000).toISOString();

describe("block-time assignment — one lookup per block", () => {
  it("several logs from the same block cause ONE fetch and share occurred_at", async () => {
    const trades = [
      { tx_hash: "0xa", log_index: 0, block_number: 100 },
      { tx_hash: "0xa", log_index: 1, block_number: 100 },
      { tx_hash: "0xb", log_index: 0, block_number: 100 },
      { tx_hash: "0xc", log_index: 0, block_number: 101 },
    ];
    const getTs = vi.fn(async (b: number) => BLOCK_100 + (b - 100) * 2);
    const times = await fetchBlockTimes(uniqueBlockNumbers(trades), getTs, 5);

    expect(getTs).toHaveBeenCalledTimes(2); // block 100 and 101 only — not 4
    const rows = trades.map((t) => tradeRowWithOccurredAt(t, times));
    expect(rows[0].occurred_at).toBe(iso(BLOCK_100));
    expect(rows[1].occurred_at).toBe(iso(BLOCK_100));
    expect(rows[2].occurred_at).toBe(iso(BLOCK_100));
    expect(rows[3].occurred_at).toBe(iso(BLOCK_100 + 2));
  });

  it("respects bounded concurrency without dropping any block", async () => {
    const blocks = Array.from({ length: 20 }, (_, i) => 100 + i);
    let inFlight = 0;
    let peak = 0;
    const getTs = vi.fn(async (b: number) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return BLOCK_100 + b;
    });
    const times = await fetchBlockTimes(blocks, getTs, 4);
    expect(times.size).toBe(20);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe("historical event correctness", () => {
  it("a trade from an old block stays old even when the map is built today", () => {
    const oldSecs = Math.floor(Date.parse("2024-01-01T00:00:00Z") / 1000);
    const times = new Map([[100, iso(oldSecs)]]);
    const row = tradeRowWithOccurredAt({ tx_hash: "0x", log_index: 0, block_number: 100 }, times);
    expect(row.occurred_at).toBe(iso(oldSecs));
    // ...and it is NOT recent, no matter that we processed it now.
    expect(isRecentByEventTime(row.occurred_at, Date.now(), 3_600_000)).toBe(false);
  });
});

describe("recent windows use event time, never ingestion time", () => {
  const now = Date.parse("2026-07-01T00:00:00Z");
  it("a historical trade imported now counts toward NO recent window", () => {
    const old = new Date(now - 200 * 86_400_000).toISOString();
    expect(isRecentByEventTime(old, now, 5 * 60_000)).toBe(false); // last 5m
    expect(isRecentByEventTime(old, now, 3_600_000)).toBe(false); // last hour
  });
  it("a genuinely fresh event is recent", () => {
    const fresh = new Date(now - 60_000).toISOString();
    expect(isRecentByEventTime(fresh, now, 5 * 60_000)).toBe(true);
  });
  it("a null / unknown occurred_at is never recent", () => {
    expect(isRecentByEventTime(null, now, 3_600_000)).toBe(false);
    expect(isRecentByEventTime(undefined, now, 3_600_000)).toBe(false);
  });
});

describe("backfill idempotency", () => {
  it("running the block-time fetch twice yields the same map and the same rows", async () => {
    const trades = [
      { tx_hash: "0xa", log_index: 0, block_number: 500 },
      { tx_hash: "0xb", log_index: 0, block_number: 500 },
    ];
    const getTs = async (b: number) => BLOCK_100 + b;
    const first = await fetchBlockTimes(uniqueBlockNumbers(trades), getTs);
    const second = await fetchBlockTimes(uniqueBlockNumbers(trades), getTs);
    expect([...second]).toEqual([...first]);
    const r1 = trades.map((t) => tradeRowWithOccurredAt(t, first));
    const r2 = trades.map((t) => tradeRowWithOccurredAt(t, second));
    expect(r2).toEqual(r1);
  });
});

describe("reorg overlap — replay is idempotent and never touches ingested_at", () => {
  it("the upsert payload sets a deterministic occurred_at and omits ingested_at", () => {
    const times = new Map([[100, iso(BLOCK_100)]]);
    const canonical = { tx_hash: "0xa", log_index: 0, block_number: 100, side: "YES" as const };
    const a = tradeRowWithOccurredAt(canonical, times);
    const b = tradeRowWithOccurredAt(canonical, times); // replay
    expect(a).toEqual(b); // identical → no spurious change
    expect(a.occurred_at).toBe(iso(BLOCK_100));
    expect("ingested_at" in a).toBe(false); // never in the payload → preserved on conflict
  });
});

describe("ordering", () => {
  it("canonical order is block ASC then log ASC", () => {
    const rows = [
      { tx_hash: "x", log_index: 2, block_number: 10 },
      { tx_hash: "x", log_index: 0, block_number: 10 },
      { tx_hash: "x", log_index: 0, block_number: 9 },
    ];
    expect(
      rows
        .slice()
        .sort(canonicalCompare)
        .map((r) => `${r.block_number}:${r.log_index}`),
    ).toEqual(["9:0", "10:0", "10:2"]);
  });
  it("recency order is occurred DESC with null last and block/log tie-breaks", () => {
    const rows = [
      { tx_hash: "x", log_index: 0, block_number: 10, occurred_at: null },
      { tx_hash: "x", log_index: 1, block_number: 20, occurred_at: iso(BLOCK_100) },
      { tx_hash: "x", log_index: 0, block_number: 20, occurred_at: iso(BLOCK_100) },
      { tx_hash: "x", log_index: 0, block_number: 21, occurred_at: iso(BLOCK_100 + 5) },
    ];
    expect(
      rows
        .slice()
        .sort(recencyCompare)
        .map((r) => `${r.block_number}:${r.log_index}`),
    ).toEqual([
      "21:0", // newest occurred
      "20:1", // same occurred → higher log first
      "20:0",
      "10:0", // null occurred → last
    ]);
  });
});

describe("occurredAtFor", () => {
  it("returns null for a block we haven't fetched (→ backfill later)", () => {
    expect(occurredAtFor(999, new Map())).toBeNull();
  });
});
