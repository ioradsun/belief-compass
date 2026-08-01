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
import { composeLiveStory, type LiveStory } from "@/domain/story";

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
  /** The structured story: headline (market) → body (change) → attribution (who). */
  story: LiveStory;
  /** Flat fallback ("HEADLINE — body") for any non-structured consumer. */
  text: string;
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
  return composeLiveStory({
    kind: r.kind,
    side: r.side,
    action: (r.payload.action as "BUY" | "SELL" | undefined) ?? null,
    amountUsd: r.amountUsd,
    walletCount: r.walletCount,
    question: r.kind === "market_created" ? r.marketTitle : null,
    threshold: r.kind === "believer_milestone" ? Number(r.payload.threshold ?? 0) : null,
  });
}

const ROUND_TRIP_WINDOW_MS = 15 * 60_000;
const ROUND_TRIP_TOLERANCE = 0.02; // 2% size difference still counts as a wash

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

const LARGE_TRADE_USD = 1000;

/**
 * Collapse canonical events (in reverse-chronological order) into Live rows.
 * `ethUsd` converts ETH amounts to USD for the copy; grouping is deterministic.
 */
export function groupLiveRows(input: LiveEventInput[], ethUsd: number): LiveRow[] {
  const { kept: events, roundTrip } = collapseRoundTrips(input);
  const rows: LiveRow[] = [];
  let i = 0;
  while (i < events.length) {
    const e = events[i];

    // Non-trade structured events pass through as their own rows (never grouped).
    if (e.kind !== "trade") {
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
        marketTitle: e.market_title ?? `Market #${e.market_id}`,
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
      i += 1;
      continue;
    }

    // Trade burst: consecutive trades, same market + side + action, within window.
    // A round-trip entry always stands alone so its story stays honest.
    const isRoundTrip = roundTrip.has(e.source_key);
    const wallets = new Set<string>();
    let trades = 0;
    let amountEth = 0;
    const latest = e.occurred_at;
    let earliest = e.occurred_at;
    let j = i;
    while (
      j < events.length &&
      events[j].kind === "trade" &&
      events[j].market_id === e.market_id &&
      events[j].side === e.side &&
      events[j].action === e.action &&
      !(j > i && (isRoundTrip || roundTrip.has(events[j].source_key))) &&
      new Date(latest).getTime() - new Date(events[j].occurred_at).getTime() <= GROUP_WINDOW_MS
    ) {
      const ev = events[j];
      if (ev.wallet) wallets.add(ev.wallet);
      trades += 1;
      amountEth += ev.amount_eth;
      earliest = ev.occurred_at;
      j += 1;
    }
    const amountUsd = amountEth * ethUsd;
    const isLargeSingle = !isRoundTrip && trades === 1 && amountUsd >= LARGE_TRADE_USD;
    const base: Omit<LiveRow, "text" | "story"> = {
      id: e.source_key,
      kind: isRoundTrip ? "round_trip" : isLargeSingle ? "large_trade" : "trade_burst",
      marketId: e.market_id,
      marketTitle: e.market_title ?? `Market #${e.market_id}`,

      occurredAt: latest,
      startedAt: earliest,
      side: e.side,
      walletCount: wallets.size || trades,
      tradeCount: trades,
      amountEth,
      amountUsd,
      // Sole actor when the row is one wallet — lets the server tag your network.
      wallet: wallets.size === 1 ? [...wallets][0] : trades === 1 ? (e.wallet ?? null) : null,
      payload: { action: e.action, window_ms: GROUP_WINDOW_MS },
    };
    const story = liveRowStory(base);
    rows.push({ ...base, story, text: flattenStory(story) });
    i = j;
  }
  return rows;
}
