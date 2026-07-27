import { describe, it, expect } from "vitest";
import { applyTrade, emptyRow, reduce, type Trade } from "@/domain/domain";
import {
  compareChainOrder,
  isAfterCursor,
  dispositionFor,
  foldEvents,
  refold,
  reducerStateHash,
  toTrade,
  NULL_CURSOR,
  type TradeEventForApply,
  type PositionCursor,
} from "./position-core";

const ev = (over: Partial<TradeEventForApply> = {}): TradeEventForApply => ({
  event_id: "00000000-0000-0000-0000-000000000001",
  source_key: "chain:8453:0xabc:0",
  wallet: "0xwallet",
  market_id: "42",
  side: "YES",
  action: "BUY",
  amount_eth: "1000000000000000000", // 1.0
  shares: "2000000000000000000", // 2.0
  occurred_at: "2026-01-01T00:00:00.000Z",
  block_number: 100,
  log_index: 0,
  ...over,
});

const cursorOf = (e: TradeEventForApply): PositionCursor => ({
  event_id: e.event_id,
  source_key: e.source_key,
  block_number: e.block_number,
  log_index: e.log_index,
});

// A realistic multi-trade history for one pair.
const history = (n: number): TradeEventForApply[] =>
  Array.from({ length: n }, (_, i) =>
    ev({
      event_id: `id-${i}`,
      source_key: `chain:8453:0xtx${i}:${i % 3}`,
      side: i % 4 === 3 ? "NO" : "YES",
      action: i % 5 === 4 ? "SELL" : "BUY",
      amount_eth: String((i + 1) * 1e17),
      shares: String((i + 2) * 1e17),
      block_number: 100 + i,
      log_index: i % 3,
      occurred_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }),
  );

describe("canonical ordering", () => {
  it("orders by block then log_index", () => {
    const rows = [
      { block_number: 10, log_index: 2 },
      { block_number: 9, log_index: 5 },
      { block_number: 10, log_index: 0 },
    ];
    expect(rows.slice().sort(compareChainOrder)).toEqual([
      { block_number: 9, log_index: 5 },
      { block_number: 10, log_index: 0 },
      { block_number: 10, log_index: 2 },
    ]);
  });
  it("isAfterCursor: null cursor is always after; strict chain order otherwise", () => {
    expect(isAfterCursor({ block_number: 1, log_index: 0 }, NULL_CURSOR)).toBe(true);
    const c = cursorOf(ev({ block_number: 100, log_index: 2 }));
    expect(isAfterCursor({ block_number: 100, log_index: 3 }, c)).toBe(true);
    expect(isAfterCursor({ block_number: 101, log_index: 0 }, c)).toBe(true);
    expect(isAfterCursor({ block_number: 100, log_index: 2 }, c)).toBe(false);
    expect(isAfterCursor({ block_number: 100, log_index: 1 }, c)).toBe(false);
    expect(isAfterCursor({ block_number: 99, log_index: 9 }, c)).toBe(false);
  });
});

describe("disposition", () => {
  it("apply_incrementally when strictly after a clean cursor", () => {
    const c = cursorOf(ev({ block_number: 100, log_index: 0 }));
    expect(dispositionFor(ev({ block_number: 100, log_index: 1 }), c, false)).toBe(
      "apply_incrementally",
    );
  });
  it("replay when the event IS the cursor event (overlap re-delivery)", () => {
    const last = ev({ block_number: 100, log_index: 0, source_key: "chain:8453:0xsame:0" });
    expect(dispositionFor(last, cursorOf(last), false)).toBe("replay");
  });
  it("rebuild_required when the event lands strictly before the cursor (late/out-of-order)", () => {
    const c = cursorOf(
      ev({ block_number: 200, log_index: 0, source_key: "chain:8453:0xcursor:0" }),
    );
    expect(
      dispositionFor(
        ev({ block_number: 150, log_index: 0, source_key: "chain:8453:0xlate:0" }),
        c,
        false,
      ),
    ).toBe("rebuild_required");
  });
  it("rebuild_required when the pair is already dirty, regardless of order", () => {
    expect(dispositionFor(ev({ block_number: 999, log_index: 0 }), NULL_CURSOR, true)).toBe(
      "rebuild_required",
    );
  });
  it("invalid when required trade data is missing", () => {
    expect(dispositionFor(ev({ source_key: "" }), NULL_CURSOR, false)).toBe("invalid");
    expect(dispositionFor(ev({ side: "MAYBE" as unknown as "YES" }), NULL_CURSOR, false)).toBe(
      "invalid",
    );
  });
});

