/**
 * Expressed beliefs + viewer readiness — public server functions.
 *
 * A belief tap records a FREE expressed belief (no money) that feeds DNA /
 * Network / House at a low weight. Readiness is the single signal every surface
 * reads to decide whether to show the real experience or the calibration card.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase-clients";
import { categoryToDomain } from "@/domain/categories";
import {
  EXPRESSED_WEIGHT,
  isDirectional,
  profileProgressFor,
  readinessFor,
  type ProfileProgress,
  type Readiness,
} from "@/domain/beliefs";

type Sb = ReturnType<typeof serviceClient>;

/**
 * DISTINCT MARKETS THE VIEWER HAS A DIRECTION ON — the one count both thresholds
 * fold over.
 *
 * FOUR SOURCES, and the third and fourth are the ones this used to miss:
 *
 *   · a live money-backed position          wallet_beliefs.stance_side
 *   · a conviction they have since LEFT     wallet_beliefs.last_directional_side
 *   · a completed Simulation position       expressed_beliefs (source='simulation')
 *   · any other expressed belief            expressed_beliefs
 *
 * Filtering on `stance_side IN (YES, NO)` dropped the second: closing a position
 * un-counted a conviction somebody genuinely took, so their progress could go
 * DOWN by acting on the market. `pastFactor` already treats those as real
 * beliefs for DNA — the counter simply disagreed with the scorer.
 *
 * Simulation needs no special case at all, which is the point of routing it
 * through `expressed_beliefs`: a simulated conviction is counted because it is a
 * belief, not because a second branch remembers to add it.
 */
export async function answeredMarkets(sb: Sb, wallet: string): Promise<Set<number>> {
  const [onchain, expressed] = await Promise.all([
    sb
      .from("wallet_beliefs")
      .select("onchain_id, stance_side, last_directional_side")
      .eq("wallet", wallet),
    sb.from("expressed_beliefs").select("onchain_id").eq("wallet", wallet),
  ]);
  const ids = new Set<number>();
  for (const r of (onchain.data ?? []) as {
    onchain_id: number;
    stance_side: string | null;
    last_directional_side: string | null;
  }[]) {
    if (isDirectional(r.stance_side) || isDirectional(r.last_directional_side))
      ids.add(Number(r.onchain_id));
  }
  for (const r of (expressed.data ?? []) as { onchain_id: number }[]) ids.add(Number(r.onchain_id));
  return ids;
}

/** The count both thresholds fold, from the one answered-market set. */
async function beliefMarketCount(sb: Sb, wallet: string): Promise<number> {
  return (await answeredMarkets(sb, wallet)).size;
}

/** Record a free belief (or update the side) and return the fresh readiness. */
export const expressBelief = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        marketId: z.number().int().nonnegative(),
        side: z.enum(["YES", "NO"]),
        /**
         * WHERE THE BELIEF CAME FROM, AND WHAT A CLIENT MAY CLAIM.
         *
         * `simulation` is deliberately ABSENT. It is written only by the atomic
         * Simulation order transaction, which is the one place that can prove a
         * position actually settled — and provenance nobody can verify is
         * provenance anybody can assert. Listing it here as documentation while
         * the validator accepted it would have let any caller stamp a free tap as
         * a completed Simulation conviction.
         */
        source: z.enum(["tap", "calibration"]).default("tap"),
        /** Proof the caller controls `wallet` (see useWalletSession). */
        session: z.string().min(16).max(2000),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<Readiness> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    const sb = serviceClient();
    await sb.from("expressed_beliefs").upsert(
      {
        wallet,
        onchain_id: data.marketId,
        side: data.side,
        weight: EXPRESSED_WEIGHT,
        source: data.source,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet,onchain_id" },
    );
    // The DNA version trigger only fires on wallet_beliefs, so a free belief must
    // enqueue the viewer's recompute itself — otherwise the Network never updates.
    await sb.rpc("request_viewer_match_refresh", { p_wallet: wallet });
    return readinessFor(await beliefMarketCount(sb, wallet));
  });

