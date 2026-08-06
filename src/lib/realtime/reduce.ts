/**
 * The one client reducer.
 *
 * Snapshots establish truth (SSR loader + persisted cache). Events maintain
 * truth (this file). Components only observe truth (they read the cache).
 *
 * A `market_state` realtime row is the market's *current* canonical facts — not a
 * delta. So applying the newest row (by `read_model_version`) is always correct;
 * there is no fold and no per-trade replay on the client. This reducer patches
 * ONLY the fields `market_state` owns onto whatever the cache already holds, so
 * server-computed feed enrichments (story, window volume, tribe faces, joined
 * market metadata) survive untouched. Move the canonical numbers; everything
 * derived reacts.
 *
 * It never fetches, never subscribes, and never writes anything but the cache —
 * the coordinator owns the socket, this owns the merge. Pure enough to unit-test.
 */
import type { QueryClient } from "@tanstack/react-query";

/** A raw `market_state` row as delivered by Postgres realtime (JSON payload.new). */
export type MarketStateRow = Record<string, unknown> & {
  onchain_id: number | string;
  read_model_version?: number | string | null;
};

/**
 * The canonical fields `market_state` owns. Only these are copied from a realtime
 * row onto a cached row. Anything not listed here (enrichments, joined metadata)
 * is preserved. Kept in sync with `MARKET_ROW_SELECT` in markets.functions.ts.
 */
const TEXT_FIELDS = [
  "live_line",
  "live_line_kind",
  "live_line_window",
  "live_line_occurred_at",
  "last_trade_at",
  "opportunity_type",
  "opportunity_reason",
  "opportunity_reason_code",
  "opportunity_window",
] as const;

const BOOL_FIELDS = ["opportunity_eligible"] as const;

const NUMERIC_FIELDS = [
  "yes_price_usd",
  "no_price_usd",
  "money_yes_pct",
  "people_yes_pct",
  "people_no_pct",
  "believers_yes",
  "believers_no",
  "believers_mixed",
  "directional_believers",
  "divergence",
  "volume_total_usd",
  "trending_score",
  "yes_capital_usd",
  "no_capital_usd",
  "new_believers_1h",
  "new_believers_24h",
  "new_believers_yes_24h",
  "new_believers_no_24h",
  "unique_wallets_24h",
  "circulation_24h",
  "velocity_5m",
  "opportunity_score",
  "opportunity_confidence",
  "opportunity_sample_size",
] as const;

const numOrNull = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

/**
 * Extract just the live fields from a realtime row, normalized to the JS types
 * the rest of the app already consumes (numeric columns → number, so a
 * PostgREST-string cache and a realtime-number stream never diverge).
 */
export function liveFieldsOf(row: MarketStateRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of NUMERIC_FIELDS) if (f in row) out[f] = numOrNull(row[f]);
  for (const f of TEXT_FIELDS) if (f in row) out[f] = row[f] ?? null;
  for (const f of BOOL_FIELDS) if (f in row) out[f] = Boolean(row[f]);
  return out;
}

/** Read `read_model_version` as a comparable number (missing → 0). */
export function versionOf(row: MarketStateRow): number {
  const v = Number(row.read_model_version);
  return Number.isFinite(v) ? v : 0;
}

type FeedData = {
  rows?: Record<number, Record<string, unknown>>;
  [k: string]: unknown;
};

/**
 * Patch one market's live fields into every cache entry that holds it:
 *  - `["opp-feed", …]` — the feed keeps a `rows[onchainId]` read-model object.
 *  - `["market-row", id]` — the solo row for a market opened outside the feed.
 *  - `["market-change", id]` — the deck's price pair (market_state owns price).
 *
 * Returns the number of cache entries touched (for diagnostics/tests).
 */
export function applyMarketStateRow(qc: QueryClient, row: MarketStateRow): number {
  const id = Number(row.onchain_id);
  if (!Number.isFinite(id)) return 0;
  const live = liveFieldsOf(row);
  if (Object.keys(live).length === 0) return 0;
  let touched = 0;

  // Every opp-feed variant (wallet × window × lens) that already lists this market.
  const feeds = qc.getQueryCache().findAll({ queryKey: ["opp-feed"] });
  for (const q of feeds) {
    const data = q.state.data as FeedData | undefined;
    const existing = data?.rows?.[id];
    if (!data?.rows || !existing) continue;
    qc.setQueryData(q.queryKey, {
      ...data,
      rows: { ...data.rows, [id]: { ...existing, ...live } },
    });
    touched++;
  }

  // The solo market-row cache (a market opened from search / after leaving feed).
  const soloKey = ["market-row", id];
  const solo = qc.getQueryData<{ row?: Record<string, unknown> | null }>(soloKey);
  if (solo?.row) {
    qc.setQueryData(soloKey, { ...solo, row: { ...solo.row, ...live } });
    touched++;
  }

  // The deck's price pair lives under market-change; market_state owns price, so
  // keep it live without that query's own poll. Flows/tape stay as fetched.
  const changeKey = ["market-change", id];
  const change = qc.getQueryData<{ yesPrice?: number | null; noPrice?: number | null }>(changeKey);
  if (change && (live.yes_price_usd !== undefined || live.no_price_usd !== undefined)) {
    qc.setQueryData(changeKey, {
      ...change,
      ...(live.yes_price_usd !== undefined ? { yesPrice: live.yes_price_usd } : {}),
      ...(live.no_price_usd !== undefined ? { noPrice: live.no_price_usd } : {}),
    });
    touched++;
  }

  return touched;
}

