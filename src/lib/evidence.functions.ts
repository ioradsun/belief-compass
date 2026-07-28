/**
 * Market evidence — public server functions for the deck's proof section.
 *
 * Two real, honest signals behind an open market:
 *   • believers — who actually holds each side (from wallet_beliefs), with their
 *     POV faces, side, conviction and how long they've held. Faces for people,
 *     never invented crowds.
 *   • priceSeries — the money-YES% over time (downsampled daily via the
 *     price_series_daily RPC over price_snapshots).
 *
 * All truth is server-owned; the client renders it and never recomputes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";

export interface Believer {
  wallet: string;
  name: string;
  avatarUrl: string | null;
  side: "YES" | "NO";
  shares: number;
  conviction: number;
  daysHeld: number;
}

export interface PricePoint {
  date: string; // YYYY-MM-DD
  yesPct: number; // 0..100
}

/** One agent's take on the market — the "case" behind a side. From pov.co. */
export interface DefenseOpinion {
  name: string;
  avatarUrl: string | null;
  opinion: string;
  vote: "YES" | "NO";
}

export interface MarketEvidence {
  believers: Believer[];
  believersYes: number;
  believersNo: number;
  priceSeries: PricePoint[];
  defense: DefenseOpinion[];
}

/** Shape pov.co agent_opinions (jsonb) into Defense entries; tolerant of gaps. */
function toDefense(raw: unknown): DefenseOpinion[] {
  if (!Array.isArray(raw)) return [];
  const out: DefenseOpinion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const opinion = typeof o.opinion === "string" ? o.opinion.trim() : "";
    if (!opinion) continue;
    const name =
      (typeof o.agentDisplayName === "string" && o.agentDisplayName) ||
      (typeof o.agentUsername === "string" && o.agentUsername) ||
      "Anonymous";
    const vote = String(o.vote ?? "").toLowerCase() === "yes" ? "YES" : "NO";
    out.push({
      name,
      avatarUrl: typeof o.agentPfpUrl === "string" ? o.agentPfpUrl : null,
      opinion,
      vote,
    });
  }
  return out;
}

const BELIEVERS_LIMIT = 200;

/** Real holders + price history for one market. Empty-safe on every field. */
export const getMarketEvidence = createServerFn({ method: "GET" })
  .validator((raw: unknown) => z.object({ marketId: z.number().int().nonnegative() }).parse(raw))
  .handler(async ({ data }): Promise<MarketEvidence> => {
    // wallet_beliefs is not publicly readable (RLS locked); this function only
    // ever returns the derived, non-sensitive face/side/conviction shape.
    const sb = serviceClient();
    const id = data.marketId;

    const [beliefsRes, seriesRes, marketRes] = await Promise.all([
      sb
        .from("wallet_beliefs")
        .select("wallet, stance_side, expressed_side, yes_shares, no_shares, conviction, days_held")
        .eq("onchain_id", id)
        .in("stance_side", ["YES", "NO"])
        .order("conviction", { ascending: false })
        .limit(BELIEVERS_LIMIT),
      sb.rpc("price_series_daily", { p_ids: [id], p_days: 60 }),
      sb.from("markets").select("agent_opinions").eq("onchain_id", id).maybeSingle(),
    ]);

    const rows = (beliefsRes.data ?? []) as Array<{
      wallet: string;
      stance_side: string | null;
      expressed_side: string | null;
      yes_shares: number | null;
      no_shares: number | null;
      conviction: number | null;
      days_held: number | null;
    }>;

    // Resolve faces for the holders we're about to show (bounded lazy fill).
    const wallets = rows.map((r) => r.wallet);
    const { resolveProfiles } = await import("@/lib/profiles.server");
    const profiles = await resolveProfiles(
      wallets.map((w) => w.toLowerCase()),
      8,
    );

    let believersYes = 0;
    let believersNo = 0;
    const believers: Believer[] = rows.map((r) => {
      const side = (r.stance_side ?? r.expressed_side) === "YES" ? "YES" : "NO";
      if (side === "YES") believersYes++;
      else believersNo++;
      const p = profiles.get(r.wallet.toLowerCase());
      return {
        wallet: r.wallet,
        name: p?.displayName ?? aliasFor(r.wallet),
        avatarUrl: p?.pfpUrl ?? null,
        side,
        shares: Number(side === "YES" ? r.yes_shares : r.no_shares) || 0,
        conviction: Number(r.conviction) || 0,
        daysHeld: Math.max(0, Math.round(Number(r.days_held) || 0)),
      };
    });

    const series = (seriesRes.data ?? []) as Array<{ bucket: string; pct: number | null }>;
    const priceSeries: PricePoint[] = series
      .filter((s) => s.pct != null)
      .map((s) => ({ date: String(s.bucket), yesPct: Number(s.pct) }));

    const defense = toDefense(
      (marketRes.data as { agent_opinions?: unknown } | null)?.agent_opinions,
    );

    return { believers, believersYes, believersNo, priceSeries, defense };
  });
