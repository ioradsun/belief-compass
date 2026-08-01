/**
 * A wallet's full canonical trade history in CHRONOLOGICAL order — the input to
 * the realized-P&L fold. Reads `events` (the one trade source of truth), bounded,
 * ascending by canonical order so the weighted-average basis folds correctly.
 */
import type { serviceClient } from "@/lib/supabase-clients";

export interface DashTradeRow {
  market_id: string | null;
  side: string | null;
  action: string | null;
  amount_eth: string | number | null;
  shares: string | number | null;
  occurred_at: string;
}

const MAX_TRADES = 5000;

export async function readWalletTradesAscending(
  sb: ReturnType<typeof serviceClient>,
  wallet: string,
): Promise<DashTradeRow[]> {
  const { data, error } = await sb
    .from("events")
    .select("market_id, side, action, amount_eth, shares, occurred_at, block_number, log_index")
    .eq("is_canonical", true)
    .eq("kind", "trade")
    .eq("wallet", wallet.toLowerCase())
    .order("occurred_at", { ascending: true })
    .order("block_number", { ascending: true, nullsFirst: true })
    .order("log_index", { ascending: true, nullsFirst: true })
    .limit(MAX_TRADES);
  if (error) return [];
  return (data ?? []) as DashTradeRow[];
}
