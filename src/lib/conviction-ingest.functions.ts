/**
 * On-connect conviction ingest — POV positions as the source of truth.
 *
 * A POV user has already "answered questions", so POV holds their positions
 * directly. Rather than wait for the chain indexer's backfill to crawl to a
 * wallet, this resolves the wallet's POV account, pulls its current positions
 * (side + shares + value), and computes conviction immediately — for ANY user,
 * in one round-trip. The chain indexer stays as a background enrichment that
 * later fills the on-chain-only fields (directional_since → days_held, cost
 * basis, realized/unrealized P&L); it is no longer on the critical path.
 *
 * Honesty: POV /positions carries no entry date, so a freshly-ingested position
 * has an unknown hold time → daysHeld 0 → persistence 0 (conviction floor only).
 * When the chain job later sets directional_since we preserve it here and the
 * number rises truthfully. We never invent a hold time we can't prove.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { classifyByShares, convictionFromValues } from "@/domain/domain";
import { fetchPovUser, fetchPovPositions } from "@/lib/pov.server";
import { publicClient, serviceClient } from "@/lib/supabase-clients";

interface Existing {
  directional_since: string | null;
  first_backed_at: string | null;
  last_trade_at: string | null;
  yes_cost: number;
  no_cost: number;
}

export const ensureConviction = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string }) => z.object({ wallet: z.string().min(4) }).parse(d))
  .handler(async ({ data }) => {
    const connected = data.wallet.toLowerCase();

    // 1. Resolve the canonical POV account. POV keys users by wallet address, so
    //    the returned walletAddress is the account's trading wallet — use it as
    //    the viewer key. A 404 means no POV account; fall back to the raw address.
    let povUser = null;
    try {
      povUser = await fetchPovUser(connected);
    } catch {
      /* transient — treat as unresolved, feed still works at raw address */
    }
    const viewer = (povUser?.walletAddress ?? connected).toLowerCase();
    const profile = povUser
      ? {
          displayName: povUser.displayName ?? null,
          pfpUrl: povUser.pfpUrl ?? null,
          username: povUser.username ?? null,
        }
      : null;

    // 2. Pull current positions from POV (source of truth for holdings).
    let positions: Awaited<ReturnType<typeof fetchPovPositions>> = [];
    try {
      positions = await fetchPovPositions(viewer);
    } catch {
      positions = [];
    }

    const sb = publicClient();
    const svc = serviceClient();

    // Matching is the heavy part (a candidate scan), so it does NOT run on this
    // connect path. We enqueue the wallet and let the background match-worker
    // compute + cache wallet_matches; the feed reads that cache and refetches, so
    // People/Opp light up within ~a minute without blocking connect. We still
    // report the CURRENT cache so a returning user sees their People instantly.
    const finish = async (positionCount: number, marketCount: number) => {
      try {
        await svc
          .from("match_queue")
          .upsert(
            { wallet: viewer, enqueued_at: new Date().toISOString(), pending: true },
            { onConflict: "wallet" },
          );
      } catch {
        /* best-effort enqueue; the on-demand path still recomputes when needed */
      }
      const { count } = await sb
        .from("wallet_matches")
        .select("*", { count: "exact", head: true })
        .eq("wallet", viewer);
      return {
        viewer,
        connected,
        profile,
        positionCount,
        marketCount,
        hasPeople: (count ?? 0) > 0,
        matchesPending: true,
        resolved: Boolean(povUser),
      };
    };

    // Cache the POV profile so the feed can show the pic/name immediately.
    if (povUser) {
      try {
        await svc.from("profiles").upsert(
          {
            wallet: viewer,
            username: povUser.username ?? null,
            display_name: povUser.displayName ?? null,
            pfp_url: povUser.pfpUrl ?? null,
            not_found: false,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "wallet" },
        );
      } catch {
        /* best-effort cache */
      }
    }

    if (positions.length === 0) {
      // No POV positions to ingest — still enqueue so any chain-folded beliefs
      // for this wallet get matched in the background.
      return finish(0, 0);
    }

    // 3. Map POV market uuids → our onchain_id. Positions in markets we haven't
    //    imported (no onchain_id) are skipped — the feed is about on-chain markets.
    const uuids = [...new Set(positions.map((p) => p.marketId))];
    const idByUuid = new Map<string, number>();
    for (let i = 0; i < uuids.length; i += 500) {
      const { data: rows } = await sb
        .from("markets")
        .select("onchain_id, pov_uuid")
        .in("pov_uuid", uuids.slice(i, i + 500));
      for (const r of rows ?? []) {
        if (r.pov_uuid) idByUuid.set(String(r.pov_uuid), Number(r.onchain_id));
      }
    }

    // 4. Aggregate positions per market into per-side shares + value.
    interface Agg {
      yesShares: number;
      noShares: number;
      yesValue: number;
      noValue: number;
    }
    const byMarket = new Map<number, Agg>();
    for (const p of positions) {
      const id = idByUuid.get(p.marketId);
      if (id == null) continue;
      const a = byMarket.get(id) ?? { yesShares: 0, noShares: 0, yesValue: 0, noValue: 0 };
      if (p.side === "YES") {
        a.yesShares += p.tokenBalance;
        a.yesValue += p.currentValueUsd;
      } else {
        a.noShares += p.tokenBalance;
        a.noValue += p.currentValueUsd;
      }
      byMarket.set(id, a);
    }

    const marketIds = [...byMarket.keys()];
    if (marketIds.length === 0) {
      return finish(positions.length, 0);
    }

    // 5. Preserve chain-derived fields on any rows the indexer already built.
    const existing = new Map<number, Existing>();
    for (let i = 0; i < marketIds.length; i += 500) {
      const { data: rows } = await sb
        .from("wallet_beliefs")
        .select("onchain_id, directional_since, first_backed_at, last_trade_at, yes_cost, no_cost")
        .eq("wallet", viewer)
        .in("onchain_id", marketIds.slice(i, i + 500));
      for (const r of rows ?? []) {
        existing.set(Number(r.onchain_id), {
          directional_since: (r.directional_since as string | null) ?? null,
          first_backed_at: (r.first_backed_at as string | null) ?? null,
          last_trade_at: (r.last_trade_at as string | null) ?? null,
          yes_cost: Number(r.yes_cost ?? 0),
          no_cost: Number(r.no_cost ?? 0),
        });
      }
    }

    // 6. Derive stance/conviction from POV's own values and upsert.
    const now = Date.now();
    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown>[] = [];
    for (const [id, a] of byMarket) {
      const ex = existing.get(id);
      // Hold time only from a proven directional_since (chain path). Unknown → 0.
      const daysHeld = ex?.directional_since
        ? Math.max(0, (now - new Date(ex.directional_since).getTime()) / 86_400_000)
        : 0;
      const core = convictionFromValues(a.yesValue, a.noValue, daysHeld);
      updates.push({
        wallet: viewer,
        onchain_id: id,
        yes_shares: a.yesShares,
        no_shares: a.noShares,
        // Preserve chain-owned cost basis; default 0 for POV-only rows.
        yes_cost: ex?.yes_cost ?? 0,
        no_cost: ex?.no_cost ?? 0,
        expressed_side: classifyByShares(a.yesShares, a.noShares),
        stance: core.stance,
        stance_side: core.stance_side,
        conviction: core.conviction,
        days_held: daysHeld,
        directional_since: ex?.directional_since ?? null,
        first_backed_at: ex?.first_backed_at ?? null,
        last_trade_at: ex?.last_trade_at ?? null,
        updated_at: nowIso,
      });
    }

    for (let i = 0; i < updates.length; i += 500) {
      await svc
        .from("wallet_beliefs")
        .upsert(updates.slice(i, i + 500), { onConflict: "wallet,onchain_id" });
    }

    // 7. Beliefs are in — enqueue the background matcher (does not block connect).
    return finish(positions.length, marketIds.length);
  });
