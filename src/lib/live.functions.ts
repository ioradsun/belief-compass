/**
 * Live tape — server loader. Reads canonical `events` in reverse-chronological
 * order (occurred_at DESC, block DESC, log DESC — never ingested_at), excludes
 * reorg-orphaned events (is_canonical), joins market titles, and groups bursts via
 * the pure live-tape module. Every single-actor row is named (pov.co identity,
 * generated-alias fallback) so the tape reads like people — "John backed YES ·
 * $74" — not "1 wallet". When the actor is in the viewer's network the line also
 * carries their relationship ("Maya (Twin) …"). Multi-wallet bursts stay an
 * anonymous count. Live answers "what just happened?" — never ranked.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { groupLiveRows, type LiveEventInput, type LiveFace, type LiveRow } from "@/lib/live-tape";

type NetLabel = "twin" | "tribe" | "opp" | "inverse";

const LIVE_KINDS = ["trade", "market_created", "position_changed_side"];

const input = z
  .object({
    limit: z.number().int().min(1).max(300).optional(),
    wallet: z.string().min(3).optional(),
  })
  .optional();

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Rewrite a single-actor row to lead with the person + their side + amount. */
function personLine(row: LiveRow, name: string, relationship: NetLabel | null): string {
  const who = relationship ? `${name} (${cap(relationship)})` : name;
  const amt =
    row.amountUsd && row.amountUsd > 0
      ? ` · $${Math.round(row.amountUsd).toLocaleString("en-US")}`
      : "";
  if (row.kind === "side_shift") return `${who} flipped to ${row.side ?? ""}`.trim();
  const sell = (row.payload as { action?: string }).action === "SELL";
  const verb = sell ? "reduced" : "backed";
  return `${who} ${verb} ${row.side ?? ""}${amt}`.trim();
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

    // Name every single-actor row so the tape reads like people. `wallet` is set
    // only on single-actor rows (bursts stay a count). Relationship tags come
    // from the viewer's bounded DNA cache when signed in — no new compute.
    const actorWallets = [
      ...new Set(
        live
          .filter((r) => r.kind !== "market_created")
          .map((r) => r.wallet?.toLowerCase())
          .filter((w): w is string => !!w),
      ),
    ];
    if (actorWallets.length > 0) {
      const labelByWallet = new Map<string, NetLabel>();
      if (viewer) {
        const { data: cache } = await sb
          .from("viewer_dna_cache")
          .select("twin_matches, tribe_matches, opp_matches, inverse_matches")
          .eq("viewer_wallet", viewer)
          .maybeSingle();
        if (cache) {
          const add = (rows: unknown, label: NetLabel) => {
            for (const r of (rows as { wallet?: string }[] | null) ?? [])
              if (r.wallet) labelByWallet.set(String(r.wallet).toLowerCase(), label);
          };
          add(cache.twin_matches, "twin");
          add(cache.tribe_matches, "tribe");
          add(cache.opp_matches, "opp");
          add(cache.inverse_matches, "inverse");
        }
      }

      const { resolveProfiles } = await import("@/lib/profiles.server");
      const profiles = await resolveProfiles(actorWallets, 15);
      for (const r of live) {
        const w = r.wallet?.toLowerCase();
        if (!w || r.kind === "market_created") continue;
        const prof = profiles.get(w);
        const relationship = labelByWallet.get(w) ?? null;
        const face: LiveFace = {
          name: prof?.displayName ?? aliasFor(w),
          avatarUrl: prof?.pfpUrl ?? null,
          relationship,
        };
        r.face = face;
        r.text = personLine(r, face.name, relationship);
      }
    }

    return { rows: live, error: null };
  });
