import { describe, it, expect } from "vitest";
import {
  groupLiveRows,
  liveRowStory,
  mergeLiveRows,
  type LiveEventInput,
  type LiveRow,
} from "./live-tape";
import type { LiveStory } from "@/domain/story";

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
    expect(rows[0].story.headline).toBe("YES IS GROWING");
    expect(rows[0].story.category).toBe("growing");
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
    expect(rows[0].story.category).toBe("capital_in");
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
    expect(rows[1].story.category).toBe("fresh_market");
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
  const rowBase = (o: Partial<Omit<LiveRow, "text" | "story">> = {}): Omit<LiveRow, "text" | "story"> => ({
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
    ...o,
  });

  it("liveRowStory: a reduce burst reads as the side losing believers", () => {
    const s = liveRowStory(rowBase());
    expect(s.category).toBe("shrinking");
    expect(s.headline).toBe("NO LOST 4 BELIEVERS");
  });
  it("liveRowStory: a milestone shows its threshold", () => {
    const s = liveRowStory(
      rowBase({ kind: "believer_milestone", side: "YES", amountUsd: null, payload: { threshold: 500 } }),
    );
    expect(s.category).toBe("milestone");
    expect(s.body).toBe("YES just reached 500 believers.");
  });
  it("liveRowStory: a doubling surges, and never calls the side a 'tribe'", () => {
    const s = liveRowStory(rowBase({ kind: "tribe_doubled", side: "NO", payload: {} }));
    expect(s.category).toBe("momentum");
    expect(`${s.headline} ${s.body}`).not.toMatch(/tribe/i);
  });
});

describe("mergeLiveRows (delta sync)", () => {
  const story: LiveStory = {
    category: "growing",
    headline: "YES IS GROWING",
    body: "Another believer joined YES.",
    attribution: null,
    tone: "yes",
    personal: false,
  };
  const lr = (id: string, occurredAt: string, text = id): LiveRow => ({
    id,
    kind: "trade_burst",
    marketId: "42",
    marketTitle: "m",
    occurredAt,
    startedAt: occurredAt,
    side: "YES",
    walletCount: 1,
    tradeCount: 1,
    amountEth: 0.1,
    amountUsd: 100,
    wallet: "0xa",
    story,
    text,
    payload: {},
  });
  const t = (m: number) => `2026-02-01T12:${String(m).padStart(2, "0")}:00.000Z`;

  it("keeps the immutable tail and prepends the fresh head, newest first", () => {
    const prev = [lr("e", t(30)), lr("d", t(20)), lr("c", t(10)), lr("b", t(5)), lr("a", t(1))];
    const since = t(15); // c, b, a are the stable tail (< since)
    const fresh = [lr("g", t(40)), lr("f", t(35)), lr("e", t(30))];
    const out = mergeLiveRows(prev, fresh, since, 100);
    expect(out.map((r) => r.id)).toEqual(["g", "f", "e", "c", "b", "a"]);
  });

  it("lets fresh win on id collisions (a grown/re-grouped burst)", () => {
    const prev = [lr("e", t(30), "1 believer backed YES")];
    const fresh = [lr("e", t(30), "4 believers backed YES")];
    const out = mergeLiveRows(prev, fresh, t(20), 100);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("4 believers backed YES");
  });

  it("is a no-op when the server returns nothing fresh (never drops the head)", () => {
    const prev = [lr("e", t(30)), lr("d", t(20))];
    expect(mergeLiveRows(prev, [], t(15), 100).map((r) => r.id)).toEqual(["e", "d"]);
  });

  it("trims to the limit", () => {
    const prev = [lr("c", t(10)), lr("b", t(5)), lr("a", t(1))];
    const fresh = [lr("e", t(30)), lr("d", t(20))];
    expect(mergeLiveRows(prev, fresh, t(15), 3).map((r) => r.id)).toEqual(["e", "d", "c"]);
  });
});
