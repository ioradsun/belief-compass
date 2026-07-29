/**
 * Live tape — server loader. Reads canonical `events` in reverse-chronological
 * order (occurred_at DESC, block DESC, log DESC — never ingested_at), excludes
 * reorg-orphaned events (is_canonical), groups bursts via the pure live-tape
 * module, then turns each row into a FOMO-shaped story via composeLiveStory:
 *   "John joined the YES army for $25 — YES is heating up, 12 joined this hour"
 * The actor is named from pov.co (alias fallback); the momentum clause comes from
 * market_state; the relationship tag ("(Twin)") is added when signed in. Multi-
 * wallet bursts read as the crowd. Live answers "what just happened?" — never ranked.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { groupLiveRows, type LiveEventInput, type LiveFace, type LiveRow } from "@/lib/live-tape";
import { composeLiveStory, type LiveStoryInput } from "@/domain/story";

type NetLabel = "twin" | "tribe" | "opp" | "inverse";

const LIVE_KINDS = [
  "trade",
  "market_created",
  "position_changed_side",
  "believer_milestone",
  "tribe_doubled",
];

const input = z
  .object({
    limit: z.number().int().min(1).max(300).optional(),
    wallet: z.string().min(3).optional(),
    /** Scope the tape to specific markets (center deck, position rows). */
    marketIds: z.array(z.number().int()).min(1).max(60).optional(),
  })
  .optional();

type Momentum = NonNullable<LiveStoryInput["market"]>;

export const listLiveEvents = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof input>) => input.parse(d ?? {}))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const limit = data?.limit ?? 120;
    const viewer = data?.wallet?.toLowerCase() ?? null;

    const scope = data?.marketIds?.map((n) => String(n)) ?? null;
    let q = sb
      .from("events")
      // NOTE: the full `payload` (raw_log) is deliberately NOT selected — the raw
      // log is pure over-the-wire weight for limit*3 rows. We select only the one
      // JSON sub-field a milestone row needs (its threshold), which is tiny.
      .select(
        "source_key, kind, market_id, side, action, amount_eth, wallet, occurred_at, block_number, log_index, milestone_threshold:payload->>threshold",
      )
      .eq("is_canonical", true)
      .in("kind", LIVE_KINDS);
    if (scope) q = q.in("market_id", scope);
    const { data: rows, error } = await q
      .order("occurred_at", { ascending: false })
      .order("block_number", { ascending: false, nullsFirst: false })
      .order("log_index", { ascending: false, nullsFirst: false })
      .limit(limit * 3); // over-read so grouping still yields ~limit rows
    if (error) return { rows: [] as LiveRow[], error: error.message };

    const marketIds = [...new Set((rows ?? []).map((r) => Number(r.market_id)))];
    const titleById = new Map<number, string>();
    const momentumById = new Map<number, Momentum>();
    if (marketIds.length > 0) {
      const [mk, ms] = await Promise.all([
        sb.from("markets").select("onchain_id, title").in("onchain_id", marketIds),
        sb
          .from("market_state")
          .select(
            "onchain_id, believers_yes, believers_no, new_believers_1h, money_yes_pct, people_yes_pct, opportunity_type",
          )
          .in("onchain_id", marketIds),
      ]);
      for (const m of mk.data ?? []) titleById.set(Number(m.onchain_id), (m.title as string) ?? "");
      for (const s of ms.data ?? []) {
        const r = s as Record<string, unknown>;
        momentumById.set(Number(r.onchain_id), {
          believersYes: (r.believers_yes as number | null) ?? null,
          believersNo: (r.believers_no as number | null) ?? null,
          newBackers1h: (r.new_believers_1h as number | null) ?? null,
          moneyYesPct: (r.money_yes_pct as number | null) ?? null,
          peopleYesPct: (r.people_yes_pct as number | null) ?? null,
          opportunityType: (r.opportunity_type as string | null) ?? null,
        });
      }
    }

    // ETH/USD comes from the cron-refreshed snapshot (calc_cache), NOT the live
    // eth_usd_calibration() aggregate — that RPC scans the entire events trade
    // history joined to market_state on every load. Same value listFeed reads.
    const { data: cal } = await sb
      .from("calc_cache")
      .select("value")
      .eq("key", "eth_usd")
      .maybeSingle();
    const ethUsd = Number((cal as { value?: number } | null)?.value ?? 0) || 0;

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
      // System milestones carry their threshold in payload so the copy can render
      // it; trades keep payload null (their raw_log was never fetched).
      payload:
        r.kind === "believer_milestone"
          ? { threshold: Number((r as Record<string, unknown>).milestone_threshold ?? 0) }
          : null,
    }));

    const live = groupLiveRows(events, ethUsd).slice(0, limit);

    // Turn each row into a story. Single-actor rows get named (pov.co, alias
    // fallback) + a relationship tag when the actor is in the viewer's network;
    // bursts read as the crowd. The momentum clause comes from market_state.
    const actorWallets = [
      ...new Set(
        live
          .filter((r) => r.kind !== "market_created")
          .map((r) => r.wallet?.toLowerCase())
          .filter((w): w is string => !!w),
      ),
    ];

    const labelByWallet = new Map<string, NetLabel>();
    if (viewer && actorWallets.length > 0) {
      const { serviceClient } = await import("@/lib/supabase-clients");
      const { data: cache } = await serviceClient()
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

    const profiles =
      actorWallets.length > 0
        ? await import("@/lib/profiles.server").then((m) => m.resolveProfiles(actorWallets, 15))
        : new Map();

    for (const r of live) {
      // System rows already carry their final factual copy (no actor to name).
      if (
        r.kind === "market_created" ||
        r.kind === "believer_milestone" ||
        r.kind === "tribe_doubled"
      )
        continue;
      const market = momentumById.get(Number(r.marketId)) ?? null;
      const action = (r.payload as { action?: "BUY" | "SELL" }).action ?? null;
      const w = r.wallet?.toLowerCase();

      if (w) {
        const prof = profiles.get(w);
        const relationship = labelByWallet.get(w) ?? null;
        const face: LiveFace = {
          name: prof?.displayName ?? aliasFor(w),
          avatarUrl: prof?.pfpUrl ?? null,
          relationship,
        };
        r.face = face;
        if (r.kind === "round_trip") {
          // In and out at the same size — one honest line, not a mirrored pair.
          const amt =
            r.amountUsd && r.amountUsd > 0
              ? ` $${
                  r.amountUsd >= 1000
                    ? r.amountUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })
                    : r.amountUsd.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                }`
              : "";

          r.text = `${face.name} round-tripped${amt} on ${r.side ?? ""}`.trim();
          continue;
        }
        r.text = composeLiveStory({
          actor: { name: face.name, relationship },
          side: r.side,
          action,
          flip: r.kind === "side_shift",
          amountUsd: r.amountUsd,
          market,
        }).text;
      } else {
        // Multi-wallet burst — the crowd.
        r.text = composeLiveStory({
          actor: null,
          walletCount: r.walletCount,
          side: r.side,
          action,
          amountUsd: r.amountUsd,
          market,
        }).text;
      }
    }

    return { rows: live, error: null };
  });
