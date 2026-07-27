/**
 * Conviction DNA — compute one viewer's bounded network (server, v1).
 *
 * The single exact-scoring path:
 *   viewer directional positions
 *     → shared-market candidates (RPC, bounded ≤ maxExactScored)
 *     → set-based candidate positions (ONE query per chunk, never per candidate)
 *     → exact DNA (scoreRelationship) + per-domain (scoreDomains)
 *     → classify with hysteresis (previous label from the prior cache)
 *     → bucket twin/tribe/neutral/opp/inverse + closest + domain Circles
 *     → viewer_dna_cache
 *
 * Scoring/classification live in src/domain/dna/*; this module only does IO and
 * bounded assembly.
 */
import { publicClient, serviceClient } from "@/lib/supabase-clients";
import { categoryToDomain } from "@/domain/categories";
import { DNA_THRESHOLDS, DNA_LIMITS, type RelationshipLabel } from "@/domain/dna/config";
import { scoreRelationship, type DnaFactor } from "@/domain/dna/score";
import { classifyRelationship } from "@/domain/dna/classify";
import { scoreDomains, splitDomains } from "@/domain/dna/domains";
import { findDnaCandidates } from "./find-candidates.server";
import {
  getViewerDnaVersion,
  readViewerDnaCache,
  writeViewerDnaCache,
  type CachedRelationship,
  type DomainMember,
  type ViewerDnaCache,
  type ViewerDnaOutput,
} from "./viewer-dna-cache.server";

const EMPTY: ViewerDnaOutput = {
  twin: [],
  tribe: [],
  neutral: [],
  opp: [],
  inverse: [],
  closest: [],
  domains: {},
  candidateCount: 0,
  scoredCount: 0,
};

type BeliefRow = {
  wallet?: string;
  onchain_id: number;
  stance_side: string | null;
  conviction: number | null;
};

const toFactor = (r: BeliefRow): DnaFactor => ({
  marketId: Number(r.onchain_id),
  side: r.stance_side === "NO" ? "NO" : "YES",
  conviction: Math.abs(Number(r.conviction ?? 0)),
});

