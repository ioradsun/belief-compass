/**
 * Candidate generation (server, Phase 8).
 *
 * ONE candidate generator for the whole app. Delegates the set-based shared-market
 * aggregation to the `find_match_candidates` SQL RPC so the heavy join + prune +
 * cap run in Postgres (index-only over the directional slice) and only a bounded
 * pool ever crosses into the app for exact scoring. No per-candidate queries.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MATCH } from "@/domain/match-config";
import type { MatchCandidate } from "@/domain/candidates";

export interface FindCandidateOptions {
  minShared?: number;
  maxCandidates?: number;
}

/**
 * Return the viewer's bounded candidate pool: other wallets that share enough
 * directional markets, ranked by distinctiveness-weighted evidence. Never scores
 * every wallet — the RPC prunes below `minShared` and caps at `maxCandidates`.
 */
export async function findMatchCandidates(
  sb: SupabaseClient,
  viewerWallet: string,
  opts: FindCandidateOptions = {},
): Promise<MatchCandidate[]> {
  const minShared = opts.minShared ?? MATCH.MIN_SHARED_OVERALL;
  const maxCandidates = opts.maxCandidates ?? MATCH.MAX_CANDIDATES;

  const { data, error } = await sb.rpc("find_match_candidates", {
    p_viewer: viewerWallet.toLowerCase(),
    p_min_shared: minShared,
    p_max_candidates: maxCandidates,
  });
  if (error) throw new Error(`find_match_candidates: ${error.message}`);

  type Row = {
    wallet: string;
    shared_markets: number;
    same_side: number;
    opposite_side: number;
    weighted_evidence: number | string;
    last_shared_activity_at: string | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    wallet: String(r.wallet),
    sharedMarkets: Number(r.shared_markets),
    sameSideMarkets: Number(r.same_side),
    oppositeSideMarkets: Number(r.opposite_side),
    preliminaryAgreement:
      Number(r.shared_markets) > 0
        ? (Number(r.same_side) - Number(r.opposite_side)) / Number(r.shared_markets)
        : 0,
    weightedSharedEvidence: Number(r.weighted_evidence),
    lastSharedActivityAt: r.last_shared_activity_at,
  }));
}
