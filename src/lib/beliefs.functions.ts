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
import { isCalibrationMarket } from "@/domain/calibration";
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
    // A CALIBRATION answer is a COMPLETED decision. Recording it in the one
    // decisions ledger (viewer_market_decisions) is what removes the question
    // from discovery, so a Locked 10 market answered yes/no does not come back —
    // the same ledger a pass and a purchase already write to. The expressed
    // belief above still feeds DNA / Network / tribe; this row only marks
    // "answered". Best-effort: a failed dedup must never fail the belief that
    // just fed the Network.
    if (isCalibrationMarket(data.marketId)) {
      try {
        const { recordViewerDecision } = await import("@/lib/viewer-decisions.server");
        await recordViewerDecision(wallet, data.marketId, data.side);
      } catch {
        /* the expressed belief stands; the decision is retried on the next answer */
      }
    }
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

/**
 * THE CALIBRATION SEQUENCE IS NO LONGER SELECTED HERE. It used to be a dynamic,
 * activity-ranked, domain-round-robined queue chosen at read time; it is now the
 * server-owned Locked 10 (see @/domain/calibration), pinned to the head of the
 * For You feed by @/lib/opportunity-feed.server. POV owns the market;
 * conviction.company owns the sequence, and the sequence is a constant.
 */
