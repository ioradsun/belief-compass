/**
 * WASH MARKER — records, on the event itself, whether it expressed a belief.
 *
 * The live tape has always judged this at read time. The metrics could not,
 * because they are SQL aggregates and the rule is a TypeScript heuristic — so
 * `market_state.volume_eth_24h` counted volume the feed had already refused to
 * show, and a market could look busy on the scoreboard while its tape sat
 * silent. Two numbers that disagree are worse than one that is wrong, because
 * the reader cannot tell which to trust.
 *
 * So the verdict is written once, here, onto `events.is_wash`. The feed and
 * every aggregate then read the same fact. The JUDGEMENT stays in
 * src/domain/wash-trading.ts — this file is only the pen.
 *
 * WHY RE-SCAN RATHER THAN JUDGE ON INSERT. Churn is a property of a SEQUENCE:
 * a trade becomes churn only once five more join it. Judging at insert time
 * would have to revisit earlier rows anyway, so the honest shape is a rolling
 * re-scan that is idempotent and can be run as often as you like.
 *
 * BOTH DIRECTIONS, INSIDE THE WINDOW. A verdict can change as the sequence
 * around a trade fills in, so the scan sets the flag to whatever the current
 * evidence says rather than only ever setting it true. Outside the window flags
 * freeze, which is why the window covers the widest aggregate (7 days) rather
 * than the feed's own 72 hours.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { findWashTrades, type JudgeableTrade, type WashReason } from "@/domain/wash-trading";
import { weiToEth } from "@/domain/money";

type Db = ReturnType<typeof serviceClient>;
type Row = Record<string, unknown>;

/**
 * How far back each run judges. Must cover the widest window any aggregate
 * reports (`volume_eth_7d`), or a metric would sum trades whose verdict was
 * never revisited.
 */
const SCAN_MS = 7 * 24 * 60 * 60_000;
/** Rows per page. The whole 7-day set is small; this bounds a bad day. */
const PAGE = 1000;
const MAX_PAGES = 12;
/** Rows per UPDATE batch. Keeps each statement well inside any timeout. */
const WRITE_CHUNK = 200;

export interface WashMarkResult {
  scanned: number;
  /** Currently judged as expressing no belief. */
  flagged: number;
  /** Rows whose stored verdict actually changed this run. */
  changed: number;
  byReason: Record<WashReason, number>;
}

/**
 * Judge every trade in the scan window and reconcile the stored flags.
 *
 * Returns counts rather than throwing on an empty result: nothing to mark is a
 * perfectly good outcome, and it must be distinguishable from a failure — the
 * whole reason this codebase reports numbers from its jobs.
 */
export async function markWashTrades(db: Db = serviceClient()): Promise<WashMarkResult> {
  const since = new Date(Date.now() - SCAN_MS).toISOString();

  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await db
      .from("events")
      .select("source_key, wallet, market_id, side, action, amount_eth, occurred_at, is_wash")
      .eq("is_canonical", true)
      .eq("kind", "trade")
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw new Error(`wash-marker: events read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  if (rows.length === 0) {
    return { scanned: 0, flagged: 0, changed: 0, byReason: { churn: 0, round_trip: 0 } };
  }

  const trades: JudgeableTrade[] = rows.map((r) => ({
    key: String(r.source_key),
    wallet: r.wallet == null ? null : String(r.wallet).toLowerCase(),
    marketId: String(r.market_id),
    side: (r.side as "YES" | "NO" | null) ?? null,
    action: (r.action as "BUY" | "SELL" | null) ?? null,
    // The events log stores wei; the rule only needs a consistent unit, but
    // matching the aggregates' own conversion keeps the two comparable.
    amountEth: weiToEth(r.amount_eth as string | null),
    occurredAt: String(r.occurred_at),
  }));

  const verdict = findWashTrades(trades);
  const byReason: Record<WashReason, number> = { churn: 0, round_trip: 0 };
  for (const reason of verdict.values()) byReason[reason] += 1;

  // Only rows whose stored value disagrees with the verdict are written. A run
  // that changes nothing should cost nothing.
  const toFlag: Array<{ key: string; reason: WashReason }> = [];
  const toClear: string[] = [];
  for (const r of rows) {
    const key = String(r.source_key);
    const reason = verdict.get(key);
    const stored = r.is_wash === true;
    if (reason && !stored) toFlag.push({ key, reason });
    else if (!reason && stored) toClear.push(key);
  }

  for (let i = 0; i < toFlag.length; i += WRITE_CHUNK) {
    const batch = toFlag.slice(i, i + WRITE_CHUNK);
    // Grouped by reason so each statement stays a single UPDATE.
    for (const reason of ["churn", "round_trip"] as const) {
      const keys = batch.filter((b) => b.reason === reason).map((b) => b.key);
      if (keys.length === 0) continue;
      const { error } = await db
        .from("events")
        .update({ is_wash: true, wash_reason: reason })
        .in("source_key", keys);
      if (error) throw new Error(`wash-marker: flag update failed: ${error.message}`);
    }
  }
  for (let i = 0; i < toClear.length; i += WRITE_CHUNK) {
    const { error } = await db
      .from("events")
      .update({ is_wash: false, wash_reason: null })
      .in("source_key", toClear.slice(i, i + WRITE_CHUNK));
    if (error) throw new Error(`wash-marker: clear update failed: ${error.message}`);
  }

  return {
    scanned: rows.length,
    flagged: verdict.size,
    changed: toFlag.length + toClear.length,
    byReason,
  };
}