/**
 * Apply a batch of realtime rows in one pass. Deterministic ordering: for each
 * market only the highest `read_model_version` seen in the batch is applied, and
 * `lastVersion` carries the high-water mark across batches so a late/out-of-order
 * row is a no-op (mirroring the server's `apply_position_events` version guard).
 */
export function applyMarketStateBatch(
  qc: QueryClient,
  rows: MarketStateRow[],
  lastVersion: Map<number, number>,
): number {
  // Collapse to the newest row per market first (a burst of 40 updates to one
  // market becomes one merge, one render).
  const newest = new Map<number, MarketStateRow>();
  for (const row of rows) {
    const id = Number(row.onchain_id);
    if (!Number.isFinite(id)) continue;
    const v = versionOf(row);
    const prev = newest.get(id);
    if (!prev || v >= versionOf(prev)) newest.set(id, row);
  }

  let touched = 0;
  for (const [id, row] of newest) {
    const v = versionOf(row);
    // read_model_version is monotonic per market; skip anything not newer than
    // what we already applied. Version 0 means "unversioned" — always apply.
    if (v > 0 && (lastVersion.get(id) ?? 0) >= v) continue;
    lastVersion.set(id, v);
    touched += applyMarketStateRow(qc, row);
  }
  return touched;
}

// --- Activity (events stream) --------------------------------------------
//
// The live tape and per-card pulses are SERVER-NARRATED DTOs (composed story
// beats, resolved profiles, personal/network detection) — not raw projections
// of `events`. Re-narrating them on the client would duplicate real server
// logic, exactly what this architecture avoids. So a trade event is a *signal*,
// not a delta to fold: it says "market X just traded" and we refetch only that
// narrated slice, letting the server stay the single author of the copy.

/**
 * Which `["market-pulses", ids]` cache keys hold at least one of the markets that
 * just traded. Both key shapes are covered: the feed's `"12,45,88"` id-list and a
 * single market's `"42"`. Pure — the coordinator invalidates the returned keys.
 */
export function affectedPulseKeys(qc: QueryClient, affected: Set<number>): unknown[][] {
  if (affected.size === 0) return [];
  const out: unknown[][] = [];
  for (const q of qc.getQueryCache().findAll({ queryKey: ["market-pulses"] })) {
    const spec = q.queryKey[1];
    if (typeof spec !== "string") continue;
    const ids = spec.split(",").map((s) => Number(s));
    if (ids.some((id) => affected.has(id))) out.push(q.queryKey as unknown[]);
  }
  return out;
}

/**
 * Which `["positions-tape", wallet, ids[]]` caches hold a market that just
 * traded. The scope is an id ARRAY at key[2] (vs pulses' comma-string at [1]),
 * so any wallet's trade on one of the viewer's position markets refreshes this
 * left-column network tape — precisely, never on unrelated trades.
 */
export function affectedPositionsTapeKeys(qc: QueryClient, affected: Set<number>): unknown[][] {
  if (affected.size === 0) return [];
  const out: unknown[][] = [];
  for (const q of qc.getQueryCache().findAll({ queryKey: ["positions-tape"] })) {
    const ids = q.queryKey[2];
    if (Array.isArray(ids) && ids.some((id) => affected.has(Number(id)))) {
      out.push(q.queryKey as unknown[]);
    }
  }
  return out;
}

/**
 * The viewer's position cache families, as partial key prefixes to invalidate
 * when their `wallet_beliefs` changes. Partial match covers every window/market
 * variant (`["my-convictions", w, win]`, `["position-summary", w, id]`, …);
 * `refetchType: "active"` then refreshes only what is mounted. Positions are
 * server-valued (POV worth, ETH→USD cost, market meta), so the change is a
 * signal to refetch — never a client-side re-valuation.
 */
export function viewerPositionKeys(wallet: string): unknown[][] {
  const w = wallet.toLowerCase();
  return [
    ["my-convictions", w],
    ["positions-tape", w],
    ["position-summary", w],
  ];
}