/** The one readiness signal every personalized surface reads. */
export const getViewerReadiness = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: z.string().min(3).nullable().optional() }).parse(raw),
  )
  .handler(async ({ data }): Promise<Readiness> => {
    if (!data.wallet) return readinessFor(0);
    const sb = serviceClient();
    return readinessFor(await beliefMarketCount(sb, data.wallet.toLowerCase()));
  });

/**
 * HOW FAR THROUGH THE FIRST TEN — the same count, against the other target.
 *
 * Separate from `getViewerReadiness` on purpose. Readiness answers "can the
 * Network compute closest people yet" (five); this answers "is onboarding done"
 * (ten). Collapsing them would make one of the two lie, and the one that would
 * lie is the one that withholds the Network.
 */
export const getProfileProgress = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: z.string().min(3).nullable().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ data }): Promise<ProfileProgress> => {
    if (!data.wallet) return profileProgressFor(0);
    const sb = serviceClient();
    return profileProgressFor(await beliefMarketCount(sb, data.wallet.toLowerCase()));
  });

const CALIBRATION_QUEUE_SIZE = 16;

export interface CalibrationQuestion {
  marketId: number;
  title: string;
  category: string | null;
}

/**
 * A curated, domain-diverse queue of calibration questions: the most active
 * markets the viewer hasn't answered yet, round-robined across domains so the
 * first beliefs spread the viewer's DNA across the map instead of clustering.
 * The House Read section walks these; the center orders its queue by them.
 */
export const getCalibrationQueue = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: z.string().min(3).nullable().optional() }).parse(raw),
  )
  .handler(async ({ data }): Promise<CalibrationQuestion[]> => {
    if (!data.wallet) return [];
    const sb = serviceClient();
    const wallet = data.wallet.toLowerCase();

    /**
     * EXCLUDED BY THE SAME SET THE COUNT IS BUILT FROM.
     *
     * This used to run its own narrower read — currently-directional positions
     * only — which disagreed with the counter the moment the counter learned
     * about remembered convictions. A market somebody had backed and since
     * exited would be offered as unanswered, and answering it would leave their
     * progress unchanged, because the canonical count already included it. One
     * function, so "answered" cannot mean two things.
     */
    const [answered, marketsRes, stateRes] = await Promise.all([
      answeredMarkets(sb, wallet),
      sb.from("markets").select("onchain_id, category, title").limit(600),
      sb.from("market_state").select("onchain_id, believers_yes, believers_no"),
    ]);

    const activity = new Map<number, number>();
    for (const s of (stateRes.data ?? []) as {
      onchain_id: number;
      believers_yes: number | null;
      believers_no: number | null;
    }[]) {
      activity.set(
        Number(s.onchain_id),
        (Number(s.believers_yes) || 0) + (Number(s.believers_no) || 0),
      );
    }

    // Bucket un-answered, titled markets by domain, each bucket sorted by activity.
    const byDomain = new Map<string, CalibrationQuestion[]>();
    for (const m of (marketsRes.data ?? []) as {
      onchain_id: number;
      category: string | null;
      title: string | null;
    }[]) {
      const id = Number(m.onchain_id);
      if (answered.has(id) || !m.title) continue;
      const domain = categoryToDomain(m.category) ?? "other";
      const arr = byDomain.get(domain) ?? [];
      arr.push({ marketId: id, title: m.title, category: m.category });
      byDomain.set(domain, arr);
    }
    for (const arr of byDomain.values()) {
      arr.sort((a, b) => (activity.get(b.marketId) ?? 0) - (activity.get(a.marketId) ?? 0));
    }

    // Round-robin across domains so early answers span the map.
    const buckets = [...byDomain.values()];
    const out: CalibrationQuestion[] = [];
    for (let i = 0; out.length < CALIBRATION_QUEUE_SIZE && buckets.some((b) => b.length); i++) {
      const q = buckets[i % buckets.length].shift();
      if (q) out.push(q);
    }
    return out;
  });
