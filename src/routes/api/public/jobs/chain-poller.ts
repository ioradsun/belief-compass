/**
 * Job B — chain poller. Bearer-guarded.
 * - Acquires expiring lease on ingest_state.
 * - Reads Base logs for the proxy from max(last_block-12, deploy) → head.
 * - Builds deterministic canonical `events` and persists them ATOMICALLY via the
 *   ingest_chain_chunk() DB function, which in one transaction also maintains the
 *   temporary `trades` projection and reconciles reorg orphans.
 * - Phase 3: advances affected wallet_beliefs INCREMENTALLY — apply only the new
 *   canonical events on top of the current position (exactly once), never
 *   refolding full history. Reorg-orphaned pairs are marked needs_rebuild.
 * - Atomically advances cursor + clears lease.
 *
 * Phase 2: `events` is the source of truth. A chain trade is NO LONGER written to
 * feed_events — chronological reads come from `events` (see events.functions.ts).
 * `trades` remains ONLY as a compatibility projection for the position reducer +
 * belief rollup, maintained inside ingest_chain_chunk().
 */
import { createFileRoute } from "@tanstack/react-router";
import { getServiceSupabase, assertIngestBearer } from "@/lib/service-supabase.server";
import { getBaseClient } from "@/chain/client";
import {
  decodeTradeLog,
  PROXY_ADDRESS,
  TRADE_EVENTS,
  CHAIN_ID,
  type CanonicalTrade,
} from "@/chain/decoder";
import { uniqueBlockNumbers, fetchBlockTimes, occurredAtFor } from "@/lib/block-time";
import {
  tradeEventFromCanonical,
  chainTradeSourceKey,
  type ChainTradeEventInput,
} from "@/lib/events";
import { applyCanonicalTradeEvents } from "@/lib/positions/apply-events.server";

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
          let earliestOccurred: string | null = null;
          let latestOccurred: string | null = null;
          // Canonical-event ingest counters (from ingest_chain_chunk).
          let eventsInserted = 0;
          let eventsReplayed = 0;
          let eventsRestored = 0;
          let eventsOrphaned = 0;
          let tradeProjInserted = 0;
          let tradeProjRemoved = 0;
          let tradesDeferredNoBlockTime = 0;
          // Phase 3 incremental position counters.
          let positionEventsApplied = 0;
          let positionEventsReplayed = 0;
          let positionsCreated = 0;
          let positionsUpdated = 0;
          let positionsMarkedDirty = 0;
          let positionVersionConflicts = 0;
          let positionsOutOfOrder = 0;
          let fullHistoryReadsHotPath = 0;
          let marketsMarkedDirty = 0;

          // Canonical-event-based observability, emitted on every return path.
          const observability = () => ({
            logs_received: logsReceived,
            trades_decoded: tradesDecoded,
            unique_blocks_fetched: uniqueBlocksFetched,
            events_inserted: eventsInserted,
            events_replayed: eventsReplayed,
            events_restored: eventsRestored,
            events_orphaned: eventsOrphaned,
            trade_projections_inserted: tradeProjInserted,
            trade_projections_removed: tradeProjRemoved,
            trades_deferred_no_block_time: tradesDeferredNoBlockTime,
            position_events_applied: positionEventsApplied,
            position_events_replayed: positionEventsReplayed,
            positions_created: positionsCreated,
            positions_updated: positionsUpdated,
            positions_marked_dirty: positionsMarkedDirty,
            position_version_conflicts: positionVersionConflicts,
            positions_out_of_order: positionsOutOfOrder,
            full_history_reads_hot_path: fullHistoryReadsHotPath,
            markets_marked_dirty: marketsMarkedDirty,
            earliest_occurred_at: earliestOccurred,
            latest_occurred_at: latestOccurred,
          });

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

            // 2. Stub unknown markets so downstream joins/FKs resolve.
            if (trades.length > 0) {
              const marketIds = new Set(trades.map((t) => t.onchain_id));
              const marketStubs = [...marketIds].map((id) => ({ onchain_id: Number(id) }));
              await sb.from("markets").upsert(marketStubs, { onConflict: "onchain_id", ignoreDuplicates: true });
            }

            // 3. Build deterministic canonical events and persist them ATOMICALLY.
            //    ingest_chain_chunk() inserts/reconciles the events, maintains the
            //    trades compatibility projection, and marks reorg orphans — all in
            //    one transaction — then returns the affected (wallet, market) pairs.
            //    We only build events for trades we could timestamp; the full set
            //    of canonical keys (present_keys) still protects a transiently
            //    un-timestamped trade from being wrongly orphaned.
            const presentKeys = trades.map((t) =>
              chainTradeSourceKey(CHAIN_ID, t.tx_hash, t.log_index),
            );
            const eventRows: ChainTradeEventInput[] = [];
            for (const t of trades) {
              const occ = occurredAtFor(t.block_number, blockTimes);
              if (!occ) {
                tradesDeferredNoBlockTime += 1; // retried on a later overlap scan
                continue;
              }
              eventRows.push(tradeEventFromCanonical(t, CHAIN_ID, occ));
            }

            const affectedPairs = new Set<string>();
            let orphanPairs: [string, number][] = [];
            if (presentKeys.length > 0) {
              const ing = await sb.rpc("ingest_chain_chunk", {
                p_events: eventRows,
                p_present_keys: presentKeys,
                p_chain_id: CHAIN_ID,
                p_start: Number(start),
                p_end: Number(end),
              });
              if (ing.error) throw ing.error;
              const r = (ing.data ?? {}) as {
                events_inserted?: number;
                events_replayed?: number;
                events_restored?: number;
                events_orphaned?: number;
                trade_projections_inserted?: number;
                trade_projections_removed?: number;
                pairs?: [string, string][];
                orphan_pairs?: [string, string][];
              };
              eventsInserted += r.events_inserted ?? 0;
              eventsReplayed += r.events_replayed ?? 0;
              eventsRestored += r.events_restored ?? 0;
              eventsOrphaned += r.events_orphaned ?? 0;
              tradeProjInserted += r.trade_projections_inserted ?? 0;
              tradeProjRemoved += r.trade_projections_removed ?? 0;
              for (const [w, m] of r.pairs ?? []) affectedPairs.add(`${w}|${m}`);

              // Reorg: orphaned pairs are rebuilt (never algebraically reversed).
              // Mark them needs_rebuild='reorg' so the incremental applier skips
              // them and the targeted rebuilder folds remaining canonical history.
              orphanPairs = (r.orphan_pairs ?? []).map(([w, mm]) => [w, Number(mm)] as [string, number]);
            }

            // 4. INCREMENTAL position application (Phase 3). Instead of reloading
            //    and refolding each pair's FULL trade history, apply only the new
            //    canonical events on top of the current position, exactly once.
            //    Reorg-orphaned pairs are marked dirty first so the applier skips
            //    them; the rest advance incrementally (replays are no-ops).
            if (orphanPairs.length > 0) {
              await sb.rpc("mark_positions_dirty", {
                p_pairs: orphanPairs.map(([w, mm]) => [w, String(mm)]),
                p_reason: "reorg",
              });
              positionsMarkedDirty += orphanPairs.length;
            }
            const applyPairs = [...affectedPairs].map((k) => {
              const [wallet, midStr] = k.split("|");
              return { wallet, market: Number(midStr) };
            });
            if (applyPairs.length > 0) {
              const pm = await applyCanonicalTradeEvents(sb, applyPairs);
              positionEventsApplied += pm.events_applied;
              positionEventsReplayed += pm.events_replayed;
              positionsCreated += pm.positions_created;
              positionsUpdated += pm.positions_updated;
              positionsMarkedDirty += pm.positions_marked_dirty;
              positionVersionConflicts += pm.version_conflicts;
              positionsOutOfOrder += pm.events_out_of_order;
              fullHistoryReadsHotPath += pm.full_history_reads_hot_path; // must stay 0
            }

            // 4b. Mark the read model dirty for every market touched this chunk
            //     (activity from the new trades + positions from the applies).
            //     Coalesced per market — never one queue row per trade.
            const dirtyMarkets = [
              ...new Set([
                ...applyPairs.map((p) => p.market),
                ...orphanPairs.map(([, mm]) => mm),
              ]),
            ];
            if (dirtyMarkets.length > 0) {
              await sb.rpc("enqueue_market_refresh", { p_market_ids: dirtyMarkets, p_kind: "activity" });
              await sb.rpc("enqueue_market_refresh", { p_market_ids: dirtyMarkets, p_kind: "positions" });
              marketsMarkedDirty += dirtyMarkets.length;
            }

            // 5. (removed) Trade-driven feed_events are no longer written. The
            //    canonical `events` row created in step 3 is the single fact;
            //    chronological reads come from events.functions.ts. Writing a
            //    feed_events row here would duplicate the same trade.

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
                ...observability(),
                ms: Date.now() - started,
              });
            }
            cursor = end;
            totalTrades += eventRows.length;
            totalPairs += affectedPairs.size;

            if (end < to) await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
          }

          // Release the lease (cursor already committed per-chunk above).
          await sb.from("ingest_state")
            .update({ lease_owner: null, lease_expires_at: null })
            .eq("id", 1).eq("lease_owner", rid);

          return Response.json({
            ok: true, from: Number(fromClamped), to: Number(cursor),
            trades: totalTrades, pairs: totalPairs,
            ...observability(),
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
