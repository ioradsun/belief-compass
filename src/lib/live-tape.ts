/**
 * Live tape — pure grouping of canonical events into a compact chronological
 * activity feed. ZERO IO. Live answers "what just happened?", ordered by canonical
 * occurrence time — never ranked, never personalized.
 *
 * Grouping: consecutive TRADE events for the same market + side + action inside a
 * short window collapse into one burst row (preserving wallet/trade counts, total
 * amount, and the start/end occurrence times). Structured transitions
 * (market_created, side shifts, milestones) are NEVER grouped away.
 */
import type { JsonValue } from "@/lib/events";
import type { LiveStory } from "@/domain/story";
import {
  tellConvictionStory,
  CONVICTION_EVENT,
  type ConvictionAction,
} from "@/domain/conviction-event";
import type { StackPerson } from "@/domain/conviction-cohort";
import type { MixCandidate } from "@/domain/feed-cadence";
import { findWashTrades, WASH } from "@/domain/wash-trading";
import type { Perishability } from "@/domain/feed-scheduler";
import { marketTitle } from "@/domain/market-title";

export interface LiveEventInput {
  source_key: string;
  kind: string; // trade | market_created | position_changed_side | ...
  market_id: string;
  market_title: string | null;
  occurred_at: string;
  block_number: number | null;
  log_index: number | null;
  side: "YES" | "NO" | null;
  action: "BUY" | "SELL" | null;
  amount_eth: number; // ETH (already /1e18)
  wallet: string | null;
  payload: Record<string, unknown> | null;
}

/** The person behind a single-actor row (server-tagged). `relationship` is set
 * only when they're in the viewer's network; otherwise null (still named). */
export interface LiveFace {
  name: string;
  avatarUrl: string | null;
  relationship: "twin" | "tribe" | "opp" | "inverse" | null;
}

export interface LiveRow {
  id: string;
  kind: string; // trade_burst | large_trade | market_created | side_shift
  marketId: string;
  marketTitle: string;
  occurredAt: string; // latest occurrence in the row
  startedAt: string; // earliest occurrence in the row (== occurredAt for singletons)
  side: "YES" | "NO" | null;
  walletCount: number | null;
  tradeCount: number | null;
  amountEth: number | null;
  amountUsd: number | null;
  /** The sole actor when this row is one wallet; null for multi-wallet bursts. */
  wallet: string | null;
  /** Set by the server when the actor is in the viewer's network. */
  face?: LiveFace | null;
  /**
   * The people a GROUP story is about — a conviction cohort, an aggregated
   * burst. Rendered as a stack of clickable faces so the row becomes a way into
   * those profiles rather than just a statement about them. Absent on rows with
   * a single actor (their face already sits on the attribution) and on rows
   * about the market itself.
   */
  people?: StackPerson[] | null;
  /** The structured story: headline (market) → body (change) → attribution (who). */
  story: LiveStory;
  /** Flat fallback ("HEADLINE — body") for any non-structured consumer. */
  text: string;
  /**
   * What the cadence mixer needs to order this row: family, significance
   * (including the viewer's bounded relationship bump), and the identities it
   * should avoid repeating. Computed server-side where that data lives; APPLIED
   * after delta-sync merge, because the merge re-sorts and would discard any
   * ordering decided earlier.
   */
  mix?: MixCandidate;
  /**
   * What the presentation scheduler needs: how urgent this row is, and how much
   * of the reader's attention it is owed. Both are decided server-side, where
   * the tier and the conviction action already exist — `scoreFeedEvent` was
   * computing the tier to admit the row and then throwing it away, so every row
   * arrived looking equally important no matter what it was.
   */
  pace?: { perishability: Perishability; weight: number };
  /**
   * This row has no "when". A standing fact ("Kate has backed YES for 11+ days")
   * is a continuity, not an event — printing an age beside it would read as
   * "this just happened", which is the one thing it does not mean.
   */
  timeless?: boolean;
  payload: Record<string, JsonValue>;
}

const GROUP_WINDOW_MS = 10 * 60_000; // 10 minutes

/**
 * Delta-sync overlap. A poll fetches only events newer than (newest − OVERLAP).
 * It MUST exceed every window that can retroactively re-group a row (the 10-min
 * burst window and the 15-min round-trip window), so the server re-groups the
 * boundary exactly as a full fetch would and the cached tail is truly immutable.
 */
