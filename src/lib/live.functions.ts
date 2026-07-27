/**
 * Live tape — server loader. Reads canonical `events` in reverse-chronological
 * order (occurred_at DESC, block DESC, log DESC — never ingested_at), excludes
 * reorg-orphaned events (is_canonical), joins market titles, and groups bursts via
 * the pure live-tape module. Returns the compact LiveRow DTO. No ranking, no
 * personalization — Live answers "what just happened?".
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicClient } from "@/lib/supabase-clients";
import { groupLiveRows, type LiveEventInput, type LiveRow } from "@/lib/live-tape";

const LIVE_KINDS = ["trade", "market_created", "position_changed_side"];

const input = z.object({ limit: z.number().int().min(1).max(300).optional() }).optional();

export const listLiveEvents = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof input>) => input.parse(d ?? {}))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const limit = data?.limit ?? 120;

    const { data: rows, error } = await sb
      .from("events")
      .select(
        "source_key, kind, market_id, side, action, amount_eth, wallet, occurred_at, block_number, log_index, payload",
      )
      .eq("is_canonical", true)
      .in("kind", LIVE_KINDS)
      .order("occurred_at", { ascending: false })
      .order("block_number", { ascending: false, nullsFirst: false })
      .order("log_index", { ascending: false, nullsFirst: false })
      .limit(limit * 3); // over-read so grouping still yields ~limit rows
    if (error) return { rows: [] as LiveRow[], error: error.message };

    const marketIds = [...new Set((rows ?? []).map((r) => Number(r.market_id)))];
    const titleById = new Map<number, string>();
    if (marketIds.length > 0) {
      const { data: mk } = await sb
        .from("markets")
        .select("onchain_id, title")
        .in("onchain_id", marketIds);
      for (const m of mk ?? []) titleById.set(Number(m.onchain_id), (m.title as string) ?? "");
    }

    const { data: eth } = await sb.rpc("eth_usd_calibration");
    const ethUsd = Number(eth ?? 0) || 0;

    const events: LiveEventInput[] = (rows ?? []).map((r) => ({
      source_key: r.source_key as string,
      kind: r.kind as string,
      market_id: String(r.market_id),
      market_title: titleById.get(Number(r.market_id)) ?? null,
      occurred_at: r.occurred_at as string,
      block_number: r.block_number as number | null,
      log_index: r.log_index as number | null,
      side: (r.side as "YES" | "NO" | null) ?? null,
      action: (r.action as "BUY" | "SELL" | null) ?? null,
      amount_eth: Number(r.amount_eth ?? 0) / 1e18,
      wallet: (r.wallet as string) ?? null,
      payload: (r.payload as Record<string, unknown>) ?? null,
    }));

    return { rows: groupLiveRows(events, ethUsd).slice(0, limit), error: null };
  });
