import { describe, it, expect } from "vitest";
import {
  chainTradeSourceKey,
  marketCreatedSourceKey,
  normalizeHash,
  tradeEventFromCanonical,
  dedupeBySourceKey,
  eventCanonicalCompare,
  eventRecencyCompare,
  toLegacyFeedEventRow,
  orphanedSourceKeys,
  EVENT_READ_COLUMNS,
  type CanonicalTradeLike,
  type EventFact,
} from "./events";

const trade = (over: Partial<CanonicalTradeLike> = {}): CanonicalTradeLike => ({
  tx_hash: "0xABCDEF",
  log_index: 3,
  block_number: 100,
  block_hash: "0xblock",
  onchain_id: "42",
  wallet: "0xWALLET",
  side: "YES",
  direction: "BUY",
  token_amount: "1000000000000000000",
  eth_amount: "500000000000000000",
  price: "700000000000000000",
  raw_log: { a: 1 },
  ...over,
});

describe("deterministic source keys", () => {
  it("chain key normalizes hash casing and is stable", () => {
    expect(chainTradeSourceKey(8453, "0xAbC", 5)).toBe("chain:8453:0xabc:5");
    expect(chainTradeSourceKey(8453, "0xABC", 5)).toBe(chainTradeSourceKey(8453, "0xabc", 5));
  });
  it("market-created keys are deterministic", () => {
    expect(marketCreatedSourceKey(42)).toBe("pov:market:42:created");
    expect(marketCreatedSourceKey("42")).toBe("pov:market:42:created");
  });
  it("normalizeHash lowercases and trims", () => {
    expect(normalizeHash("  0xAbCd  ")).toBe("0xabcd");
  });
});

