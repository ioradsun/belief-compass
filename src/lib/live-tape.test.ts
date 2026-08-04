import { describe, it, expect } from "vitest";
import {
  groupLiveRows,
  liveRowStory,
  mergeLiveRows,
  type LiveEventInput,
  type LiveRow,
} from "./live-tape";
import type { LiveStory } from "@/domain/story";
import { scoreFeedEvent } from "@/domain/feed-event";
import { adaptiveFloor, admitToFeed } from "@/domain/feed-density";

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
    expect(rows[0].story.headline).toBe("NEW BELIEVER");
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
    // The transition keeps its own row — that is what "never grouped away" means.
    expect(rows.filter((r) => r.kind === "market_created")).toHaveLength(1);
    expect(rows.find((r) => r.kind === "market_created")!.story.category).toBe("fresh_market");
    // The two trades are ONE burst. They share a market, a side, an action and
    // two minutes; an unrelated event landing between them in the array is a
    // property of the query, not of what happened, and used to split them.
    expect(rows.filter((r) => r.kind === "trade_burst")).toHaveLength(1);
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
  const rowBase = (
    o: Partial<Omit<LiveRow, "text" | "story">> = {},
  ): Omit<LiveRow, "text" | "story"> => ({
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

  it("liveRowStory: a burst of exits reads as people leaving, counted", () => {
    const s = liveRowStory(rowBase());
    expect(s.category).toBe("shrinking");
    expect(s.headline).toBe("BELIEVER LEFT");
    expect(s.body).toBe("4 people left NO.");
  });
  it("liveRowStory: a milestone shows its threshold", () => {
    const s = liveRowStory(
      rowBase({
        kind: "believer_milestone",
        side: "YES",
        amountUsd: null,
        payload: { threshold: 500 },
      }),
    );
    expect(s.category).toBe("milestone");
    expect(s.body).toBe("YES reached 500 believers.");
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
    headline: "NEW BELIEVER",
    body: "Someone joined YES.",
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

/**
 * THE DEAD-TAPE REGRESSION. `eth_usd_calibration()` returns NULL when no market
 * has volume_total_usd > 0; the refresher stores that NULL; `Number(null) || 0`
 * reads back as 0. Pricing every trade at $0 made each one score 14/100, land in
 * Tier 4, and be discarded as dust — leaving only the structural rows that carry
 * no amount. That is a two-row tape on top of thousands of real trades.
 */
describe("an unknown ETH price is never a price of zero", () => {
  const trade = (i: number, eth: number): LiveEventInput => ({
    source_key: `t${i}`,
    kind: "trade",
    market_id: String(i + 1),
    market_title: "Q?",
    occurred_at: new Date(Date.UTC(2026, 7, 4, 12) - i * 60_000).toISOString(),
    block_number: i,
    log_index: i,
    side: "YES",
    action: "BUY",
    amount_eth: eth,
    wallet: `0xw${i}`,
    payload: null,
  });

  it("reports the amount as UNKNOWN, not as $0", () => {
    const rows = groupLiveRows([trade(0, 0.02)], 0);
    expect(rows[0].amountUsd).toBeNull();
    // The ETH figure is still true — only the conversion is missing.
    expect(rows[0].amountEth).toBeCloseTo(0.02);
  });

  it("keeps every trade in the feed when the rate is broken", () => {
    const rows = groupLiveRows([trade(0, 0.02), trade(1, 0.018), trade(2, 0.0155)], 0);
    const cands = rows.map((r) => ({
      kind: r.kind,
      side: r.side,
      amountUsd: r.amountUsd,
      walletCount: r.walletCount,
      tradeCount: r.tradeCount,
      marketBelievers: 100,
    }));
    const { floor } = adaptiveFloor(cands.map((c) => scoreFeedEvent(c).score));
    expect(cands.filter((c) => admitToFeed(c, floor))).toHaveLength(3);
  });

  it("never calls an unpriced trade 'large' — that would be a claim we cannot make", () => {
    const huge = groupLiveRows([trade(0, 1000)], 0);
    expect(huge[0].kind).toBe("trade_burst");
    expect(groupLiveRows([trade(0, 1000)], 3500)[0].kind).toBe("large_trade");
  });

  it("says nothing about money rather than saying zero", () => {
    const [row] = groupLiveRows([trade(0, 0.02)], 0);
    expect(row.text).not.toMatch(/\$0\b/);
  });

  it("prices normally the moment a real rate exists", () => {
    expect(groupLiveRows([trade(0, 0.02)], 3500)[0].amountUsd).toBeCloseTo(70);
  });
});

describe("one person acting everywhere is one story", () => {
  const T = Date.UTC(2026, 7, 4, 12);
  const at = (m: number) => new Date(T - m * 60_000).toISOString();
  const sell = (market: string, m: number, wallet = "0xml"): LiveEventInput => ({
    source_key: `s:${market}:${m}:${wallet}`,
    kind: "trade",
    market_id: market,
    market_title: `Q${market}`,
    occurred_at: at(m),
    block_number: m,
    log_index: m,
    side: "YES",
    action: "SELL",
    amount_eth: 0.01,
    wallet,
    payload: null,
  });

  it("collapses a wallet clearing out of many markets into ONE row", () => {
    const rows = groupLiveRows(
      ["1", "2", "3", "4", "5"].map((m, i) => sell(m, i)),
      3500,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("wallet_sweep");
    expect(rows[0].payload.markets).toBe(5);
    expect(rows[0].tradeCount).toBe(5);
  });

  it("leaves two markets alone — that is not a sweep, it is two moves", () => {
    const rows = groupLiveRows([sell("1", 0), sell("2", 1)], 3500);
    expect(rows.every((r) => r.kind !== "wallet_sweep")).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("does not merge different people into one sweep", () => {
    const rows = groupLiveRows(
      [sell("1", 0), sell("2", 1), sell("3", 2), sell("4", 3, "0xother")],
      3500,
    );
    const sweeps = rows.filter((r) => r.kind === "wallet_sweep");
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].wallet).toBe("0xml");
    expect(rows.filter((r) => r.kind === "trade_burst")).toHaveLength(1);
  });

  it("does not merge buying and selling into the same sweep", () => {
    const buys = ["1", "2", "3"].map((m, i) => ({
      ...sell(m, i),
      action: "BUY" as const,
      source_key: `b${m}`,
    }));
    const sells = ["4", "5", "6"].map((m, i) => sell(m, i + 3));
    const sweeps = groupLiveRows([...buys, ...sells], 3500).filter(
      (r) => r.kind === "wallet_sweep",
    );
    expect(sweeps).toHaveLength(2);
    expect(new Set(sweeps.map((s) => s.payload.action))).toEqual(new Set(["BUY", "SELL"]));
  });

  it("is a person, not a market — it carries no destination", () => {
    const rows = groupLiveRows(
      ["1", "2", "3"].map((m, i) => sell(m, i)),
      3500,
    );
    expect(Number(rows[0].marketId)).toBe(0);
  });
});

describe("the same story is never told twice", () => {
  const T = Date.UTC(2026, 7, 4, 12);
  const at = (m: number) => new Date(T - m * 60_000).toISOString();
  const t = (market: string, wallet: string, m: number): LiveEventInput => ({
    source_key: `t:${market}:${wallet}:${m}`,
    kind: "trade",
    market_id: market,
    market_title: `Q${market}`,
    occurred_at: at(m),
    block_number: m,
    log_index: m,
    side: "YES",
    action: "SELL",
    amount_eth: 0.01,
    wallet,
    payload: null,
  });

  it("groups a market's trades even when other markets are interleaved", () => {
    // Production shipped the same sentence three times over because grouping
    // required the events to be ADJACENT in the query result.
    const rows = groupLiveRows(
      [t("1", "0xa", 0), t("9", "0xb", 1), t("1", "0xa", 2), t("9", "0xb", 3), t("1", "0xa", 4)],
      3500,
    );
    const m1 = rows.filter((r) => r.marketId === "1");
    expect(m1).toHaveLength(1);
    expect(m1[0].tradeCount).toBe(3);
  });

  it("still separates clusters that are genuinely hours apart", () => {
    const rows = groupLiveRows([t("1", "0xa", 0), t("1", "0xa", 240)], 3500);
    expect(rows.filter((r) => r.marketId === "1")).toHaveLength(2);
  });

  it("returns rows newest-first, so the tape reads like a live stream", () => {
    const rows = groupLiveRows([t("1", "0xa", 30), t("2", "0xb", 5), t("3", "0xc", 90)], 3500);
    const times = rows.map((r) => Date.parse(r.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

/**
 * CHURN. Fixtures taken from six hours of production, where three wallets
 * produced over half of all trades as perfect alternating ladders.
 */
describe("a wallet that went nowhere has nothing to say", () => {
  const T = Date.UTC(2026, 7, 4, 12);
  const at = (m: number) => new Date(T - m * 60_000).toISOString();
  /** One leg of the observed ladder: SELL x, BUY x, SELL y, BUY y, … */
  const leg = (
    i: number,
    action: "BUY" | "SELL",
    eth: number,
    wallet = "0xaf705ec3",
    market = "2749",
  ): LiveEventInput => ({
    source_key: `c:${wallet}:${market}:${i}`,
    kind: "trade",
    market_id: market,
    market_title: "Q?",
    occurred_at: at(i * 6),
    block_number: i,
    log_index: i,
    side: "YES",
    action,
    amount_eth: eth,
    wallet,
    payload: null,
  });

  /** The exact sizes from mkt2749, spanning 101 minutes — past the 15m pair window. */
  const LADDER = [0.036091, 0.038493, 0.048122, 0.028914, 0.031326, 0.038476, 0.04328, 0.052913];
  const ladder = (wallet?: string, market?: string) =>
    LADDER.flatMap((eth, i) => [
      leg(i * 2, "SELL", eth, wallet, market),
      leg(i * 2 + 1, "BUY", eth, wallet, market),
    ]);

  it("drops a churner entirely — it is volume, not conviction", () => {
    expect(groupLiveRows(ladder(), 3500)).toHaveLength(0);
  });

  it("catches it even when the pairs are too far apart to match one another", () => {
    // 16 legs six minutes apart span 90+ minutes, well past ROUND_TRIP_WINDOW_MS.
    // Pairwise matching alone would let most of these through.
    const rows = groupLiveRows(ladder(), 3500);
    expect(rows.filter((r) => r.kind === "wallet_sweep")).toHaveLength(0);
    expect(rows.filter((r) => r.kind === "trade_burst")).toHaveLength(0);
  });

  it("cannot be evaded by jittering the sizes", () => {
    const jittered = ladder().map((e, i) => ({ ...e, amount_eth: e.amount_eth * (1 + i * 0.004) }));
    expect(groupLiveRows(jittered, 3500)).toHaveLength(0);
  });

  it("never sweeps a churner across markets — the loudest row we have", () => {
    const across = ["2749", "2750", "2747"].flatMap((m) => ladder("0xbot", m));
    expect(groupLiveRows(across, 3500).filter((r) => r.kind === "wallet_sweep")).toHaveLength(0);
  });

  it("leaves someone who actually took a position alone", () => {
    // Six buys, no sells: they are holding something. That is a believer.
    const buys = LADDER.slice(0, 6).map((eth, i) => leg(i, "BUY", eth));
    const rows = groupLiveRows(buys, 3500);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.kind !== "round_trip")).toBe(true);
  });

  it("leaves someone who trimmed a position alone — that is a real move", () => {
    // Bought six, sold one back: 6 trades, but nowhere near balanced.
    const legs = [...LADDER.slice(0, 5).map((eth, i) => leg(i, "BUY", eth)), leg(9, "SELL", 0.004)];
    expect(groupLiveRows(legs, 3500).length).toBeGreaterThan(0);
  });

  it("does not punish a short burst — that is trading, not a pattern", () => {
    const four = [
      leg(0, "SELL", 0.05),
      leg(1, "BUY", 0.05),
      leg(2, "SELL", 0.06),
      leg(3, "BUY", 0.06),
    ];
    // Below minTrades, so the pairwise round-trip rule handles it as before.
    expect(groupLiveRows(four, 3500).every((r) => r.kind === "round_trip")).toBe(true);
  });

  it("does not merge two different wallets into one churner", () => {
    // Four legs each: eight trades between them, but nobody individually
    // reaches the bar, so churn must not pool them. They fall to the pairwise
    // round-trip rule instead.
    const legs = [...ladder("0xa").slice(0, 4), ...ladder("0xb").slice(0, 4)];
    const rows = groupLiveRows(legs, 3500);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.kind === "round_trip")).toBe(true);
  });
});
