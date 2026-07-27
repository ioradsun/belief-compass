/**
 * Compute one viewer's bounded DNA relationships (server, Phase 8).
 *
 * The single exact-scoring path:
 *   viewer directional positions
 *     → shared-market candidates (RPC, bounded)
 *     → set-based candidate positions (ONE query, not one-per-candidate)
 *     → exact DNA score (pure matchScore) + domain Circles (pure circleMatches)
 *     → bounded top Tribe / Rivals / closest / domains
 *     → viewer_match_cache
 *
 * The exact formula and classification live in src/domain/*, never here. This
 * module only does IO and set-based assembly.
 */
import { publicClient, serviceClient } from "@/lib/supabase-clients";
import { categoryToDomain } from "@/domain/categories";
import { MATCH } from "@/domain/match-config";
import type { BeliefFactor } from "@/domain/domain";
import { buildViewerMatchOutput, type ViewerMatchOutput } from "@/domain/viewer-matches";
import { findMatchCandidates } from "./find-candidates.server";
import {
  getViewerPositionVersion,
  writeViewerCache,
  readViewerCache,
  type ViewerMatchCache,
} from "./viewer-cache.server";

const EMPTY: ViewerMatchOutput = {
  closestMatch: null,
  tribe: [],
  rivals: [],
  domains: {},
  candidateCount: 0,
  scoredCount: 0,
};

type BeliefRow = {
  wallet?: string;
  onchain_id: number;
  stance: number | null;
  stance_side: string | null;
  conviction: number | null;
};

const toFactor = (r: BeliefRow): BeliefFactor => ({
  onchain_id: Number(r.onchain_id),
  stance: Number(r.stance ?? 0),
  stance_side: r.stance_side as BeliefFactor["stance_side"],
  conviction: Number(r.conviction ?? 0),
});

async function loadViewerMarketDomains(
  sb: ReturnType<typeof publicClient>,
  marketIds: number[],
): Promise<Map<number, string>> {
  const domainOf = new Map<number, string>();
  for (let i = 0; i < marketIds.length; i += 500) {
    const { data } = await sb
      .from("markets")
      .select("onchain_id, category")
      .in("onchain_id", marketIds.slice(i, i + 500));
    for (const m of (data ?? []) as { onchain_id: number; category: string | null }[]) {
      const d = categoryToDomain(m.category);
      if (d) domainOf.set(Number(m.onchain_id), d);
    }
  }
  return domainOf;
}

/**
 * Recompute and cache the viewer's bounded relationships. Idempotent and safe to
 * run from the on-demand path or the refresh worker. Returns the fresh cache DTO.
 */
export async function computeViewerMatches(viewerWallet: string): Promise<ViewerMatchCache> {
  const viewer = viewerWallet.toLowerCase();
  const pub = publicClient();
  const svc = serviceClient();
  const version = await getViewerPositionVersion(pub, viewer);

  // 1. Viewer directional factors.
  const { data: mine } = await pub
    .from("wallet_beliefs")
    .select("onchain_id, stance, stance_side, conviction")
    .eq("wallet", viewer)
    .in("stance_side", ["YES", "NO"]);
  const viewerFactors = ((mine ?? []) as BeliefRow[]).map(toFactor);

  // Below the overall minimum → no claim. Write an empty cache so the miss is
  // recorded (and won't be recomputed every request until the viewer changes).
  if (viewerFactors.length < MATCH.MIN_SHARED_OVERALL) {
    await writeViewerCache(svc, viewer, version, EMPTY);
    return (await readViewerCache(pub, viewer))!;
  }

  const viewerMarkets = viewerFactors.map((f) => Number(f.onchain_id));

  // 2. Bounded candidate pool (set-based RPC).
  const candidates = await findMatchCandidates(pub, viewer);
  const candidateWallets = candidates.map((c) => c.wallet);

  // 3. Candidate directional factors, restricted to the viewer's markets, in ONE
  //    set-based read (chunked only to respect PostgREST's `in` size, still O(1)
  //    queries per chunk — never one query per candidate).
  const candidateFactors = new Map<string, BeliefFactor[]>();
  for (let i = 0; i < candidateWallets.length; i += 200) {
    const chunk = candidateWallets.slice(i, i + 200);
    if (chunk.length === 0) break;
    const { data } = await pub
      .from("wallet_beliefs")
      .select("wallet, onchain_id, stance, stance_side, conviction")
      .in("wallet", chunk)
      .in("onchain_id", viewerMarkets)
      .in("stance_side", ["YES", "NO"]);
    for (const r of (data ?? []) as BeliefRow[]) {
      const w = String(r.wallet).toLowerCase();
      const arr = candidateFactors.get(w) ?? [];
      arr.push(toFactor(r));
      candidateFactors.set(w, arr);
    }
  }

  // 4. Domain map + viewer per-domain counts (gates empty Circles).
  const domainOfMarket = await loadViewerMarketDomains(pub, viewerMarkets);
  const viewerDomainCounts = new Map<string, number>();
  for (const f of viewerFactors) {
    const d = domainOfMarket.get(Number(f.onchain_id));
    if (d) viewerDomainCounts.set(d, (viewerDomainCounts.get(d) ?? 0) + 1);
  }

  // 5. Exact score + classify + bound (pure).
  const out = buildViewerMatchOutput(viewerFactors, candidateFactors, {
    domainOf: (id) => domainOfMarket.get(Number(id)) ?? null,
    viewerDomainCounts,
  });
  out.candidateCount = candidates.length;

  // 6. Persist bounded cache.
  await writeViewerCache(svc, viewer, version, out);
  return (await readViewerCache(pub, viewer))!;
}
