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
import { aliasFor } from "@/lib/wallet-identity";
import { groupLiveRows, type LiveEventInput, type LiveFace, type LiveRow } from "@/lib/live-tape";

const LIVE_KINDS = ["trade", "market_created", "position_changed_side"];

const input = z
  .object({
    limit: z.number().int().min(1).max(300).optional(),
    wallet: z.string().min(3).optional(),
  })
  .optional();

/** Rewrite a row's line to lead with the viewer's network member. */
function faceLine(row: LiveRow, face: LiveFace): string {
  const label = face.relationship[0].toUpperCase() + face.relationship.slice(1);
  const who = `${face.name} (${label})`;
  if (row.kind === "side_shift") return `${who} flipped to ${row.side ?? ""}`.trim();
  const sell = (row.payload as { action?: string }).action === "SELL";
  const verb = sell ? "trimmed" : "backed";
  return `${who} ${verb} ${row.side ?? ""}`.trim();
}

export const listLiveEvents = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof input>) => input.parse(d ?? {}))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const limit = data?.limit ?? 120;
    const viewer = data?.wallet?.toLowerCase() ?? null;

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

    const live = groupLiveRows(events, ethUsd).slice(0, limit);

    // Personalize: tag rows whose sole actor is in the viewer's network with a
    // real face + name (privacy: only YOUR people are named; the crowd stays a
    // count). No new DNA compute — reads the bounded cache.
    if (viewer) {
      const { data: cache } = await sb
        .from("viewer_dna_cache")
        .select("twin_matches, tribe_matches, opp_matches, inverse_matches")
        .eq("viewer_wallet", viewer)
        .maybeSingle();
      if (cache) {
        const labelByWallet = new Map<string, LiveFace["relationship"]>();
        const add = (rows: unknown, label: LiveFace["relationship"]) => {
          for (const r of (rows as { wallet?: string }[] | null) ?? [])
            if (r.wallet) labelByWallet.set(String(r.wallet).toLowerCase(), label);
        };
        add(cache.twin_matches, "twin");
        add(cache.tribe_matches, "tribe");
        add(cache.opp_matches, "opp");
        add(cache.inverse_matches, "inverse");

        const present = [
          ...new Set(
            live
              .map((r) => r.wallet?.toLowerCase())
              .filter((w): w is string => !!w && labelByWallet.has(w)),
          ),
        ];
        if (present.length > 0) {
          const { resolveProfiles } = await import("@/lib/profiles.server");
          const profiles = await resolveProfiles(present, 10);
          for (const r of live) {
            const w = r.wallet?.toLowerCase();
            if (!w || !labelByWallet.has(w)) continue;
            const prof = profiles.get(w);
            const face: LiveFace = {
              name: prof?.displayName ?? aliasFor(w),
              avatarUrl: prof?.pfpUrl ?? null,
              relationship: labelByWallet.get(w)!,
            };
            r.face = face;
            r.text = faceLine(r, face);
          }
        }
      }
    }

    return { rows: live, error: null };
  });
