/**
 * Conviction DNA — viewer cache read/freshness/write (server, v1).
 *
 * ONE cache writer, ONE freshness rule. A cached network is valid only while the
 * viewer's DNA version and the engine version still match and it has not expired.
 * Everything downstream (Network list, feed tribe/opp, person rows) reads this
 * bounded contract; it never recomputes DNA to render.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DNA_ENGINE_VERSION,
  DNA_CACHE_TTL_MS,
  type EvidenceLevel,
  type RelationshipLabel,
} from "@/domain/dna/config";

export interface DomainSummary {
  name: string;
  agreement: number;
}

/** A qualified aligned person within a domain (feeds the overview's Circles). */
export interface DomainMember {
  wallet: string;
  agreement: number;
  relationship: RelationshipLabel;
}

/** A bounded, self-describing relationship row (no full histories in the cache). */
export interface CachedRelationship {
  wallet: string;
  agreement: number;
  sharedBeliefs: number;
  sameSideBeliefs: number;
  oppositeSideBeliefs: number;
  /** Distinct belief topics compared (breadth) — 0 in caches predating this field. */
  topicCount?: number;
  confidence: number;
  evidenceLevel: EvidenceLevel;
  relationship: RelationshipLabel;
  /**
   * When the CURRENT label was established (ISO). This one field is what makes
   * "you found a Twin" detectable without a second pipeline: a discovery moment
   * is just a relationship whose label is younger than the discovery window
   * (src/domain/discovery-moment).
   *
   * Absent in caches written before this field existed — and correctly so. We do
   * not know when those relationships formed, so they announce nothing rather
   * than all announcing themselves at once on the day this shipped.
   */
  since?: string;
  /** The label held immediately before `since`. Absent when it never changed. */
  previous?: RelationshipLabel | null;
  strongestAlignedDomain?: DomainSummary;
  strongestOpposedDomain?: DomainSummary;
}

export interface ViewerDnaCache {
  viewer: string;
  dnaVersion: number;
  engineVersion: number;
  twin: CachedRelationship[];
  tribe: CachedRelationship[];
  neutral: CachedRelationship[];
  opp: CachedRelationship[];
  inverse: CachedRelationship[];
  closest: CachedRelationship[];
  domains: Record<string, DomainMember[]>;
  candidateCount: number;
  scoredCount: number;
  calculatedAt: string;
  expiresAt: string;
  fresh: boolean;
}

/** The viewer's current DNA version (0 if never changed). */
export async function getViewerDnaVersion(sb: SupabaseClient, viewer: string): Promise<number> {
  const { data } = await sb
    .from("wallet_match_version")
    .select("version")
    .eq("wallet", viewer.toLowerCase())
    .maybeSingle();
  return Number((data as { version?: number } | null)?.version ?? 0);
}

type Row = {
  viewer_wallet: string;
  viewer_dna_version: number;
  engine_version: number;
  twin_matches: CachedRelationship[];
  tribe_matches: CachedRelationship[];
  neutral_matches: CachedRelationship[];
  opp_matches: CachedRelationship[];
  inverse_matches: CachedRelationship[];
  closest_matches: CachedRelationship[];
  domain_matches: Record<string, DomainMember[]>;
  candidate_count: number;
  scored_count: number;
  calculated_at: string;
  expires_at: string;
};

function shape(row: Row, currentVersion: number): ViewerDnaCache {
  const fresh =
    Number(row.engine_version) === DNA_ENGINE_VERSION &&
    Number(row.viewer_dna_version) === currentVersion &&
    new Date(row.expires_at).getTime() > Date.now();
  return {
    viewer: row.viewer_wallet,
    dnaVersion: Number(row.viewer_dna_version),
    engineVersion: Number(row.engine_version),
    twin: row.twin_matches ?? [],
    tribe: row.tribe_matches ?? [],
    neutral: row.neutral_matches ?? [],
    opp: row.opp_matches ?? [],
    inverse: row.inverse_matches ?? [],
    closest: row.closest_matches ?? [],
    domains: row.domain_matches ?? {},
    candidateCount: Number(row.candidate_count),
    scoredCount: Number(row.scored_count),
    calculatedAt: row.calculated_at,
    expiresAt: row.expires_at,
    fresh,
  };
}

export async function readViewerDnaCache(
  sb: SupabaseClient,
  viewer: string,
): Promise<ViewerDnaCache | null> {
  const w = viewer.toLowerCase();
  const [{ data, error }, currentVersion] = await Promise.all([
    sb.from("viewer_dna_cache").select("*").eq("viewer_wallet", w).maybeSingle(),
    getViewerDnaVersion(sb, w),
  ]);
  /**
   * A BLOCKED READ AND A COLD CACHE ARE DIFFERENT ANSWERS. Both used to arrive
   * here as `data == null` and leave as `null`, and `getNetwork` reads null as
   * "not computed yet" — it asks the worker for a build and renders the empty
   * shell. That is the right response to a genuine miss and a lie about a
   * failure: the reader is told their network is still forming, forever, while
   * every request errors.
   *
   * `maybeSingle()` returns `{ data: null, error: null }` for no row, so an error
   * being present is unambiguous.
   */
  if (error) throw new Error(`dna: viewer_dna_cache read failed for ${w} — ${error.message}`);
  if (!data) return null;
  return shape(data as unknown as Row, currentVersion);
}

export interface ViewerDnaOutput {
  twin: CachedRelationship[];
  tribe: CachedRelationship[];
  neutral: CachedRelationship[];
  opp: CachedRelationship[];
  inverse: CachedRelationship[];
  closest: CachedRelationship[];
  domains: Record<string, DomainMember[]>;
  candidateCount: number;
  scoredCount: number;
}

export async function writeViewerDnaCache(
  svc: SupabaseClient,
  viewer: string,
  version: number,
  out: ViewerDnaOutput,
  lastError: string | null = null,
): Promise<void> {
  const now = Date.now();
  const { error } = await svc.from("viewer_dna_cache").upsert(
    {
      viewer_wallet: viewer.toLowerCase(),
      viewer_dna_version: version,
      engine_version: DNA_ENGINE_VERSION,
      twin_matches: out.twin,
      tribe_matches: out.tribe,
      neutral_matches: out.neutral,
      opp_matches: out.opp,
      inverse_matches: out.inverse,
      closest_matches: out.closest,
      domain_matches: out.domains,
      candidate_count: out.candidateCount,
      scored_count: out.scoredCount,
      calculated_at: new Date(now).toISOString(),
      expires_at: new Date(now + DNA_CACHE_TTL_MS).toISOString(),
      last_error: lastError,
    },
    { onConflict: "viewer_wallet" },
  );
  if (error) throw new Error(`writeViewerDnaCache: ${error.message}`);
}
