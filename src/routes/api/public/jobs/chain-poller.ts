/**
 * Job B — chain poller. Bearer-guarded.
 * - Acquires expiring lease on ingest_state.
 * - Reads Base logs for the proxy from max(last_block-12, deploy) → head.
 * - Upserts canonical trades; rebuilds affected wallet_beliefs by folding
 *   ALL that wallet-market's ordered canonical trades through applyTrade.
 * - Regenerates trade-driven feed_events with deterministic keys.
 * - Atomically advances cursor + clears lease.
 *
 * Note: full transactional atomicity across Supabase JS is best-effort; we
 * order operations so partial failures re-run cleanly on the next tick.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getServiceSupabase, assertIngestBearer } from "@/lib/service-supabase.server";
import { getBaseClient } from "@/chain/client";
import { decodeTradeLog, PROXY_ADDRESS, TRADE_EVENTS, type CanonicalTrade } from "@/chain/decoder";
import { applyTrade, emptyRow, type BeliefRow, type Trade } from "@/domain/domain";
import { uniqueBlockNumbers, fetchBlockTimes, occurredAtFor } from "@/lib/block-time";

// One block-timestamp fetch per unique block, this many in flight at once, so a
// busy range never bursts the RPC.
const BLOCK_TS_CONCURRENCY = 5;

// Deploy block for the proxy on Base. Backfill from here on first run.
// Unknown at build time — set conservatively; Job B skips ranges with no logs cheaply.
// Base proxy deploy is around block ~45.8M (18 days of markets before head at build time).
// Conservative default; override with PROXY_DEPLOY_BLOCK env if known exactly.
const DEPLOY_BLOCK = BigInt(process.env.PROXY_DEPLOY_BLOCK ?? "45500000");
const REORG_DEPTH = 12n;
// Public Base RPC rate-limits heavily. Keep each chunk small so it reliably
// completes — and, crucially, so it can be a DURABLE unit of progress: the
// cursor advances after every chunk (see below), never only at end-of-run.
const MAX_CHUNK = 800n;
const CHUNK_DELAY_MS = 250;
// Soft cap on how far a single healthy tick scans. Progress is durable per
// chunk, so a tick cut short by the pg_net/serverless timeout still advances —
// this only bounds a run that would otherwise race far ahead of head.
const MAX_BLOCKS_PER_RUN = 20_000n;
const LEASE_MS = 120_000;

const runId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const Route = createFileRoute("/api/public/jobs/chain-poller")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try { assertIngestBearer(request); }
        catch (r) { return r instanceof Response ? r : new Response("err", { status: 500 }); }

        const sb = getServiceSupabase();
        const rid = runId();
        const started = Date.now();

        // 1. Claim lease
        const leaseSql = await sb.rpc as unknown;
        void leaseSql;
        const { data: leased, error: leaseErr } = await sb
          .from("ingest_state")
          .update({ lease_owner: rid, lease_expires_at: new Date(Date.now() + 120_000).toISOString() })
          .eq("id", 1)
          .or(`lease_expires_at.is.null,lease_expires_at.lt.${new Date().toISOString()},lease_owner.eq.${rid}`)
          .select("last_block")
          .maybeSingle();

        if (leaseErr) return Response.json({ ok: false, error: leaseErr.message }, { status: 500 });
        if (!leased) return Response.json({ ok: true, skipped: "lease_held" });

        try {
          const client = getBaseClient();
          const head = await client.getBlockNumber();
          const from = leased.last_block
            ? BigInt(leased.last_block) - REORG_DEPTH
            : DEPLOY_BLOCK;
          const fromClamped = from < DEPLOY_BLOCK ? DEPLOY_BLOCK : from;
          const maxTo = fromClamped + MAX_BLOCKS_PER_RUN - 1n;
          const to = head < maxTo ? head : maxTo;

          // Cursor already committed to the DB. Starts at whatever the run
          // inherited; only ever moves forward, one durable chunk at a time.
          let cursor = leased.last_block ? BigInt(leased.last_block) : DEPLOY_BLOCK - 1n;
          let totalTrades = 0;
          let totalPairs = 0;
          // Observability.
          let logsReceived = 0;
          let tradesDecoded = 0;
          let uniqueBlocksFetched = 0;
          let rowsOrphaned = 0;
          let earliestOccurred: string | null = null;
          let latestOccurred: string | null = null;

          // Scan in chunks. Each chunk is a DURABLE unit of progress: once its
          // trades are persisted and its derived rows rebuilt, we advance
          // ingest_state.last_block to the chunk's end and refresh the lease.
          // This is the fix for the "stuck" backfill: previously the cursor
          // only advanced after the entire per-run scan + all DB writes
          // finished, so a tick torn down by the pg_net/serverless timeout made
          // ZERO progress and the next tick re-scanned the same range forever.
          for (let start = fromClamped; start <= to; start += MAX_CHUNK) {
            const end = start + MAX_CHUNK - 1n > to ? to : start + MAX_CHUNK - 1n;

            // Scan this chunk.
            const logs = await client.getLogs({
              address: PROXY_ADDRESS,
              events: TRADE_EVENTS,
              fromBlock: start,
              toBlock: end,
            });
            const trades: CanonicalTrade[] = [];
            for (const log of logs) {
              const t = decodeTradeLog(log);
              if (t) trades.push(t);
            }
            logsReceived += logs.length;
            tradesDecoded += trades.length;

            // Canonical EVENT time: fetch each unique block's timestamp exactly
            // once (bounded concurrency), cached for this chunk. NEVER server time.
            const blockTimes = trades.length
              ? await fetchBlockTimes(
                  uniqueBlockNumbers(trades),
                  async (b) => Number((await client.getBlock({ blockNumber: BigInt(b) })).timestamp),
                  BLOCK_TS_CONCURRENCY,
                )
              : new Map<number, string>();
            uniqueBlocksFetched += blockTimes.size;
            for (const t of blockTimes.values()) {
              if (earliestOccurred == null || t < earliestOccurred) earliestOccurred = t;
              if (latestOccurred == null || t > latestOccurred) latestOccurred = t;
            }

            // 2. Delete non-canonical trades in [start,end] (reorg orphans).
            const keep = new Set(trades.map((t) => `${t.tx_hash}:${t.log_index}`));
            const { data: existing } = await sb
              .from("trades")
              .select("tx_hash, log_index")
              .gte("block_number", Number(start))
              .lte("block_number", Number(end));
            for (const d of existing ?? []) {
              if (keep.has(`${d.tx_hash}:${d.log_index}`)) continue;
              await sb.from("trades").delete()
                .eq("tx_hash", d.tx_hash).eq("log_index", d.log_index);
              rowsOrphaned += 1;
            }

            // 3. Upsert canonical trades + stub unknown markets.
            if (trades.length > 0) {
              const marketIds = new Set(trades.map((t) => t.onchain_id));
              const marketStubs = [...marketIds].map((id) => ({ onchain_id: Number(id) }));
              await sb.from("markets").upsert(marketStubs, { onConflict: "onchain_id", ignoreDuplicates: true });

              const rows = trades.map((t) => ({
                tx_hash: t.tx_hash,
                log_index: t.log_index,
                onchain_id: Number(t.onchain_id),
                wallet: t.wallet,
                side: t.side,
                direction: t.direction,
                eth_amount: t.eth_amount,     // wei string; UI converts
                token_amount: t.token_amount, // wei string
                block_number: t.block_number,
                block_hash: t.block_hash,
                raw_log: t.raw_log,
                // Canonical block time. Deterministic → replaying the reorg
                // overlap writes the identical value (no spurious "new" activity).
                occurred_at: occurredAtFor(t.block_number, blockTimes),
                // ingested_at is intentionally OMITTED: it defaults to now() on
                // insert and is left untouched on a conflicting replay, so an
                // unchanged row keeps its original ingestion time.
              }));
              const up = await sb.from("trades").upsert(rows, { onConflict: "tx_hash,log_index" });
              if (up.error) throw up.error;
            }

            // 4. Rebuild affected (wallet, onchain_id) rows via full fold.
            const pairs = new Set(trades.map((t) => `${t.wallet}|${t.onchain_id}`));
            for (const key of pairs) {
              const [wallet, midStr] = key.split("|");
              const onchain_id = Number(midStr);
              const { data: allTrades } = await sb.from("trades")
                .select("side, direction, eth_amount, token_amount, occurred_at, ingested_at")
                .eq("wallet", wallet).eq("onchain_id", onchain_id)
                .order("block_number", { ascending: true })
                .order("log_index", { ascending: true });
              // Fold in canonical chain order (block_number, log_index). The
              // reducer's `ts` becomes the belief timestamps (directional_since,
              // first_backed_at), so it must be EVENT time. During the transition
              // a not-yet-backfilled historical trade has occurred_at NULL; we
              // stand in ingested_at only so the fold has a Date, and it self-
              // corrects once the block-time backfill sets occurred_at.
              const tradeObjs: Trade[] = (allTrades ?? []).map((r) => ({
                side: r.side as "YES" | "NO",
                direction: r.direction as "BUY" | "SELL",
                token_amount: Number(r.token_amount) / 1e18,
                eth_amount: Number(r.eth_amount) / 1e18,
                ts: new Date((r.occurred_at ?? r.ingested_at) as string),
              }));
              const folded: BeliefRow = tradeObjs.reduce(applyTrade, emptyRow());
              await sb.from("wallet_beliefs").upsert({
                wallet, onchain_id,
                yes_shares: folded.yes_shares,
                no_shares: folded.no_shares,
                yes_cost: folded.yes_cost,
                no_cost: folded.no_cost,
                expressed_side: folded.expressed_side,
                directional_since: folded.directional_since?.toISOString() ?? null,
                first_backed_at: folded.first_backed_at?.toISOString() ?? null,
                last_trade_at: folded.last_trade_at?.toISOString() ?? null,
                updated_at: new Date().toISOString(),
              }, { onConflict: "wallet,onchain_id" });
            }

            // 5. Regenerate trade-driven feed_events (deterministic keys).
            if (trades.length > 0) {
              const feedRows = trades.map((t) => ({
                event_key: `trade:${t.wallet}:${t.onchain_id}:${t.tx_hash}:${t.log_index}`,
                onchain_id: Number(t.onchain_id),
                wallet: t.wallet,
                type: t.direction === "BUY" ? "backed" : "reduced",
                side: t.side,
                payload: { eth: t.eth_amount, tokens: t.token_amount },
                // Trade-driven feed events inherit the trade's canonical block
                // time — never the poller's run time. created_at (row birth) is
                // the DB default and stays operational.
                occurred_at: occurredAtFor(t.block_number, blockTimes),
              }));
              await sb.from("feed_events").upsert(feedRows, { onConflict: "event_key" });
            }

            // 6. DURABLE advance: everything up to `end` is now fully processed.
            // Commit the cursor and refresh the lease (keep owning it for the
            // rest of this run). Guarded by lease_owner so a run whose lease
            // expired and was re-claimed elsewhere cannot rewind the cursor.
            const adv = await sb.from("ingest_state")
              .update({
                last_block: Number(end),
                lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(),
              })
              .eq("id", 1).eq("lease_owner", rid)
              .select("id")
              .maybeSingle();
            if (!adv.data) {
              // Lost the lease mid-run; stop rather than double-writing.
              return Response.json({
                ok: true, from: Number(fromClamped), to: Number(cursor),
                trades: totalTrades, pairs: totalPairs, lostLease: true,
                logs_received: logsReceived, trades_decoded: tradesDecoded,
                unique_blocks_fetched: uniqueBlocksFetched, rows_upserted: totalTrades,
                rows_orphaned: rowsOrphaned,
                earliest_occurred_at: earliestOccurred, latest_occurred_at: latestOccurred,
                ms: Date.now() - started,
              });
            }
            cursor = end;
            totalTrades += trades.length;
            totalPairs += pairs.size;

            if (end < to) await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
          }

          // Release the lease (cursor already committed per-chunk above).
          await sb.from("ingest_state")
            .update({ lease_owner: null, lease_expires_at: null })
            .eq("id", 1).eq("lease_owner", rid);

          return Response.json({
            ok: true, from: Number(fromClamped), to: Number(cursor),
            trades: totalTrades, pairs: totalPairs,
            // Observability — all event-time based.
            logs_received: logsReceived, trades_decoded: tradesDecoded,
            unique_blocks_fetched: uniqueBlocksFetched, rows_upserted: totalTrades,
            rows_orphaned: rowsOrphaned,
            earliest_occurred_at: earliestOccurred, latest_occurred_at: latestOccurred,
            ms: Date.now() - started,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[chain-poller]", msg);
          await sb.from("ingest_state")
            .update({ lease_owner: null, lease_expires_at: null })
            .eq("id", 1).eq("lease_owner", rid);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
