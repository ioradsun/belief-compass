/**
 * Canonical event log — pure helpers shared by the chain poller, the POV poller,
 * the events backfill, the read module and their tests.
 *
 * Phase 2 first principle: STORE FACTS, NOT STORIES. One real-world action is
 * represented exactly once, in `events`, keyed by a DETERMINISTIC `source_key`
 * so the same action always produces the same identity — replaying the chain
 * overlap, rerunning a backfill, or re-polling POV can never duplicate it.
 *
 * These helpers own:
 *   • the event taxonomy (sources, kinds)
 *   • deterministic source-key construction + hash normalization
 *   • building a canonical trade event from a decoded chain trade
 *   • canonical (chain) and recency (display) ordering with stable tie-breakers
 *   • the adapter that projects a canonical event back into the legacy
 *     feed_events row shape the current feed UI still expects
 *   • the reorg set-difference (which stored keys are now orphaned)
 *   • the legacy feed_events classifier used by the backfill
 *
 * ZERO IO. Everything here is a pure function of its inputs.
 */

/** JSON-serializable value (matches what crosses the serverFn boundary). */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// ── Taxonomy ────────────────────────────────────────────────────────────────
// The schema allows any string, so future kinds need no code change here; these
// are the values Phase 2 actually writes and reads.
export const EVENT_SOURCES = ["chain", "pov", "system", "legacy"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const EVENT_KINDS = ["trade", "market_created", "legacy_event"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

// ── Read column set (single-sourced) ─────────────────────────────────────────
// The ONLY columns product reads select. Deliberately excludes ingested_at and
// created_at (operational/audit — never recency) and payload (raw_log — never
// shipped to clients). Recency reads use occurred_at only; there is no fallback
// to ingestion time anywhere downstream.
export const EVENT_READ_COLUMNS = [
  "source_key",
  "source",
  "kind",
  "market_id",
  "wallet",
  "side",
  "action",
  "amount_eth",
  "shares",
  "price",
  "chain_id",
  "block_number",
  "log_index",
  "occurred_at",
] as const;
export const EVENT_READ_SELECT = EVENT_READ_COLUMNS.join(", ");

// ── Deterministic identity ───────────────────────────────────────────────────
/** Hashes are compared and keyed lowercase so casing never splits an identity. */
export function normalizeHash(h: string): string {
  return h.trim().toLowerCase();
}

/** chain:{chain_id}:{tx_hash}:{log_index} — one key per on-chain log. */
export function chainTradeSourceKey(
  chainId: number | bigint,
  txHash: string,
  logIndex: number | bigint,
): string {
  return `chain:${Number(chainId)}:${normalizeHash(txHash)}:${Number(logIndex)}`;
}

/** pov:market:{market_id}:created — one key per market, ever. */
export function marketCreatedSourceKey(marketId: number | bigint | string): string {
  return `pov:market:${String(marketId)}:created`;
}

/** legacy:feed_event:{id} — preserves a legacy feed row's identity. */
export function legacyFeedEventSourceKey(id: number | string): string {
  return `legacy:feed_event:${String(id)}`;
}

// ── Shapes ───────────────────────────────────────────────────────────────────
/** The decoded-trade fields this module needs (a subset of CanonicalTrade). */
export interface CanonicalTradeLike {
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_hash: string;
  onchain_id: string | number;
  wallet: string;
  side: "YES" | "NO";
  direction: "BUY" | "SELL";
  token_amount: string | number;
  eth_amount: string | number;
  price?: string | number | null;
  raw_log?: unknown;
}

/** The row we insert/reconcile for a chain trade. amount_eth/shares carry RAW
 *  WEI (numeric) to mirror the trades projection exactly — the UI converts. */
export interface ChainTradeEventInput {
  source_key: string;
  source: "chain";
  kind: "trade";
  market_id: string;
  wallet: string;
  side: "YES" | "NO";
  action: "BUY" | "SELL";
  amount_eth: string;
  shares: string;
  price: string | null;
  chain_id: number;
  block_number: number;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  occurred_at: string;
  payload: Record<string, unknown>;
}

/** Canonical event as read back out of `events`. */
export interface EventFact {
  source_key: string;
  source: string;
  kind: string;
  market_id: string | null;
  wallet: string | null;
  side: string | null;
  action: string | null;
  amount_eth: string | null;
  shares: string | null;
  price: string | null;
  chain_id: number | null;
  block_number: number | null;
  log_index: number | null;
  occurred_at: string;
  payload: JsonValue | null;
}

/** The pre-Phase-2 feed_events row shape the current feed UI still consumes. */
export interface LegacyFeedEventRow {
  onchain_id: number;
  wallet: string;
  type: string;
  side: string;
  payload: { eth?: string; tokens?: string } | null;
  occurred_at: string;
  event_key: string;
}

// ── Build ────────────────────────────────────────────────────────────────────
/**
 * Build the canonical trade event for a decoded chain trade. Deterministic:
 * the same log always yields the same source_key and the same structured fields,
 * so replay/backfill are idempotent by identity. occurred_at is the CANONICAL
 * block time (Phase 1) — never ingestion time.
 */
export function tradeEventFromCanonical(
  t: CanonicalTradeLike,
  chainId: number,
  occurredAt: string,
): ChainTradeEventInput {
  return {
    source_key: chainTradeSourceKey(chainId, t.tx_hash, t.log_index),
    source: "chain",
    kind: "trade",
    market_id: String(t.onchain_id),
    wallet: t.wallet.toLowerCase(),
    side: t.side,
    action: t.direction,
    amount_eth: String(t.eth_amount),
    shares: String(t.token_amount),
    price: t.price != null ? String(t.price) : null,
    chain_id: chainId,
    block_number: Number(t.block_number),
    block_hash: t.block_hash,
    tx_hash: normalizeHash(t.tx_hash),
    log_index: Number(t.log_index),
    occurred_at: occurredAt,
    payload: { raw_log: t.raw_log ?? null },
  };
}

/** Collapse a batch to one row per identity — proves "one action, one event". */
export function dedupeBySourceKey<T extends { source_key: string }>(events: T[]): T[] {
  const m = new Map<string, T>();
  for (const e of events) m.set(e.source_key, e);
  return [...m.values()];
}

// ── Ordering ─────────────────────────────────────────────────────────────────
type Ordered = {
  occurred_at: string;
  block_number: number | null;
  log_index: number | null;
  source_key: string;
};

/** Canonical chain order: block_number ASC, log_index ASC, then source_key. */
export function eventCanonicalCompare(a: Ordered, b: Ordered): number {
  const ab = a.block_number ?? Number.POSITIVE_INFINITY;
  const bb = b.block_number ?? Number.POSITIVE_INFINITY;
  if (ab !== bb) return ab - bb;
  const al = a.log_index ?? Number.POSITIVE_INFINITY;
  const bl = b.log_index ?? Number.POSITIVE_INFINITY;
  if (al !== bl) return al - bl;
  return a.source_key < b.source_key ? -1 : a.source_key > b.source_key ? 1 : 0;
}

/**
 * Reverse-chronological display order: occurred_at DESC, then block_number DESC,
 * log_index DESC, and finally source_key DESC as a stable tie-break so events
 * sharing a timestamp (esp. non-chain events with no block) never reorder.
 */
export function eventRecencyCompare(a: Ordered, b: Ordered): number {
  if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? 1 : -1;
  const ab = a.block_number ?? -1;
  const bb = b.block_number ?? -1;
  if (ab !== bb) return bb - ab;
  const al = a.log_index ?? -1;
  const bl = b.log_index ?? -1;
  if (al !== bl) return bl - al;
  return a.source_key < b.source_key ? 1 : a.source_key > b.source_key ? -1 : 0;
}

// ── Adapter (events → legacy feed row) ───────────────────────────────────────
/**
 * Project a canonical event into the legacy feed_events row shape. This is the
 * compatibility seam: chronological readers keep their existing DTO while the
 * underlying source becomes `events`. A trade's BUY→"backed"/SELL→"reduced"
 * mapping reproduces exactly what the old poller wrote. amount_eth/shares (raw
 * wei) map to payload.eth/tokens, which the feed's USD math already divides by 1e18.
 */
export function toLegacyFeedEventRow(f: EventFact): LegacyFeedEventRow {
  const type =
    f.action === "BUY"
      ? "backed"
      : f.action === "SELL"
        ? "reduced"
        : f.kind === "market_created"
          ? "market_created"
          : (f.action ?? f.kind);
  return {
    onchain_id: f.market_id != null ? Number(f.market_id) : 0,
    wallet: f.wallet ?? "",
    type,
    side: f.side ?? "YES",
    payload: {
      eth: f.amount_eth ?? undefined,
      tokens: f.shares ?? undefined,
    },
    occurred_at: f.occurred_at,
    event_key: f.source_key,
  };
}

// ── Reorg ────────────────────────────────────────────────────────────────────
/**
 * Which currently-stored keys are no longer canonical: the set of stored keys in
 * a rescanned range that Base did NOT return this pass. These get is_canonical =
 * false + orphaned_at, and their trade projections removed.
 */
export function orphanedSourceKeys(stored: string[], canonical: Iterable<string>): string[] {
  const keep = new Set<string>();
  for (const k of canonical) keep.add(k);
  return stored.filter((k) => !keep.has(k));
}

// ── Legacy feed_events classification (backfill) ─────────────────────────────
export type FeedEventClass = "trade_duplicate" | "structured" | "legacy";

/**
 * Classify an existing feed_events row for the backfill:
 *   • trade_duplicate — it restates a canonical chain trade (the chain trade
 *     event is the only fact; do NOT create a second event for it)
 *   • structured — a real non-trade fact with enough provenance to key
 *     deterministically (none exist in production today, but the branch is here)
 *   • legacy — narrative we can't confidently structure; preserve verbatim as
 *     source=legacy / kind=legacy_event, for feed continuity only
 */
export function classifyLegacyFeedEvent(row: {
  type: string | null;
  event_key: string | null;
}): FeedEventClass {
  const t = (row.type ?? "").toLowerCase();
  if (t === "backed" || t === "reduced") return "trade_duplicate";
  if ((row.event_key ?? "").startsWith("trade:")) return "trade_duplicate";
  return "legacy";
}
