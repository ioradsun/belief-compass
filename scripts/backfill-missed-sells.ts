/**
 * ONE-OFF REPAIR — the sells the indexer never saw.
 *
 * The proxy's implementation was upgraded and `TokensSold` gained a fee
 * breakdown, changing its topic0. The pinned ABI still described the old shape,
 * so every sell emitted by the new implementation decoded to null and was
 * dropped. Buys kept landing, so positions grew and never shrank: Positions
 * showed shares the chain had already burned.
 *
 * `src/chain/decoder.ts` now knows both shapes. This walks history once, and for
 * every block range that contains a previously-undecodable sell it re-runs the
 * SAME chunk ingest the poller runs — complete `present_keys` for the range, so
 * nothing is wrongly orphaned — then rebuilds the affected positions from
 * canonical events rather than reversing anything algebraically.
 *
 *   bun run scripts/backfill-missed-sells.ts [fromBlock] [toBlock]
 */
import { getBaseClient } from "../src/chain/client";
import { getServiceSupabase } from "../src/lib/service-supabase.server";
import { decodeTradeLog, PROXY_ADDRESS, TRADE_EVENTS, CHAIN_ID } from "../src/chain/decoder";
import type { CanonicalTrade } from "../src/chain/decoder";
import { uniqueBlockNumbers, fetchBlockTimes, occurredAtFor } from "../src/lib/block-time";
import { tradeEventFromCanonical, chainTradeSourceKey } from "../src/lib/events";
import { rebuildPosition } from "../src/lib/positions/rebuild-position.server";

const CHUNK = 2000n;

async function main() {
  const client = getBaseClient();
  const sb = getServiceSupabase();
  const head = await client.getBlockNumber();
  const from = BigInt(process.argv[2] ?? "45500000");
  const to = BigInt(process.argv[3] ?? String(head));

  let scanned = 0;
  let inserted = 0;
  const pairs = new Set<string>();

  for (let start = from; start <= to; start += CHUNK) {
    const end = start + CHUNK - 1n > to ? to : start + CHUNK - 1n;
    const logs = await client.getLogs({
      address: PROXY_ADDRESS,
      events: TRADE_EVENTS,
      fromBlock: start,
      toBlock: end,
    });
    scanned += logs.length;
    if (logs.length === 0) continue;

    const trades: CanonicalTrade[] = [];
    for (const log of logs) {
      const t = decodeTradeLog(log);
      if (t) trades.push(t);
    }
    if (trades.length === 0) continue;

    const keys = trades.map((t) => chainTradeSourceKey(CHAIN_ID, t.tx_hash, t.log_index));
    // Only pay for a chunk that is actually missing something.
    const { data: known } = await sb.from("events").select("source_key").in("source_key", keys);
    const have = new Set((known ?? []).map((r) => (r as { source_key: string }).source_key));
    if (keys.every((k) => have.has(k))) continue;

    const blockTimes = await fetchBlockTimes(
      uniqueBlockNumbers(trades),
      async (b) => Number((await client.getBlock({ blockNumber: BigInt(b) })).timestamp),
      5,
    );
    const eventRows = [];
    for (const t of trades) {
      const occ = occurredAtFor(t.block_number, blockTimes);
      if (!occ) continue;
      eventRows.push(tradeEventFromCanonical(t, CHAIN_ID, occ));
    }

    await sb
      .from("markets")
      .upsert(
        [...new Set(trades.map((t) => Number(t.onchain_id)))].map((onchain_id) => ({ onchain_id })),
        { onConflict: "onchain_id", ignoreDuplicates: true },
      );

    const ing = await sb.rpc("ingest_chain_chunk", {
      p_events: eventRows,
      p_present_keys: keys,
      p_chain_id: CHAIN_ID,
      p_start: Number(start),
      p_end: Number(end),
    });
    if (ing.error) throw ing.error;
    const r = (ing.data ?? {}) as { events_inserted?: number; pairs?: [string, string][] };
    inserted += r.events_inserted ?? 0;
    for (const [w, m] of r.pairs ?? []) pairs.add(`${w}|${m}`);
    console.log(`${start}-${end}: +${r.events_inserted ?? 0} events`);
  }

  // Repair every touched position from complete canonical history.
  for (const key of pairs) {
    const [wallet, market] = key.split("|");
    await rebuildPosition(sb, wallet, Number(market));
  }
  console.log({ scanned, inserted, rebuilt: pairs.size });
}

await main();