export const LIVE_DELTA_OVERLAP_MS = 16 * 60_000; // 16 minutes

/**
 * Merge a delta-sync poll: `fresh` is the authoritative re-grouping of everything
 * at/after `sinceIso`; `prev` is the client's cached full list. Keep prev's
 * immutable tail (older than sinceIso), replace the head with fresh, dedupe by id
 * (fresh wins), newest first, trimmed to `limit`. If the server returned nothing
 * fresh, the poll is a no-op — never drop the head we already have.
 */
export function mergeLiveRows(
  prev: LiveRow[],
  fresh: LiveRow[],
  sinceIso: string,
  limit: number,
): LiveRow[] {
  if (fresh.length === 0) return prev.slice(0, limit);
  const byId = new Map<string, LiveRow>();
  for (const r of fresh) byId.set(r.id, r);
  for (const r of prev) if (r.occurredAt < sinceIso && !byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
    .slice(0, limit);
}

/** Flatten a structured story for the `text` fallback field. */
export const flattenStory = (s: LiveStory): string =>
  s.attribution ? `${s.headline} — ${s.body} ${s.attribution}` : `${s.headline} — ${s.body}`;

/**
 * The baseline story for a row from just the row's own fields (no actor identity,
 * no live believer counts). The server re-composes actor rows and the fresh
 * market with the richer inputs it resolves; system rows are final here.
 */
export function liveRowStory(r: Omit<LiveRow, "text" | "story">): LiveStory {
  // The SAME grammar the server uses, with only what this row knows about
  // itself: no identity, no tenure, no position state. The sentence comes out
  // plainer, never wrong — which is the whole point of every context field
  // being optional (see src/domain/conviction-event).
  const buySell = (r.payload.action as "BUY" | "SELL" | undefined) ?? null;
  const action: ConvictionAction =
    r.kind === "wallet_sweep"
      ? buySell === "SELL"
        ? "sweep_out"
        : "sweep_in"
      : r.kind === "market_created"
        ? "open_market"
        : r.kind === "believer_milestone"
          ? "milestone"
          : r.kind === "tribe_doubled"
            ? "surge"
            : r.kind === "side_shift"
              ? "flip"
              : r.kind === "round_trip"
                ? "round_trip"
                : buySell === "SELL"
                  ? "exit"
                  : "enter";
  return tellConvictionStory({
    action,
    side: r.side,
    context: {
      amountUsd: r.amountUsd,
      peopleCount: r.walletCount,
      marketCount: Number(r.payload.markets ?? 0) || null,
      question: r.kind === "market_created" ? r.marketTitle : null,
      threshold: r.kind === "believer_milestone" ? Number(r.payload.threshold ?? 0) : null,
    },
  });
}

const ROUND_TRIP_WINDOW_MS = WASH.roundTripWindowMs;
const ROUND_TRIP_TOLERANCE = WASH.roundTripTolerance;

/**
 * CHURN — a wallet cycling in and out of the same belief, over and over.
 *
 * The pairwise round-trip rule above catches ONE buy matched to ONE sell. It is
 * not enough. Measured over six hours of production: 136 trades, of which the
 * top six sequences alone were 73, every one of them a perfect alternating
 * ladder by a single wallet on a single side —
 *
 *   SELL 0.036091  BUY 0.036091  SELL 0.038493  BUY 0.038493  … ×8
 *
 * Three wallets produced over half of all platform "activity" that way. Pairwise
 * matching does eventually reject each pair, but it depends on every pair
 * landing inside a 15-minute window at under 2% size difference — so a churner
 * who widens either dimension slightly walks straight into the feed, and would
 * arrive as an aggregated "sweep", which is the loudest row we have.
 *
 * So the pattern is judged, not the pair: a wallet with enough trades on one
 * (market, side) whose buying and selling BALANCE has taken no position and
 * expressed no belief. Balance is the honest test — it cannot be evaded by
 * jittering sizes or spacing, only by taking real directional risk, which is
 * precisely the thing this feed is about.
 */
/**
 * Wallets that went nowhere, loudly — the source_keys to drop entirely.
 *
 * The RULE now lives in src/domain/wash-trading, because the metrics need the
 * same verdict: a market whose volume spikes on the scoreboard while the tape
 * stays silent makes a reader distrust both. This is the read-time application
 * of it; `events.is_wash` is the persisted one.
 */
function findChurn(events: LiveEventInput[]): Set<string> {
  const verdict = findWashTrades(
    events
      .filter((e) => e.kind === "trade")
      .map((e) => ({
        key: e.source_key,
        wallet: e.wallet,
        marketId: e.market_id,
        side: e.side,
        action: e.action,
        amountEth: e.amount_eth,
        occurredAt: e.occurred_at,
      })),
  );
  const drop = new Set<string>();
  for (const [key, reason] of verdict) if (reason === "churn") drop.add(key);
  return drop;
}

/**
 * A wallet that buys and sells the same size on the same market+side within a
 * few minutes is one round-trip, not two stories. Drop the exit event and mark
 * the entry so the tape shows a single honest row instead of a mirrored pair.
 */
function collapseRoundTrips(events: LiveEventInput[]): {
  kept: LiveEventInput[];
  roundTrip: Set<string>;
} {
  const drop = new Set<string>();
  const roundTrip = new Set<string>();
  for (let a = 0; a < events.length; a += 1) {
    const sell = events[a];
    if (sell.kind !== "trade" || sell.action !== "SELL" || !sell.wallet) continue;
    if (drop.has(sell.source_key)) continue;
    for (let b = a + 1; b < events.length; b += 1) {
      const buy = events[b];
      if (
        new Date(sell.occurred_at).getTime() - new Date(buy.occurred_at).getTime() >
        ROUND_TRIP_WINDOW_MS
      )
        break;
      if (
        buy.kind !== "trade" ||
        buy.action !== "BUY" ||
        buy.wallet !== sell.wallet ||
        buy.market_id !== sell.market_id ||
        buy.side !== sell.side ||
        roundTrip.has(buy.source_key)
      )
        continue;
      const base = Math.max(buy.amount_eth, sell.amount_eth, Number.EPSILON);
      if (Math.abs(buy.amount_eth - sell.amount_eth) / base > ROUND_TRIP_TOLERANCE) continue;
      drop.add(sell.source_key);
      roundTrip.add(buy.source_key);
      break;
    }
  }
  return { kept: events.filter((e) => !drop.has(e.source_key)), roundTrip };
}

/**
 * A single trade big enough to stand alone rather than join a burst.
 *
 * This was its own `1000`, duplicating `CONVICTION_EVENT.bigUsd` — the same
 * judgement ("this trade is big") written twice, so the two could drift and one
 * could be re-tuned without the other. They are one thing, and the grammar owns
 * the definition. Both were unreachable: no market here has ever averaged a
 * trade above $298.
 */
const LARGE_TRADE_USD = CONVICTION_EVENT.bigUsd;

/**
 * How many of a burst's participants travel with the row. Instagram shows a few
 * faces and a count, never the whole list: the stack is an invitation, and a cap
 * keeps the payload (and the row) from turning into a directory.
 */
const BURST_WALLET_CAP = 8;

/**
 * Collapse canonical events (in reverse-chronological order) into Live rows.
 * Grouping is deterministic.
 *
 * `ethUsd` converts ETH amounts to USD. Pass 0 (or anything non-positive) when
 * the rate is genuinely unknown and every amount comes back NULL — this module
 * will not invent a price, because a fabricated $0 reads downstream as "dust"
 * and silently deletes the entire feed.
 */
/**
 * A wallet doing the same thing across MANY markets at once is one story, not
 * fifteen. This is the grouping dimension the tape was missing: burst grouping
 * only ever looked WITHIN a market, so one person clearing out their whole book
 * produced a wall of near-identical rows — and the cadence mixer was left trying
 * to hide with penalties what should never have been fifteen rows.
 *
 * It is also the better story. "ML pulled out of 15 markets" is someone
 * liquidating a worldview; "ML left YES" fifteen times is a log file.
 */
const SWEEP_WINDOW_MS = 60 * 60_000;
const SWEEP_MIN_MARKETS = 3;

/** Trades keyed to one wallet+direction, newest first. */
function findSweeps(trades: LiveEventInput[]): Map<string, LiveEventInput[]> {
  const byActor = new Map<string, LiveEventInput[]>();
  for (const e of trades) {
    if (!e.wallet || !e.action) continue;
    const k = `${e.wallet.toLowerCase()}:${e.action}`;
    const list = byActor.get(k) ?? [];
    list.push(e);
    byActor.set(k, list);
  }
  const sweeps = new Map<string, LiveEventInput[]>();
  for (const [k, list] of byActor) {
    // Anchored on the newest move, so a sweep is a burst of activity rather
    // than "everything this wallet did in the window we happened to load".
    const newest = Date.parse(list[0].occurred_at);
    const near = list.filter((e) => newest - Date.parse(e.occurred_at) <= SWEEP_WINDOW_MS);
    if (new Set(near.map((e) => e.market_id)).size >= SWEEP_MIN_MARKETS) sweeps.set(k, near);
  }
  return sweeps;
}

/**
 * Collapse canonical events (in reverse-chronological order) into Live rows.
 * Deterministic, and ordered newest-first on the way out.
 *
 * FOUR GROUPINGS, in priority order:
 *   0. CHURN   — a wallet whose buying and selling balance over one side took no
 *                position at all. Dropped outright: volume, not conviction.
 *   1. WASHES  — a buy and matching sell minutes apart is one round trip.
 *   2. SWEEPS  — one wallet acting across 3+ markets in an hour is one story.
 *   3. BURSTS  — trades on the same market + side + action inside 10 minutes.
 *
 * Bursts group by KEY, not by adjacency. They used to require the events to be
 * consecutive in the array, so three sells on the same market interleaved with
 * another wallet's activity produced three identical rows — visible in
 * production as the same sentence repeated verbatim down the tape.
 *
 * `ethUsd` converts ETH amounts to USD. Pass 0 (or anything non-positive) when
 * the rate is genuinely unknown and every amount comes back NULL — this module
 * will not invent a price, because a fabricated $0 reads downstream as "dust"
 * and silently deletes the entire feed.
 */
export function groupLiveRows(input: LiveEventInput[], ethUsd: number): LiveRow[] {
  // Churn first: a wallet that went nowhere has nothing to say, and leaving its
  // trades in would let them pair, burst or sweep their way onto the tape.
  const churn = findChurn(input);
  const { kept: events, roundTrip } = collapseRoundTrips(
    churn.size ? input.filter((e) => !churn.has(e.source_key)) : input,
  );
  const rows: LiveRow[] = [];
  const usd = (eth: number) => (ethUsd > 0 ? eth * ethUsd : null);

  // ── 1. Non-trade structured events pass through untouched. ────────────────
  for (const e of events) {
    if (e.kind === "trade") continue;
    const kind =
      e.kind === "market_created"
        ? "market_created"
        : e.kind === "position_changed_side"
          ? "side_shift"
          : e.kind;
    const base: Omit<LiveRow, "text" | "story"> = {
      id: e.source_key,
      kind,
      marketId: e.market_id,
      marketTitle: marketTitle(e.market_title, e.market_id),
      occurredAt: e.occurred_at,
      startedAt: e.occurred_at,
      side: e.side,
      walletCount: null,
      tradeCount: null,
      amountEth: null,
      amountUsd: null,
      wallet: e.wallet,
      payload: { ...(e.payload ?? {}) } as Record<string, JsonValue>,
    };
    const story = liveRowStory(base);
    rows.push({ ...base, story, text: flattenStory(story) });
  }

  // ── 2. Sweeps. A round-trip entry is never swept up — its story is its own.
  const trades = events.filter((e) => e.kind === "trade" && !roundTrip.has(e.source_key));
  const sweeps = findSweeps(trades);
  const swept = new Set<string>();
  for (const [key, list] of sweeps) {
    for (const e of list) swept.add(e.source_key);
    const markets = new Set(list.map((e) => e.market_id));
    const amountEth = list.reduce((n, e) => n + e.amount_eth, 0);
    const [wallet, action] = key.split(":");
    const base: Omit<LiveRow, "text" | "story"> = {
      // Stable across polls: the same wallet + direction + newest move.
      id: `sweep:${key}:${list[0].source_key}`,
      kind: "wallet_sweep",
      // A sweep is about a PERSON, not a market — the renderer treats a
      // non-positive id as "no destination" and lets the face be the way in.
      marketId: "0",
      marketTitle: "",
      occurredAt: list[0].occurred_at,
      startedAt: list[list.length - 1].occurred_at,
      side: null,
      walletCount: 1,
      tradeCount: list.length,
      amountEth,
      amountUsd: usd(amountEth),
      wallet,
      payload: { action, markets: markets.size } as Record<string, JsonValue>,
    };
    const story = liveRowStory(base);
    rows.push({ ...base, story, text: flattenStory(story) });
  }

  // ── 3. Bursts, keyed rather than positional. ──────────────────────────────
  const byKey = new Map<string, LiveEventInput[]>();
  for (const e of trades) {
    if (swept.has(e.source_key)) continue;
    const k = `${e.market_id}:${e.side}:${e.action}`;
    const list = byKey.get(k) ?? [];
    list.push(e);
    byKey.set(k, list);
  }
  for (const list of byKey.values()) {
    // `list` is newest-first; start a new group whenever the gap exceeds the
    // window, so a market with activity all day yields one row per cluster.
    let group: LiveEventInput[] = [];
    const flush = () => {
      if (group.length === 0) return;
      const head = group[0];
      const wallets = new Set(group.map((e) => e.wallet).filter((w): w is string => !!w));
      const amountEth = group.reduce((n, e) => n + e.amount_eth, 0);
      const amountUsd = usd(amountEth);
      const isLargeSingle = group.length === 1 && amountUsd != null && amountUsd >= LARGE_TRADE_USD;
      /**
       * WHO IS IN THIS BURST, and what each of them put behind it. A crowd row
       * used to keep only a COUNT, so "6 people backed YES" could never become
       * six faces. The wallets ride along on the payload (biggest commitment
       * first, capped — a stack is a way in, not a directory) and the server
       * turns them into names and pictures.
       */
      const byWallet = new Map<string, number>();
      for (const e of group) {
        if (!e.wallet) continue;
        const w = e.wallet.toLowerCase();
        byWallet.set(w, (byWallet.get(w) ?? 0) + e.amount_eth);
      }
      const walletStakes = [...byWallet.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, BURST_WALLET_CAP)
        .map(([w, eth]) => ({ wallet: w, usd: usd(eth) }));
      const base: Omit<LiveRow, "text" | "story"> = {
        id: head.source_key,
        kind: isLargeSingle ? "large_trade" : "trade_burst",
        marketId: head.market_id,
        marketTitle: marketTitle(head.market_title, head.market_id),
        occurredAt: head.occurred_at,
        startedAt: group[group.length - 1].occurred_at,
        side: head.side,
        walletCount: wallets.size || group.length,
        tradeCount: group.length,
        amountEth,
        amountUsd,
        // Sole actor when the row is one wallet — lets the server tag your network.
        wallet: wallets.size === 1 ? [...wallets][0] : null,
        payload: { action: head.action, window_ms: GROUP_WINDOW_MS, wallets: walletStakes },
      };

      const story = liveRowStory(base);
      rows.push({ ...base, story, text: flattenStory(story) });
      group = [];
    };
    for (const e of list) {
      if (
        group.length > 0 &&
        Date.parse(group[0].occurred_at) - Date.parse(e.occurred_at) > GROUP_WINDOW_MS
      )
        flush();
      group.push(e);
    }
    flush();
  }

  // ── 4. Round trips stand alone, always. ───────────────────────────────────
  for (const e of events) {
    if (e.kind !== "trade" || !roundTrip.has(e.source_key)) continue;
    const amountUsd = usd(e.amount_eth);
    const base: Omit<LiveRow, "text" | "story"> = {
      id: e.source_key,
      kind: "round_trip",
      marketId: e.market_id,
      marketTitle: marketTitle(e.market_title, e.market_id),
      occurredAt: e.occurred_at,
      startedAt: e.occurred_at,
      side: e.side,
      walletCount: 1,
      tradeCount: 1,
      amountEth: e.amount_eth,
      amountUsd,
      wallet: e.wallet,
      payload: { action: e.action, window_ms: GROUP_WINDOW_MS },
    };
    const story = liveRowStory(base);
    rows.push({ ...base, story, text: flattenStory(story) });
  }

  // Newest first. A live tape reads in time order; curation happens elsewhere.
  return rows.sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : a.id < b.id ? 1 : -1,
  );
}