describe("incremental application == full canonical refold (parity)", () => {
  it("first event creates the same state as a one-event refold", () => {
    const e = ev();
    const inc = foldEvents(emptyRow(), [e]);
    const full = refold([e]);
    expect(inc.appliedCount).toBe(1);
    expect(reducerStateHash(inc.row, inc.cursor.source_key)).toBe(
      reducerStateHash(full.row, full.cursor.source_key),
    );
  });

  it("applying the newest event onto current state == refolding all events", () => {
    const events = history(50);
    const prior = events.slice(0, 49);
    const last = events[49];
    // Current state from the first 49 (as if already applied incrementally).
    const current = refold(prior);
    // Incremental: apply only the last event.
    const inc = foldEvents(current.row, [last]);
    // Full refold of all 50.
    const full = refold(events);
    expect(inc.appliedCount).toBe(1); // ONLY the new event
    expect(reducerStateHash(inc.row, inc.cursor.source_key)).toBe(
      reducerStateHash(full.row, last.source_key),
    );
    expect(inc.row.yes_shares).toBeCloseTo(full.row.yes_shares, 9);
    expect(inc.row.no_shares).toBeCloseTo(full.row.no_shares, 9);
    expect(inc.row.yes_cost).toBeCloseTo(full.row.yes_cost, 9);
    expect(inc.row.no_cost).toBeCloseTo(full.row.no_cost, 9);
  });

  it("a batch of several new events for one pair reduces in order, one commit", () => {
    const events = history(20);
    const current = refold(events.slice(0, 15));
    const batch = events.slice(15); // 5 new events out of order in the array
    const inc = foldEvents(current.row, batch.slice().reverse()); // unsorted input
    const full = refold(events);
    expect(inc.appliedCount).toBe(5);
    expect(reducerStateHash(inc.row, inc.cursor.source_key)).toBe(
      reducerStateHash(full.row, events[events.length - 1].source_key),
    );
    // Cursor advanced to the last canonical event.
    expect(inc.cursor.block_number).toBe(events[events.length - 1].block_number);
    expect(inc.cursor.log_index).toBe(events[events.length - 1].log_index);
  });
});

describe("business semantics preserved (delegates to domain reducer)", () => {
  const t = (o: Partial<Trade>): TradeEventForApply =>
    ev({
      side: (o.side as "YES" | "NO") ?? "YES",
      action: (o.direction as "BUY" | "SELL") ?? "BUY",
      shares: String((o.token_amount ?? 1) * 1e18),
      amount_eth: String((o.eth_amount ?? 1) * 1e18),
    });

  it("side flip changes expressed_side and directional_since like the reducer", () => {
    const buyYes = ev({ side: "YES", action: "BUY", shares: String(5e18), block_number: 1 });
    const buyNo = ev({ side: "NO", action: "BUY", shares: String(9e18), block_number: 2 });
    const inc = refold([buyYes, buyNo]);
    const manual = [buyYes, buyNo].map(toTrade).reduce(applyTrade, emptyRow());
    expect(inc.row.expressed_side).toBe(manual.expressed_side);
    expect(TSOf(inc.row.directional_since)).toBe(TSOf(manual.directional_since));
  });

  it("same-side add preserves directional_since", () => {
    const a = ev({ side: "YES", action: "BUY", shares: String(5e18), block_number: 1 });
    const b = ev({ side: "YES", action: "BUY", shares: String(3e18), block_number: 2 });
    const inc = refold([a, b]);
    expect(inc.row.directional_since?.toISOString()).toBe(a.occurred_at);
  });

  it("complete exit zeroes shares and cost", () => {
    const buy = ev({ side: "YES", action: "BUY", shares: String(4e18), amount_eth: String(2e18) });
    const sell = ev({
      side: "YES",
      action: "SELL",
      shares: String(4e18),
      block_number: 101,
      log_index: 0,
    });
    const inc = refold([buy, sell]);
    expect(inc.row.yes_shares).toBe(0);
    expect(inc.row.yes_cost).toBe(0);
  });
  void t;
});

describe("replay is a no-op on state", () => {
  it("re-applying nothing (event filtered as replay) leaves the hash unchanged", () => {
    const events = history(10);
    const current = refold(events);
    const before = reducerStateHash(current.row, current.cursor.source_key);
    // A replay contributes zero applied events → identical state + hash.
    const inc = foldEvents(current.row, []);
    expect(inc.appliedCount).toBe(0);
    expect(reducerStateHash(inc.row, current.cursor.source_key)).toBe(before);
  });
});

describe("state hash", () => {
  it("is deterministic and ignores float noise", () => {
    const r1 = emptyRow();
    const r2 = { ...emptyRow(), yes_shares: 1e-12 }; // noise below epsilon
    expect(reducerStateHash(r1, null)).toBe(reducerStateHash(r2, null));
  });
  it("changes when reducer-owned state changes", () => {
    const base = reducerStateHash(emptyRow(), null);
    const moved = reducerStateHash({ ...emptyRow(), yes_shares: 5 }, null);
    expect(base).not.toBe(moved);
  });
  it("incorporates the last-applied identity", () => {
    const r = emptyRow();
    expect(reducerStateHash(r, "a")).not.toBe(reducerStateHash(r, "b"));
  });
});

