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
import { EXPRESSED_WEIGHT, readinessFor, type Readiness } from "@/domain/beliefs";

type Sb = ReturnType<typeof serviceClient>;

/** Distinct directional markets the viewer has a belief on (on-chain ∪ expressed). */
async function beliefMarketCount(sb: Sb, wallet: string): Promise<number> {
  const [onchain, expressed] = await Promise.all([
    sb
      .from("wallet_beliefs")
      .select("onchain_id")
      .eq("wallet", wallet)
      .in("stance_side", ["YES", "NO"]),
    sb.from("expressed_beliefs").select("onchain_id").eq("wallet", wallet),
  ]);
  const ids = new Set<number>();
  for (const r of (onchain.data ?? []) as { onchain_id: number }[]) ids.add(Number(r.onchain_id));
  for (const r of (expressed.data ?? []) as { onchain_id: number }[]) ids.add(Number(r.onchain_id));
  return ids.size;
}

/** Record a free belief (or update the side) and return the fresh readiness. */
export const expressBelief = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        marketId: z.number().int().nonnegative(),
        side: z.enum(["YES", "NO"]),
        source: z.enum(["tap", "calibration"]).default("tap"),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<Readiness> => {
    const sb = serviceClient();
    const wallet = data.wallet.toLowerCase();
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

    const [answeredOn, answeredEx, marketsRes, stateRes] = await Promise.all([
      sb
        .from("wallet_beliefs")
        .select("onchain_id")
        .eq("wallet", wallet)
        .in("stance_side", ["YES", "NO"]),
      sb.from("expressed_beliefs").select("onchain_id").eq("wallet", wallet),
      sb.from("markets").select("onchain_id, category, title").limit(600),
      sb.from("market_state").select("onchain_id, believers_yes, believers_no"),
    ]);

    const answered = new Set<number>();
    for (const r of (answeredOn.data ?? []) as { onchain_id: number }[])
      answered.add(Number(r.onchain_id));
    for (const r of (answeredEx.data ?? []) as { onchain_id: number }[])
      answered.add(Number(r.onchain_id));

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
