/**
 * backfill-events — populate the canonical `events` log from existing history.
 *
 * Phase 2 makes `events` the source of truth. This script projects the two
 * pre-existing stores into it, once:
 *
 *   A. every canonical `trades` row  → one source=chain / kind=trade event,
 *      keyed chain:{chain_id}:{tx_hash}:{log_index}, carrying the trade's
 *      canonical occurred_at and its ORIGINAL ingested_at (not now()).
 *
 *   B. every `feed_events` row is classified:
 *        • backed/reduced (or trade:-keyed)  → trade DUPLICATE, skipped (the
 *          chain trade event above is the only fact — one event, not two)
 *        • anything else                     → source=legacy / kind=legacy_event,
 *          keyed legacy:feed_event:{id}, preserving occurred_at + raw fields, for
 *          historical feed continuity ONLY (never an input to velocity, believer
 *          counts, conviction or positions — those read trades / kind='trade').
 *
 * Properties:
 *   • Idempotent + resumable — inserts are ON CONFLICT (source_key) DO NOTHING,
 *     so stopping and rerunning (or a second full run) is a no-op.
 *   • Bounded — keyset-paged batches; prints progress.
 *   • Non-destructive — never changes balances, ordering, sides or position
 *     state. Only writes `events`.
 *   • Honest — a trade with no canonical occurred_at (block time not yet
 *     backfilled) CANNOT be given an event time, so it is skipped and reported as
 *     unmappable. Run scripts/backfill-block-times.ts first, then rerun this.
 *
 * Run:  npx tsx scripts/backfill-events.ts   (or: npm run backfill:events)
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (required)
 *       BACKFILL_EVENTS_BATCH   rows per page   (default 500)
 */
import { createClient } from "@supabase/supabase-js";
import { CHAIN_ID } from "../src/chain/decoder";
import {
  chainTradeSourceKey,
  legacyFeedEventSourceKey,
  classifyLegacyFeedEvent,
} from "../src/lib/events";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const BATCH = Number(process.env.BACKFILL_EVENTS_BATCH ?? "500");

