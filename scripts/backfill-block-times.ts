/**
 * backfill-block-times — give historical chain trades their canonical Base block
 * time.
 *
 * The old poller stamped `trades.ts = new Date()` (ingestion time). The
 * 20260728000000 migration moved those to `ingested_at` and left `occurred_at`
 * NULL for every historical row. This script fills `occurred_at` from the real
 * block timestamp and propagates it to the trade-driven `feed_events`.
 *
 * Properties:
 *   • Idempotent + resumable — only touches rows where occurred_at IS NULL, so it
 *     is safe to stop and rerun; a second full run is a no-op.
 *   • Bounded — one block-timestamp fetch per unique block, bounded concurrency;
 *     never one request per trade.
 *   • Non-destructive — sets occurred_at only. It NEVER changes trade ordering,
 *     amounts, sides, or any position/belief state (that self-corrects when the
 *     wallet next trades and the poller re-folds with event time).
 *
 * Run:  npx tsx scripts/backfill-block-times.ts
 *       (or: npm run backfill:block-times)
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (required)
 *       BASE_RPC_URL                              (recommended — public RPC is slow)
 *       BACKFILL_BLOCK_BATCH   distinct blocks per pass   (default 250)
 *       BACKFILL_CONCURRENCY   block fetches in flight     (default 5)
 */
import { createClient } from "@supabase/supabase-js";
import { getBaseClient } from "../src/chain/client";
import { fetchBlockTimes } from "../src/lib/block-time";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const chain = getBaseClient();

const BLOCK_BATCH = Number(process.env.BACKFILL_BLOCK_BATCH ?? "250");
const CONCURRENCY = Number(process.env.BACKFILL_CONCURRENCY ?? "5");

async function remainingNullCount(): Promise<number> {
  const { count } = await sb
    .from("trades")
    .select("*", { count: "exact", head: true })
    .is("occurred_at", null);
  return count ?? 0;
}

/** The next batch of DISTINCT block numbers that still need a timestamp. */
async function nextBlocks(): Promise<number[]> {
  // Pull a page of null-occurred trades in block order; dedupe to distinct blocks.
  // We over-read (BLOCK_BATCH * 40 rows) so a batch of blocks is actually distinct
  // even when a block holds many trades.
  const { data, error } = await sb
    .from("trades")
    .select("block_number")
    .is("occurred_at", null)
    .order("block_number", { ascending: true })
    .limit(BLOCK_BATCH * 40);
  if (error) throw new Error(error.message);
  const seen = new Set<number>();
  for (const r of data ?? []) {
    seen.add(Number(r.block_number));
    if (seen.size >= BLOCK_BATCH) break;
  }
  return [...seen];
}

async function run() {
  const startNull = await remainingNullCount();
  console.log(`[backfill] start — trades without occurred_at: ${startNull}`);

  let blocksProcessed = 0;
  let tradesUpdated = 0;
  let feedEventsUpdated = 0;

  for (;;) {
    const blocks = await nextBlocks();
    if (blocks.length === 0) break;

    const times = await fetchBlockTimes(
      blocks,
      async (b) => Number((await chain.getBlock({ blockNumber: BigInt(b) })).timestamp),
      CONCURRENCY,
    );

    for (const b of blocks) {
      const iso = times.get(b);
      if (!iso) continue; // couldn't fetch — leave NULL, retried on a later pass

      // Update every trade in this block that still lacks a time.
      const upd = await sb
        .from("trades")
        .update({ occurred_at: iso })
        .eq("block_number", b)
        .is("occurred_at", null)
        .select("wallet, onchain_id, tx_hash, log_index");
      if (upd.error) throw new Error(upd.error.message);
      const rows = upd.data ?? [];
      tradesUpdated += rows.length;

      // Propagate to the deterministic trade-driven feed events for this block.
      // Every feed event in the block shares the same block time, so one update.
      const keys = rows.map((r) => `trade:${r.wallet}:${r.onchain_id}:${r.tx_hash}:${r.log_index}`);
      for (let i = 0; i < keys.length; i += 500) {
        const fe = await sb
          .from("feed_events")
          .update({ occurred_at: iso })
          .in("event_key", keys.slice(i, i + 500))
          .select("event_key");
        if (fe.error) throw new Error(fe.error.message);
        feedEventsUpdated += fe.data?.length ?? 0;
      }
      blocksProcessed += 1;
    }

    const remaining = await remainingNullCount();
    console.log(
      `[backfill] blocks_processed=${blocksProcessed} trades_updated=${tradesUpdated} ` +
        `feed_events_updated=${feedEventsUpdated} trades_remaining_without_occurred_at=${remaining}`,
    );
    // Safety: if a pass fetched blocks but updated nothing (e.g. every block in
    // the page failed to fetch), stop rather than spin.
    if (times.size === 0) break;
  }

  const remaining = await remainingNullCount();
  console.log(
    `[backfill] DONE — blocks_processed=${blocksProcessed} trades_updated=${tradesUpdated} ` +
      `feed_events_updated=${feedEventsUpdated} trades_remaining_without_occurred_at=${remaining}`,
  );
  if (remaining > 0) {
    console.log(
      `[backfill] ${remaining} rows still without a block time (unfetchable blocks). ` +
        `Rerun later; do NOT add the occurred_at NOT NULL constraint until this is 0.`,
    );
  }
}

run().catch((e) => {
  console.error("[backfill] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
