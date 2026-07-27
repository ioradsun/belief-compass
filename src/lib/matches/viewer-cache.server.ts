/**
 * Viewer match cache — read/freshness/write (server, Phase 8).
 *
 * ONE cache writer, ONE freshness rule. A cached result is valid only when the
 * viewer's match-relevant position version and the engine version still match and
 * it has not expired. Everything downstream (feed, wallet page, relevance) reads
 * this bounded contract and never the old all-pairs graph.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MATCH } from "@/domain/match-config";
import type { MatchEntry, ViewerMatchOutput } from "@/domain/viewer-matches";

export interface ViewerMatchCache {
  viewer: string;
  positionVersion: number;
  engineVersion: number;
  closestMatch: MatchEntry | null;
  tribe: MatchEntry[];
  rivals: MatchEntry[];
  domains: Record<string, MatchEntry[]>;
  candidateCount: number;
  scoredCount: number;
  calculatedAt: string;
  expiresAt: string;
  /** Fresh = version + engine current AND not expired. */
  fresh: boolean;
}

/** The viewer's current match-relevant position version (0 if never changed). */
export async function getViewerPositionVersion(
  sb: SupabaseClient,
  viewer: string,
): Promise<number> {
  const { data } = await sb
    .from("wallet_match_version")
    .select("version")
    .eq("wallet", viewer.toLowerCase())
    .maybeSingle();
  return Number((data as { version?: number } | null)?.version ?? 0);
}

type CacheRow = {
  viewer_wallet: string;
  viewer_position_version: number;
  match_engine_version: number;
  closest_match: MatchEntry | null;
  tribe_matches: MatchEntry[];
  rival_matches: MatchEntry[];
  domain_matches: Record<string, MatchEntry[]>;
  candidate_count: number;
  scored_count: number;
  calculated_at: string;
  expires_at: string;
};

function shape(row: CacheRow, currentVersion: number): ViewerMatchCache {
  const fresh =
    Number(row.match_engine_version) === MATCH.ENGINE_VERSION &&
    Number(row.viewer_position_version) === currentVersion &&
    new Date(row.expires_at).getTime() > Date.now();
  return {
    viewer: row.viewer_wallet,
    positionVersion: Number(row.viewer_position_version),
    engineVersion: Number(row.match_engine_version),
    closestMatch: row.closest_match ?? null,
    tribe: row.tribe_matches ?? [],
    rivals: row.rival_matches ?? [],
    domains: row.domain_matches ?? {},
    candidateCount: Number(row.candidate_count),
    scoredCount: Number(row.scored_count),
    calculatedAt: row.calculated_at,
    expiresAt: row.expires_at,
    fresh,
  };
}

/** Read the cache and compute freshness against the live position version. */
export async function readViewerCache(
  sb: SupabaseClient,
  viewer: string,
): Promise<ViewerMatchCache | null> {
  const w = viewer.toLowerCase();
  const [{ data }, currentVersion] = await Promise.all([
    sb.from("viewer_match_cache").select("*").eq("viewer_wallet", w).maybeSingle(),
    getViewerPositionVersion(sb, w),
  ]);
  if (!data) return null;
  return shape(data as unknown as CacheRow, currentVersion);
}

/** Persist a freshly-computed bounded output. Uses the service client (RLS write). */
export async function writeViewerCache(
  svc: SupabaseClient,
  viewer: string,
  version: number,
  out: ViewerMatchOutput,
  lastError: string | null = null,
): Promise<void> {
  const now = Date.now();
  const { error } = await svc.from("viewer_match_cache").upsert(
    {
      viewer_wallet: viewer.toLowerCase(),
      viewer_position_version: version,
      match_engine_version: MATCH.ENGINE_VERSION,
      closest_match: out.closestMatch,
      tribe_matches: out.tribe,
      rival_matches: out.rivals,
      domain_matches: out.domains,
      candidate_count: out.candidateCount,
      scored_count: out.scoredCount,
      calculated_at: new Date(now).toISOString(),
      expires_at: new Date(now + MATCH.CACHE_TTL_MS).toISOString(),
      last_error: lastError,
    },
    { onConflict: "viewer_wallet" },
  );
  if (error) throw new Error(`writeViewerCache: ${error.message}`);
}