async function loadDomains(
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

export async function computeViewerDna(viewerWallet: string): Promise<ViewerDnaCache> {
  const viewer = viewerWallet.toLowerCase();
  const pub = publicClient();
  const svc = serviceClient();
  const version = await getViewerDnaVersion(pub, viewer);

  // Prior labels → hysteresis (a held relationship survives to its exit band).
  const prior = await readViewerDnaCache(pub, viewer);
  const priorLabel = new Map<string, RelationshipLabel>();
  if (prior) {
    for (const group of [prior.twin, prior.tribe, prior.neutral, prior.opp, prior.inverse])
      for (const r of group) priorLabel.set(r.wallet, r.relationship);
  }

  // 1. Viewer directional factors.
  const { data: mine } = await pub
    .from("wallet_beliefs")
    .select("onchain_id, stance_side, conviction")
    .eq("wallet", viewer)
    .in("stance_side", ["YES", "NO"]);
  const viewerFactors = ((mine ?? []) as BeliefRow[]).map(toFactor);

  if (viewerFactors.length < DNA_THRESHOLDS.minSharedOverall) {
    await writeViewerDnaCache(svc, viewer, version, EMPTY);
    return (await readViewerDnaCache(pub, viewer))!;
  }
  const viewerMarkets = viewerFactors.map((f) => Number(f.marketId));

  // 2. Bounded candidate pool.
  const candidates = await findDnaCandidates(pub, viewer);
  const candidateWallets = candidates.map((c) => c.wallet);

  // 3. Candidate directional factors (set-based, chunked for `in` size only).
  const candidateFactors = new Map<string, DnaFactor[]>();
  for (let i = 0; i < candidateWallets.length; i += 200) {
    const chunk = candidateWallets.slice(i, i + 200);
    if (chunk.length === 0) break;
    const { data } = await pub
      .from("wallet_beliefs")
      .select("wallet, onchain_id, stance_side, conviction")
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

  // 4. Domain map for the viewer's markets (covers all shared markets).
  const domainOfMarket = await loadDomains(pub, viewerMarkets);
  const domainOf = (id: string | number) => domainOfMarket.get(Number(id)) ?? null;

  // 5. Exact score + classify + per-domain (pure).
  const bucket: Record<RelationshipLabel, CachedRelationship[]> = {
    twin: [],
    tribe: [],
    neutral: [],
    opp: [],
    inverse: [],
    insufficient: [],
  };
  const domainMembers: Record<string, DomainMember[]> = {};
  let scored = 0;

  for (const [wallet, factors] of candidateFactors) {
    const s = scoreRelationship(viewerFactors, factors);
    scored += 1;
    if (s.sharedBeliefs < DNA_THRESHOLDS.minSharedOverall) continue;
    const { relationship } = classifyRelationship({
      currentScore: s,
      previousRelationship: priorLabel.get(wallet),
    });
    if (relationship === "insufficient") continue;

    const domains = scoreDomains(viewerFactors, factors, domainOf);
    const { aligned, opposed } = splitDomains(domains, 1);
    const row: CachedRelationship = {
      wallet,
      agreement: Math.round(s.agreement),
      sharedBeliefs: s.sharedBeliefs,
      sameSideBeliefs: s.sameSideBeliefs,
      oppositeSideBeliefs: s.oppositeSideBeliefs,
      confidence: s.confidence,
      evidenceLevel: s.evidenceLevel,
      relationship,
      strongestAlignedDomain: aligned[0]
        ? { name: aligned[0].domain, agreement: aligned[0].agreement }
        : undefined,
      strongestOpposedDomain: opposed[0]
        ? { name: opposed[0].domain, agreement: opposed[0].agreement }
        : undefined,
    };
    bucket[relationship].push(row);

    // Domain Circles: aligned (twin/tribe) domain memberships feed the overview.
    for (const d of domains) {
      if (d.relationship !== "twin" && d.relationship !== "tribe") continue;
      const arr = domainMembers[d.domain] ?? [];
      arr.push({ wallet, agreement: d.agreement, relationship: d.relationship });
      domainMembers[d.domain] = arr;
    }
  }

  // 6. Sort + cap each bucket. High bands by agreement desc; low bands asc.
  const byAgreementDesc = (a: CachedRelationship, b: CachedRelationship) =>
    b.agreement - a.agreement || b.sharedBeliefs - a.sharedBeliefs;
  const byAgreementAsc = (a: CachedRelationship, b: CachedRelationship) =>
    a.agreement - b.agreement || b.sharedBeliefs - a.sharedBeliefs;
  const cap = DNA_LIMITS.maxPerGroup;

  const twin = bucket.twin.sort(byAgreementDesc).slice(0, cap);
  const tribe = bucket.tribe.sort(byAgreementDesc).slice(0, cap);
  const neutral = bucket.neutral.sort(byAgreementDesc).slice(0, cap);
  const opp = bucket.opp.sort(byAgreementAsc).slice(0, cap);
  const inverse = bucket.inverse.sort(byAgreementAsc).slice(0, cap);
  const closest = [...bucket.twin, ...bucket.tribe].sort(byAgreementDesc).slice(0, 10);

  for (const d of Object.keys(domainMembers)) {
    domainMembers[d] = domainMembers[d].sort((a, b) => b.agreement - a.agreement).slice(0, cap);
  }

  const out: ViewerDnaOutput = {
    twin,
    tribe,
    neutral,
    opp,
    inverse,
    closest,
    domains: domainMembers,
    candidateCount: candidates.length,
    scoredCount: scored,
  };

  await writeViewerDnaCache(svc, viewer, version, out);
  return (await readViewerDnaCache(pub, viewer))!;
}