// ── A. trades → chain trade events ───────────────────────────────────────────
async function backfillTradeEvents() {
  let lastBlock = -1;
  let lastLog = -1;
  let inserted = 0;
  let scanned = 0;
  let skippedNoOccurredAt = 0;

  for (;;) {
    const { data, error } = await sb
      .from("trades")
      .select(
        "tx_hash, log_index, onchain_id, wallet, side, direction, eth_amount, token_amount, block_number, block_hash, occurred_at, ingested_at, raw_log",
      )
      .or(`block_number.gt.${lastBlock},and(block_number.eq.${lastBlock},log_index.gt.${lastLog})`)
      .order("block_number", { ascending: true })
      .order("log_index", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;

    const events = rows
      .filter((r) => {
        if (r.occurred_at == null) {
          skippedNoOccurredAt++;
          return false; // no event time → cannot map; run block-time backfill first
        }
        return true;
      })
      .map((r) => ({
        source_key: chainTradeSourceKey(CHAIN_ID, r.tx_hash as string, r.log_index as number),
        source: "chain",
        kind: "trade",
        market_id: String(r.onchain_id),
        wallet: (r.wallet as string).toLowerCase(),
        side: r.side,
        action: r.direction, // BUY | SELL
        amount_eth: String(r.eth_amount),
        shares: String(r.token_amount),
        price: null, // historical trades predate per-trade price capture
        chain_id: CHAIN_ID,
        block_number: r.block_number,
        block_hash: r.block_hash,
        tx_hash: (r.tx_hash as string).toLowerCase(),
        log_index: r.log_index,
        occurred_at: r.occurred_at,
        // Preserve the trade's original ingestion time — never now().
        ingested_at: r.ingested_at ?? r.occurred_at,
        payload: { raw_log: r.raw_log ?? null },
      }));

    if (events.length > 0) {
      const up = await sb
        .from("events")
        .upsert(events, { onConflict: "source_key", ignoreDuplicates: true })
        .select("source_key");
      if (up.error) throw new Error(up.error.message);
      inserted += up.data?.length ?? 0;
    }

    scanned += rows.length;
    const last = rows[rows.length - 1];
    lastBlock = Number(last.block_number);
    lastLog = Number(last.log_index);
    console.log(
      `[backfill-events][trades] scanned=${scanned} inserted=${inserted} ` +
        `skipped_no_occurred_at=${skippedNoOccurredAt}`,
    );
  }
  return { scanned, inserted, skippedNoOccurredAt };
}

// ── B. feed_events → legacy events (non-trade only) ──────────────────────────
async function backfillLegacyFeedEvents() {
  let lastId = -1;
  let scanned = 0;
  let legacyInserted = 0;
  let tradeDuplicates = 0;

  for (;;) {
    const { data, error } = await sb
      .from("feed_events")
      .select("id, event_key, onchain_id, wallet, type, side, payload, occurred_at, created_at")
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;

    const legacy = [];
    for (const r of rows) {
      const cls = classifyLegacyFeedEvent({
        type: r.type as string,
        event_key: (r.event_key as string) ?? null,
      });
      if (cls === "trade_duplicate") {
        tradeDuplicates++;
        continue; // the chain trade event is the only canonical fact
      }
      legacy.push({
        source_key: legacyFeedEventSourceKey(r.id as number),
        source: "legacy",
        kind: "legacy_event",
        market_id: r.onchain_id != null ? String(r.onchain_id) : null,
        wallet: r.wallet ? (r.wallet as string).toLowerCase() : null,
        side: r.side ?? null,
        action: (r.type as string) ?? null,
        occurred_at: r.occurred_at,
        ingested_at: r.created_at ?? r.occurred_at,
        // Preserve the original structured fields + raw legacy payload.
        payload: { legacy_type: r.type, legacy_payload: r.payload ?? null },
      });
    }

    if (legacy.length > 0) {
      const up = await sb
        .from("events")
        .upsert(legacy, { onConflict: "source_key", ignoreDuplicates: true })
        .select("source_key");
      if (up.error) throw new Error(up.error.message);
      legacyInserted += up.data?.length ?? 0;
    }

    scanned += rows.length;
    lastId = Number(rows[rows.length - 1].id);
    console.log(
      `[backfill-events][feed_events] scanned=${scanned} legacy_inserted=${legacyInserted} ` +
        `trade_duplicates_skipped=${tradeDuplicates}`,
    );
  }
  return { scanned, legacyInserted, tradeDuplicates };
}

// ── Parity checks ────────────────────────────────────────────────────────────
async function headCount(fn: (q: ReturnType<typeof sb.from>) => unknown): Promise<number> {
  const { count } = (await fn(sb as never)) as { count: number | null };
  return count ?? 0;
}

async function parity(skippedNoOccurredAt: number) {
  const canonicalTrades = await headCount(() =>
    sb.from("trades").select("*", { count: "exact", head: true }),
  );
  const canonicalChainEvents = await headCount(() =>
    sb
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("source", "chain")
      .eq("kind", "trade")
      .eq("is_canonical", true),
  );
  const eventsMissingMarket = await headCount(() =>
    sb
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("is_canonical", true)
      .is("market_id", null),
  );
  const eventsMissingWallet = await headCount(() =>
    sb
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("is_canonical", true)
      .eq("kind", "trade")
      .is("wallet", null),
  );
  const tradesMissingBlockTime = await headCount(() =>
    sb.from("trades").select("*", { count: "exact", head: true }).is("occurred_at", null),
  );

  // events_health() does the heavy join-based checks (chain events without a
  // trade projection, projections without a canonical event, counts by kind).
  const { data: health } = await sb.rpc("events_health");

  console.log("\n[backfill-events] PARITY ─────────────────────────────────");
  console.log(`  canonical trades ................... ${canonicalTrades}`);
  console.log(`  canonical chain events ............. ${canonicalChainEvents}`);
  console.log(
    `  missing event projections .......... ${Math.max(0, canonicalTrades - tradesMissingBlockTime - canonicalChainEvents)}`,
  );
  console.log(`  duplicate source keys .............. 0 (enforced by UNIQUE)`);
  console.log(
    `  events missing block timestamps .... ${tradesMissingBlockTime + skippedNoOccurredAt} (trades w/o occurred_at, not yet mappable)`,
  );
  console.log(`  events missing market IDs .......... ${eventsMissingMarket}`);
  console.log(`  events missing wallet IDs .......... ${eventsMissingWallet}`);
  console.log(`  events_health() .................... ${JSON.stringify(health)}`);
  console.log("──────────────────────────────────────────────────────────");
  const expectedMatch = canonicalTrades - tradesMissingBlockTime;
  if (canonicalChainEvents === expectedMatch) {
    console.log(`  ✓ one canonical trade event per mappable canonical trade`);
  } else {
    console.log(
      `  ⚠ chain events (${canonicalChainEvents}) != mappable trades (${expectedMatch}); ` +
        `rerun after block-time backfill.`,
    );
  }
}

async function run() {
  console.log(`[backfill-events] start (batch=${BATCH})`);
  const a = await backfillTradeEvents();
  const b = await backfillLegacyFeedEvents();
  await parity(a.skippedNoOccurredAt);
  console.log(
    `\n[backfill-events] DONE — trade_events_inserted=${a.inserted} ` +
      `trades_skipped_no_occurred_at=${a.skippedNoOccurredAt} ` +
      `legacy_events_migrated=${b.legacyInserted} trade_duplicates_skipped=${b.tradeDuplicates}`,
  );
}

run().catch((e) => {
  console.error("[backfill-events] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
