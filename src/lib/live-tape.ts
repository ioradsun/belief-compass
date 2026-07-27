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
  text: string;
  payload: Record<string, JsonValue>;
}

const GROUP_WINDOW_MS = 10 * 60_000; // 10 minutes

const fmtUsd = (n: number): string => "$" + Math.round(n).toLocaleString("en-US");
const plural = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"}`;

/** Factual text for a row — real numbers only, no motive attribution. */
export function liveRowText(r: Omit<LiveRow, "text">): string {
  switch (r.kind) {
    case "round_trip": {
      const amt = r.amountUsd && r.amountUsd > 0 ? ` ${fmtUsd(r.amountUsd)}` : "";
      return `A wallet round-tripped${amt} on ${r.side ?? ""}`.trim();
    }
    case "trade_burst": {
      const verb = r.side && r.payload.action === "SELL" ? "reduced" : "backed";
      const who = plural(r.walletCount ?? 1, "wallet");
      const amt = r.amountUsd && r.amountUsd > 0 ? ` · ${fmtUsd(r.amountUsd)}` : "";
      return `${who} ${verb} ${r.side ?? ""}${amt}`.trim();
    }
    case "large_trade": {
      const verb = r.payload.action === "SELL" ? "exited" : "entered";
      return `${r.amountUsd ? fmtUsd(r.amountUsd) : ""} ${verb} ${r.side ?? ""}`.trim();
    }
    case "market_created":
      return "New market just opened";
    case "side_shift":
      return `A wallet flipped to ${r.side ?? ""}`.trim();
    default:
      return "";
  }
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
export function groupLiveRows(events: LiveEventInput[], ethUsd: number): LiveRow[] {
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
      const base: Omit<LiveRow, "text"> = {
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
      rows.push({ ...base, text: liveRowText(base) });
      i += 1;
      continue;
    }

    // Trade burst: consecutive trades, same market + side + action, within window.
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
    const isLargeSingle = trades === 1 && amountUsd >= LARGE_TRADE_USD;
    const base: Omit<LiveRow, "text"> = {
      id: e.source_key,
      kind: isLargeSingle ? "large_trade" : "trade_burst",
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
    rows.push({ ...base, text: liveRowText(base) });
    i = j;
  }
  return rows;
}
