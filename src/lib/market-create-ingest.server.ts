/**
 * Immediate ingest of a market-creation transaction.
 *
 * A market born here is seeded with the creator's own ETH in the SAME tx that
 * creates it. That seed is a real canonical trade — but the chain poller only
 * sees it on its next tick, so for the first minute the market the creator just
 * landed on reads $0 capital / 0 believers, which looks broken.
 *
 * This reads the creation receipt directly, builds the SAME deterministic
 * canonical events the poller would build (identical source_key, so the poller
 * later replays them as a no-op), applies positions incrementally and returns.
 * Purely additive: never orphans, never advances the ingest cursor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBaseClient } from "@/chain/client";
import { decodeTradeLog, PROXY_ADDRESS, CHAIN_ID, type CanonicalTrade } from "@/chain/decoder";
import { tradeEventFromCanonical } from "@/lib/events";
import { applyCanonicalTradeEvents } from "@/lib/positions/apply-events.server";

export interface CreationIngestResult {
  events: number;
  pairs: number;
  applied: number;
}

export async function ingestCreationTx(
  sb: SupabaseClient,
  txHash: string,
  marketId: number,
): Promise<CreationIngestResult> {
  const client = getBaseClient();
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  const trades: CanonicalTrade[] = [];
  for (const log of receipt.logs) {
    if (String(log.address).toLowerCase() !== PROXY_ADDRESS) continue;
    const t = decodeTradeLog(log);
    if (t && Number(t.onchain_id) === Number(marketId)) trades.push(t);
  }
  if (trades.length === 0) return { events: 0, pairs: 0, applied: 0 };

  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const occurredAt = new Date(Number(block.timestamp) * 1000).toISOString();
  const rows = trades.map((t) => tradeEventFromCanonical(t, CHAIN_ID, occurredAt));

  const { error } = await sb
    .from("events")
    .upsert(rows, { onConflict: "source_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);

  const pairs = [
    ...new Map(
      trades.map((t) => [
        `${t.wallet.toLowerCase()}|${Number(t.onchain_id)}`,
        { wallet: t.wallet.toLowerCase(), market: Number(t.onchain_id) },
      ]),
    ).values(),
  ];
  const applied = await applyCanonicalTradeEvents(sb, pairs);
  if (applied.application_failures > 0 || applied.positions_marked_dirty > 0) {
    throw new Error(
      `Opening position was not applied (${applied.application_failures} failures, ${applied.positions_marked_dirty} dirty)`,
    );
  }
  if (applied.events_applied === 0 && applied.events_replayed === 0) {
    throw new Error("Opening position application produced no durable result");
  }
  return {
    events: rows.length,
    pairs: pairs.length,
    applied: applied.events_applied,
  };
}