describe("performance: normal path applies ONE event, not the whole history", () => {
  it("1000-trade history + 1 new event ⇒ appliedCount === 1, state identical to full refold", () => {
    const events = history(1001);
    const priorState = refold(events.slice(0, 1000)); // current position (already applied)
    const newest = events[1000];
    const inc = foldEvents(priorState.row, [newest]); // the hot path
    const full = refold(events); // the OLD path (1001 folds)
    expect(inc.appliedCount).toBe(1); // did NOT re-fold 1000 events
    expect(reducerStateHash(inc.row, inc.cursor.source_key)).toBe(
      reducerStateHash(full.row, newest.source_key),
    );
  });
});

describe("two events in one block preserve log_index order", () => {
  it("applies same-block events by log_index, not input order", () => {
    const a = ev({
      source_key: "k-a",
      block_number: 500,
      log_index: 0,
      side: "YES",
      action: "BUY",
      shares: String(3e18),
    });
    const b = ev({
      source_key: "k-b",
      block_number: 500,
      log_index: 1,
      side: "YES",
      action: "SELL",
      shares: String(3e18),
    });
    // Input order reversed; canonical order (log 0 buy, then log 1 sell) must win.
    const inc = foldEvents(emptyRow(), [b, a]);
    expect(inc.appliedCount).toBe(2);
    expect(inc.row.yes_shares).toBe(0); // buy 3 then sell 3 → 0
    expect(inc.cursor.log_index).toBe(1); // cursor is the last (log 1)
  });
});

describe("reorg: rebuild from remaining canonical events excludes the orphan", () => {
  it("a rebuilt state that drops one event differs and matches a refold without it", () => {
    const all = history(12);
    const orphaned = all[6];
    const remaining = all.filter((e) => e.source_key !== orphaned.source_key);
    const withOrphan = refold(all);
    const withoutOrphan = refold(remaining); // the rebuild result
    expect(reducerStateHash(withOrphan.row, withOrphan.cursor.source_key)).not.toBe(
      reducerStateHash(withoutOrphan.row, withoutOrphan.cursor.source_key),
    );
    // Rebuild is idempotent: refolding the remaining set twice is identical.
    const again = refold(remaining);
    expect(reducerStateHash(withoutOrphan.row, withoutOrphan.cursor.source_key)).toBe(
      reducerStateHash(again.row, again.cursor.source_key),
    );
  });
});

describe("shadow parity across representative scenarios", () => {
  const scenario = (events: TradeEventForApply[]) => {
    const prior = refold(events.slice(0, -1));
    const inc = foldEvents(prior.row, [events[events.length - 1]]);
    const full = refold(events);
    return { inc, full, lastKey: events[events.length - 1].source_key };
  };
  const cases: Record<string, TradeEventForApply[]> = {
    buys: [
      ev({ source_key: "s1", block_number: 1, side: "YES", action: "BUY", shares: String(2e18) }),
      ev({ source_key: "s2", block_number: 2, side: "YES", action: "BUY", shares: String(3e18) }),
    ],
    partial_sell: [
      ev({
        source_key: "s1",
        block_number: 1,
        side: "YES",
        action: "BUY",
        shares: String(5e18),
        amount_eth: String(5e18),
      }),
      ev({ source_key: "s2", block_number: 2, side: "YES", action: "SELL", shares: String(2e18) }),
    ],
    complete_exit: [
      ev({ source_key: "s1", block_number: 1, side: "NO", action: "BUY", shares: String(4e18) }),
      ev({ source_key: "s2", block_number: 2, side: "NO", action: "SELL", shares: String(4e18) }),
    ],
    side_flip: [
      ev({ source_key: "s1", block_number: 1, side: "YES", action: "BUY", shares: String(5e18) }),
      ev({ source_key: "s2", block_number: 2, side: "NO", action: "BUY", shares: String(9e18) }),
    ],
    mixed: [
      ev({ source_key: "s1", block_number: 1, side: "YES", action: "BUY", shares: String(5e18) }),
      ev({ source_key: "s2", block_number: 2, side: "NO", action: "BUY", shares: String(5e18) }),
    ],
    two_in_block: [
      ev({
        source_key: "s1",
        block_number: 1,
        log_index: 0,
        side: "YES",
        action: "BUY",
        shares: String(3e18),
      }),
      ev({
        source_key: "s2",
        block_number: 1,
        log_index: 1,
        side: "YES",
        action: "BUY",
        shares: String(2e18),
      }),
    ],
  };
  for (const [name, events] of Object.entries(cases)) {
    it(`incremental == full refold: ${name}`, () => {
      const { inc, full, lastKey } = scenario(events);
      expect(reducerStateHash(inc.row, inc.cursor.source_key)).toBe(
        reducerStateHash(full.row, lastKey),
      );
    });
  }
});

function TSOf(d: Date | null): string {
  return d ? d.toISOString() : "∅";
}
void reduce;
