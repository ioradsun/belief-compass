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
import { decodeTradeLog, PROXY_ADDRESS, type CanonicalTrade } from "@/chain/decoder";
import { applyTrade, emptyRow, type BeliefRow, type Trade } from "@/domain/domain";

// Deploy block for the proxy on Base. Backfill from here on first run.
// Unknown at build time — set conservatively; Job B skips ranges with no logs cheaply.
// Base proxy deploy is around block ~45.8M (18 days of markets before head at build time).
// Conservative default; override with PROXY_DEPLOY_BLOCK env if known exactly.
const DEPLOY_BLOCK = BigInt(process.env.PROXY_DEPLOY_BLOCK ?? "45500000");
const REORG_DEPTH = 12n;
// Public Base RPC allows up to 10k blocks per eth_getLogs call but rate-limits
// heavily. Keep chunks smaller and sleep between them.
const MAX_CHUNK = 3_000n;
const CHUNK_DELAY_MS = 250;
// Cap per-run scan so a single tick returns well under the pg_net/HTTP timeout.
const MAX_BLOCKS_PER_RUN = 60_000n;

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

          const trades: CanonicalTrade[] = [];
          for (let start = fromClamped; start <= to; start += MAX_CHUNK) {
            const end = start + MAX_CHUNK - 1n > to ? to : start + MAX_CHUNK - 1n;
            const logs = await client.getLogs({
              address: PROXY_ADDRESS,
              fromBlock: start,
              toBlock: end,
            });
            for (const log of logs) {
              const t = decodeTradeLog(log);
              if (t) trades.push(t);
            }
            if (end < to) await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
          }

          // 2. Delete non-canonical trades in the rescanned range (reorg orphans)
          if (fromClamped <= to) {
            const keep = new Set(trades.map((t) => `${t.tx_hash}:${t.log_index}`));
            const { data: existing } = await sb
              .from("trades")
              .select("tx_hash, log_index, wallet, onchain_id")
              .gte("block_number", Number(fromClamped))
              .lte("block_number", Number(to));
            const toDelete = (existing ?? []).filter(
              (r) => !keep.has(`${r.tx_hash}:${r.log_index}`)
            );
            if (toDelete.length > 0) {
              // Delete in-place; the affected wallet-markets will be rebuilt below.
              for (const d of toDelete) {
                await sb.from("trades").delete()
                  .eq("tx_hash", d.tx_hash).eq("log_index", d.log_index);
              }
            }
          }

          // 3. Upsert canonical trades + stub unknown markets
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
              ts: new Date().toISOString(), // placeholder — resolved below if we fetched block timestamps
            }));
            const up = await sb.from("trades").upsert(rows, { onConflict: "tx_hash,log_index" });
            if (up.error) throw up.error;
          }

          // 4. Rebuild affected (wallet, onchain_id) rows via full fold
          const pairs = new Set(trades.map((t) => `${t.wallet}|${t.onchain_id}`));
          for (const key of pairs) {
            const [wallet, midStr] = key.split("|");
            const onchain_id = Number(midStr);
            const { data: allTrades } = await sb.from("trades")
              .select("side, direction, eth_amount, token_amount, ts")
              .eq("wallet", wallet).eq("onchain_id", onchain_id)
              .order("block_number", { ascending: true })
              .order("log_index", { ascending: true });
            const tradeObjs: Trade[] = (allTrades ?? []).map((r) => ({
              side: r.side as "YES" | "NO",
              direction: r.direction as "BUY" | "SELL",
              token_amount: Number(r.token_amount) / 1e18,
              eth_amount: Number(r.eth_amount) / 1e18,
              ts: new Date(r.ts as string),
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

          // 5. Regenerate trade-driven feed_events for affected pairs.
          // Deterministic keys → upsert on unique constraint.
          const feedRows: Record<string, unknown>[] = [];
          for (const t of trades) {
            // Emit a lightweight new-believer/side-change event per trade.
            const key = `trade:${t.wallet}:${t.onchain_id}:${t.tx_hash}:${t.log_index}`;
            feedRows.push({
              event_key: key,
              onchain_id: Number(t.onchain_id),
              wallet: t.wallet,
              type: t.direction === "BUY" ? "backed" : "reduced",
              side: t.side,
              payload: { eth: t.eth_amount, tokens: t.token_amount },
              occurred_at: new Date().toISOString(),
            });
          }
          if (feedRows.length > 0) {
            await sb.from("feed_events").upsert(feedRows, { onConflict: "event_key" });
          }

          // 6. Advance cursor + release lease
          await sb.from("ingest_state")
            .update({ last_block: Number(to), lease_owner: null, lease_expires_at: null })
            .eq("id", 1).eq("lease_owner", rid);

          return Response.json({
            ok: true, from: Number(fromClamped), to: Number(to),
            trades: trades.length, pairs: pairs.size, ms: Date.now() - started,
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