describe("one trade → one event, deterministically", () => {
  it("builds a single canonical event with the deterministic identity", () => {
    const ev = tradeEventFromCanonical(trade(), 8453, "2026-01-01T00:00:00.000Z");
    expect(ev.source).toBe("chain");
    expect(ev.kind).toBe("trade");
    expect(ev.source_key).toBe("chain:8453:0xabcdef:3");
    expect(ev.market_id).toBe("42");
    expect(ev.wallet).toBe("0xwallet");
    expect(ev.action).toBe("BUY");
    expect(ev.side).toBe("YES");
    // Raw wei preserved as strings (precision-safe) to mirror the trades projection.
    expect(ev.amount_eth).toBe("500000000000000000");
    expect(ev.shares).toBe("1000000000000000000");
    expect(ev.occurred_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("replaying the same log yields the same identity (idempotent)", () => {
    const a = tradeEventFromCanonical(trade(), 8453, "2026-01-01T00:00:00.000Z");
    // Same log, later ingestion pass, even a different observed occurred_at input:
    const b = tradeEventFromCanonical(trade(), 8453, "2026-01-01T00:00:00.000Z");
    expect(a.source_key).toBe(b.source_key);
  });

  it("dedupeBySourceKey collapses a doubly-scanned overlap to one event", () => {
    const e = tradeEventFromCanonical(trade(), 8453, "2026-01-01T00:00:00.000Z");
    const scannedTwice = [e, { ...e }]; // reorg overlap re-emits the identical log
    expect(dedupeBySourceKey(scannedTwice)).toHaveLength(1);
  });

  it("distinct logs in the same tx get distinct identities", () => {
    const a = tradeEventFromCanonical(trade({ log_index: 0 }), 8453, "t");
    const b = tradeEventFromCanonical(trade({ log_index: 1 }), 8453, "t");
    expect(a.source_key).not.toBe(b.source_key);
    expect(dedupeBySourceKey([a, b])).toHaveLength(2);
  });
});

describe("ordering", () => {
  const mk = (block: number | null, log: number | null, occurred: string, key: string) => ({
    block_number: block,
    log_index: log,
    occurred_at: occurred,
    source_key: key,
  });

  it("canonical order is block ASC then log ASC", () => {
    const rows = [mk(10, 2, "t", "b"), mk(9, 0, "t", "a"), mk(10, 0, "t", "c")];
    expect(
      rows
        .slice()
        .sort(eventCanonicalCompare)
        .map((r) => r.source_key),
    ).toEqual(["a", "c", "b"]);
  });

  it("recency order is occurred DESC then block DESC then log DESC", () => {
    const rows = [
      mk(10, 0, "2026-01-01T00:00:00Z", "old"),
      mk(20, 1, "2026-01-02T00:00:00Z", "new-b"),
      mk(20, 5, "2026-01-02T00:00:00Z", "new-a"),
    ];
    expect(
      rows
        .slice()
        .sort(eventRecencyCompare)
        .map((r) => r.source_key),
    ).toEqual(["new-a", "new-b", "old"]);
  });

  it("events sharing a timestamp with no block keep a stable source_key tie-break", () => {
    const rows = [
      mk(null, null, "2026-01-01T00:00:00Z", "pov:market:2:created"),
      mk(null, null, "2026-01-01T00:00:00Z", "pov:market:1:created"),
    ];
    const once = rows
      .slice()
      .sort(eventRecencyCompare)
      .map((r) => r.source_key);
    const twice = rows
      .slice()
      .reverse()
      .sort(eventRecencyCompare)
      .map((r) => r.source_key);
    expect(once).toEqual(twice); // deterministic regardless of input order
  });
});

describe("legacy feed-row adapter", () => {
  const fact = (over: Partial<EventFact> = {}): EventFact => ({
    source_key: "chain:8453:0xabc:1",
    source: "chain",
    kind: "trade",
    market_id: "42",
    wallet: "0xwallet",
    side: "YES",
    action: "BUY",
    amount_eth: "500000000000000000",
    shares: "1000000000000000000",
    price: null,
    chain_id: 8453,
    block_number: 100,
    log_index: 1,
    occurred_at: "2026-01-01T00:00:00Z",
    payload: {},
    ...over,
  });

  it("maps BUY→backed and SELL→reduced with wei in payload", () => {
    const backed = toLegacyFeedEventRow(fact());
    expect(backed.type).toBe("backed");
    expect(backed.onchain_id).toBe(42);
    expect(backed.event_key).toBe("chain:8453:0xabc:1");
    expect(backed.payload).toEqual({
      eth: "500000000000000000",
      tokens: "1000000000000000000",
    });
    expect(toLegacyFeedEventRow(fact({ action: "SELL" })).type).toBe("reduced");
  });

  it("maps a market_created event to a market_created row", () => {
    const row = toLegacyFeedEventRow(fact({ kind: "market_created", action: null, side: null }));
    expect(row.type).toBe("market_created");
  });
});

describe("reorg orphan detection", () => {
  it("orphans stored keys that the canonical rescan no longer returns", () => {
    const stored = ["chain:8453:0xa:0", "chain:8453:0xb:0", "chain:8453:0xc:0"];
    const canonicalNow = ["chain:8453:0xa:0", "chain:8453:0xc:0"];
    expect(orphanedSourceKeys(stored, canonicalNow)).toEqual(["chain:8453:0xb:0"]);
  });
  it("returns nothing when the rescan matches storage (no spurious orphans)", () => {
    const keys = ["chain:8453:0xa:0", "chain:8453:0xb:0"];
    expect(orphanedSourceKeys(keys, keys)).toEqual([]);
  });
});

describe("timestamp preservation (replay safety)", () => {
  it("the trade event payload never carries ingested_at, so a replay can't reset it", () => {
    const ev = tradeEventFromCanonical(trade(), 8453, "2026-01-01T00:00:00.000Z");
    // The poller/backfill never send ingested_at; the DB defaults it on insert
    // and leaves it untouched on conflict. occurred_at is the only time we set.
    expect("ingested_at" in ev).toBe(false);
    expect(ev.occurred_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("historical backfill idempotency", () => {
  it("projecting the same trades twice yields the same identities (a rerun is a no-op)", () => {
    const trades = [trade({ log_index: 0 }), trade({ log_index: 1 }), trade({ log_index: 2 })];
    const run1 = trades.map((t) => tradeEventFromCanonical(t, 8453, "t"));
    const run2 = trades.map((t) => tradeEventFromCanonical(t, 8453, "t"));
    const keys1 = new Set(run1.map((e) => e.source_key));
    const keys2 = new Set(run2.map((e) => e.source_key));
    expect([...keys1].sort()).toEqual([...keys2].sort());
    // Merging both runs and deduping collapses to the original count.
    expect(dedupeBySourceKey([...run1, ...run2])).toHaveLength(3);
  });
});

describe("market creation emits exactly one event", () => {
  it("repeated POV polls of the same market resolve to one identity", () => {
    const polls = [
      { source_key: marketCreatedSourceKey(7) },
      { source_key: marketCreatedSourceKey(7) },
      { source_key: marketCreatedSourceKey(7) },
    ];
    expect(dedupeBySourceKey(polls)).toHaveLength(1);
    expect(polls[0].source_key).toBe("pov:market:7:created");
  });
});

describe("Phase 2.5 — projection provenance format", () => {
  it("the trade event source_key matches the trades.event_source_key SQL backfill", () => {
    // Migration 20260730000000 backfills:
    //   'chain:8453:' || lower(tx_hash) || ':' || log_index
    const ev = tradeEventFromCanonical(trade({ tx_hash: "0xDeAd", log_index: 4 }), 8453, "t");
    expect(ev.source_key).toBe("chain:8453:0xdead:4");
    const sqlForm = `chain:8453:${"0xDeAd".toLowerCase()}:${4}`;
    expect(ev.source_key).toBe(sqlForm); // 1:1 event ↔ projection provenance
  });
});

describe("Phase 2.5 — canonical reads never fall back to ingestion time", () => {
  it("the event read column set excludes ingested_at and created_at", () => {
    expect(EVENT_READ_COLUMNS).not.toContain("ingested_at");
    expect(EVENT_READ_COLUMNS).not.toContain("created_at");
    // recency is driven by occurred_at, which must be present.
    expect(EVENT_READ_COLUMNS).toContain("occurred_at");
  });
  it("does not expose the raw payload column to clients", () => {
    expect(EVENT_READ_COLUMNS).not.toContain("payload");
  });
});
