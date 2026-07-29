import { describe, it, expect } from "vitest";
import { groupLiveRows, liveRowText, type LiveEventInput } from "./live-tape";

const ev = (o: Partial<LiveEventInput> = {}): LiveEventInput => ({
  source_key: Math.random().toString(36),
  kind: "trade",
  market_id: "42",
  market_title: "AI replaces programmers",
  occurred_at: "2026-02-01T12:00:00.000Z",
  block_number: 100,
  log_index: 0,
  side: "YES",
  action: "BUY",
  amount_eth: 0.1,
  wallet: "0xa",
  payload: null,
  ...o,
});

const minutesBefore = (iso: string, m: number) =>
  new Date(new Date(iso).getTime() - m * 60_000).toISOString();

describe("trade burst grouping", () => {
  it("groups consecutive same-market/side/action trades within the window", () => {
    const t = "2026-02-01T12:00:00.000Z";
    const rows = groupLiveRows(
      [
        ev({ wallet: "0xa", occurred_at: t }),
        ev({ wallet: "0xb", occurred_at: minutesBefore(t, 2) }),
        ev({ wallet: "0xc", occurred_at: minutesBefore(t, 4) }),
      ],
      1000,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("trade_burst");
    expect(rows[0].walletCount).toBe(3);
    expect(rows[0].tradeCount).toBe(3);
    expect(rows[0].occurredAt).toBe(t); // latest
    expect(rows[0].text).toContain("3 believers backed YES");
  });

  it("does NOT group across different sides", () => {
    const t = "2026-02-01T12:00:00.000Z";
    const rows = groupLiveRows(
      [ev({ side: "YES", occurred_at: t }), ev({ side: "NO", occurred_at: minutesBefore(t, 1) })],
      1000,
    );
    expect(rows).toHaveLength(2);
  });

  it("does NOT group trades outside the time window", () => {
    const t = "2026-02-01T12:00:00.000Z";
    const rows = groupLiveRows(
      [ev({ occurred_at: t }), ev({ occurred_at: minutesBefore(t, 30) })],
      1000,
    );
    expect(rows).toHaveLength(2);
  });

  it("a single large trade becomes large_trade, not a burst", () => {
    const rows = groupLiveRows([ev({ amount_eth: 2, wallet: "0xwhale" })], 2000);
    expect(rows[0].kind).toBe("large_trade");
    expect(rows[0].text).toContain("entered");
    expect(rows[0].amountUsd).toBe(4000);
  });
});

describe("structured transitions are never grouped away", () => {
  it("market_created passes through as its own row", () => {
    const t = "2026-02-01T12:00:00.000Z";
    const rows = groupLiveRows(
      [
        ev({ kind: "trade", occurred_at: t }),
        ev({
          kind: "market_created",
          side: null,
          action: null,
          occurred_at: minutesBefore(t, 1),
          source_key: "pov:market:42:created",
        }),
        ev({ kind: "trade", occurred_at: minutesBefore(t, 2) }),
      ],
      1000,
    );
    // trade | market_created | trade — the transition splits the bursts.
    expect(rows.map((r) => r.kind)).toEqual(["trade_burst", "market_created", "trade_burst"]);
    expect(rows[1].text).toBe("New market just opened");
  });
});

describe("chronology preserved", () => {
  it("rows stay in the input (reverse-chronological) order", () => {
    const rows = groupLiveRows(
      [
        ev({ market_id: "1", occurred_at: "2026-02-01T12:00:00Z" }),
        ev({ market_id: "2", occurred_at: "2026-02-01T11:00:00Z" }),
      ],
      1000,
    );
    expect(rows.map((r) => r.marketId)).toEqual(["1", "2"]);
  });
});

describe("factual copy only", () => {
  it("never uses motive/hype language", () => {
    const rows = groupLiveRows(
      [ev({ amount_eth: 3 }), ev({ kind: "market_created", side: null })],
      2000,
    );
    for (const r of rows) {
      const t = r.text.toLowerCase();
      for (const banned of ["whale", "smart money", "crowd", "losing faith", "loading up"]) {
        expect(t).not.toContain(banned);
      }
    }
  });
  it("liveRowText for a NO reduce burst reads factually", () => {
    const text = liveRowText({
      id: "x",
      kind: "trade_burst",
      marketId: "1",
      marketTitle: "m",
      occurredAt: "t",
      startedAt: "t",
      side: "NO",
      walletCount: 4,
      tradeCount: 4,
      amountEth: 1,
      amountUsd: 500,
      wallet: null,
      payload: { action: "SELL" },
    });
    expect(text).toContain("4 believers reduced NO");
  });
  it("liveRowText renders a believer milestone with its threshold", () => {
    const text = liveRowText({
      id: "milestone:1:YES:500",
      kind: "believer_milestone",
      marketId: "1",
      marketTitle: "m",
      occurredAt: "t",
      startedAt: "t",
      side: "YES",
      walletCount: null,
      tradeCount: null,
      amountEth: null,
      amountUsd: null,
      wallet: null,
      payload: { threshold: 500 },
    });
    expect(text).toBe("YES just passed 500 believers");
  });
  it("liveRowText renders a tribe doubling", () => {
    const text = liveRowText({
      id: "tribe_doubled:1:NO:2026-01-01",
      kind: "tribe_doubled",
      marketId: "1",
      marketTitle: "m",
      occurredAt: "t",
      startedAt: "t",
      side: "NO",
      walletCount: null,
      tradeCount: null,
      amountEth: null,
      amountUsd: null,
      wallet: null,
      payload: { count: 40, gained: 22 },
    });
    expect(text).toBe("The NO tribe doubled today");
  });
});
