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
import { readEthUsd } from "@/lib/eth-usd.server";
import { positionValueUsd } from "@/domain/position-value";
import { aliasFor } from "@/lib/wallet-identity";
import { findConvictionWhale } from "@/domain/conviction-whale";

export interface Believer {
  wallet: string;
  name: string;
  avatarUrl: string | null;
  side: "YES" | "NO";
  shares: number;
  conviction: number;
  daysHeld: number;
  /** USD value of the held side, when POV has priced it (0 when unknown). */
  valueUsd: number;
  /**
   * The market's ONE Conviction Whale: the largest position among holders who
   * have continuously held their side for at least a week. False for everyone
   * when nobody has earned it — there is no runner-up.
   */
  whale: boolean;
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
  /**
   * EVERYONE HOLDING A POSITION, not just the directional ones. `believers` is
   * filtered to stance YES/NO, so a wallet holding both sides (MIXED) is a real
   * person in this market that no per-side count includes. POV counts them; we
   * were printing "4 participants" on a market six wallets had traded.
   */
  participants: number;
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
    // Viewer-blind: four service-client reads per market, shared by every
    // reader on it instead of paid once each.
    const { sharedMarketRead } = await import("@/lib/market-core-cache.server");
    return sharedMarketRead("evidence", data.marketId, async () => {
      // wallet_beliefs is not publicly readable (RLS locked); this function only
      // ever returns the derived, non-sensitive face/side/conviction shape.
      const sb = serviceClient();
      const id = data.marketId;

      const [ethUsd, beliefsRes, seriesRes, marketRes, participantsRes] = await Promise.all([
        readEthUsd(sb),
        sb
          .from("wallet_beliefs")
          .select(
            "wallet, stance_side, expressed_side, yes_shares, no_shares, yes_value_usd, no_value_usd, value_updated_at, yes_cost, no_cost, conviction, days_held",
          )
          .eq("onchain_id", id)
          .in("stance_side", ["YES", "NO"])
          .order("conviction", { ascending: false })
          .limit(BELIEVERS_LIMIT),
        sb.rpc("price_series_daily", { p_ids: [id], p_days: 60 }),
        sb.from("markets").select("agent_opinions").eq("onchain_id", id).maybeSingle(),
        // Everyone with a live position, MIXED included — see MarketEvidence.
        sb
          .from("wallet_beliefs")
          .select("wallet", { count: "exact", head: true })
          .eq("onchain_id", id)
          .or("yes_shares.gt.0,no_shares.gt.0"),
      ]);


      const rows = (beliefsRes.data ?? []) as Array<{
        wallet: string;
        stance_side: string | null;
        expressed_side: string | null;
        yes_shares: number | null;
        no_shares: number | null;
        yes_value_usd: number | null;
        yes_cost: number | null;
        no_cost: number | null;
        value_updated_at: string | null;
        no_value_usd: number | null;
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

      // `*_value_usd` is a column nothing writes, so a position read from it alone
      // values at $0 and a whole field ranks as dust — which is how the previous
      // whale found nobody, ever. `positionValueUsd` falls back to cost basis and
      // reports "unknown" rather than inventing a figure.
      const valueOf = (r: (typeof rows)[number], side: "YES" | "NO") =>
        Math.max(
          0,
          positionValueUsd({
            valueUsd: side === "YES" ? r.yes_value_usd : r.no_value_usd,
            valueUpdatedAt: r.value_updated_at,
            costEth: side === "YES" ? r.yes_cost : r.no_cost,
            ethUsd,
          }).usd,
        );
      /**
       * ONE SEAT, EARNED. This used to flag up to two wallets per side purely on
       * size ($250, or $5000 absolute), which meant the title could be bought
       * minutes before you looked at it and up to four people held it at once.
       *
       * The Conviction Whale is the largest position among holders who have
       * CONTINUOUSLY held their side for at least a week — one per market, or
       * none. `days_held` is the right input and already here: the reducer derives
       * it from `directional_since`, which survives adds and trims, resets on a
       * flip and clears on exit. Scarcity is what makes the seat mean anything, so
       * a market that has not earned one shows nobody.
       */
      const whale = findConvictionWhale(
        rows.map((r) => {
          const side = (r.stance_side ?? r.expressed_side) === "YES" ? "YES" : "NO";
          return {
            wallet: r.wallet.toLowerCase(),
            side,
            daysHeld: Number(r.days_held) || 0,
            valueUsd: valueOf(r, side),
          };
        }),
      );

      let believersYes = 0;
      let believersNo = 0;
      const believers: Believer[] = rows.map((r) => {
        const side = (r.stance_side ?? r.expressed_side) === "YES" ? "YES" : "NO";
        if (side === "YES") believersYes++;
        else believersNo++;
        const p = profiles.get(r.wallet.toLowerCase());
        const valueUsd = valueOf(r, side);
        return {
          wallet: r.wallet,
          name: p?.displayName ?? aliasFor(r.wallet),
          avatarUrl: p?.pfpUrl ?? null,
          side,
          shares: Number(side === "YES" ? r.yes_shares : r.no_shares) || 0,
          conviction: Number(r.conviction) || 0,
          daysHeld: Math.max(0, Math.round(Number(r.days_held) || 0)),
          valueUsd,
          whale: whale?.wallet === r.wallet.toLowerCase(),
        };
      });

      const series = (seriesRes.data ?? []) as Array<{ bucket: string; pct: number | null }>;
      const priceSeries: PricePoint[] = series
        .filter((s) => s.pct != null)
        .map((s) => ({ date: String(s.bucket), yesPct: Number(s.pct) }));

      const defense = toDefense(
        (marketRes.data as { agent_opinions?: unknown } | null)?.agent_opinions,
      );

      // Never below the people we can see: a count that is smaller than the
      // believer rows on screen would be its own contradiction.
      const participants = Math.max(
        Number(participantsRes.count ?? 0) || 0,
        believersYes + believersNo,
      );

      return { believers, believersYes, believersNo, participants, priceSeries, defense };

    });
  });
