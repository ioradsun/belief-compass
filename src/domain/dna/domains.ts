/**
 * Conviction DNA — per-domain (Circle) scoring (canonical, pure, v1).
 *
 * ZERO IO. Uses the EXACT same scorer as overall DNA, restricted to the shared
 * markets in one canonical domain. A domain with too few shared beliefs never
 * produces a label ("one shared technology market is not a Technology Twin").
 */
import { DOMAIN_MIN_SHARED, type EvidenceLevel, type RelationshipLabel } from "./config";
import { scoreRelationship, type DnaFactor } from "./score";
import { classifyRelationship } from "./classify";

export interface DomainDnaScore {
  domain: string;
  agreement: number;
  sharedBeliefs: number;
  confidence: number;
  evidenceLevel: EvidenceLevel;
  relationship: RelationshipLabel;
}

/**
 * Score every domain the two wallets both hold enough shared beliefs in. Returns
 * only meaningful domains (≥ DOMAIN_MIN_SHARED shared), sorted strongest first:
 * evidence, then distance from neutral (50), then shared-belief count.
 */
export function scoreDomains(
  a: DnaFactor[],
  b: DnaFactor[],
  domainOf: (marketId: string | number) => string | null,
): DomainDnaScore[] {
  const bucket = (factors: DnaFactor[]) => {
    const m = new Map<string, DnaFactor[]>();
    for (const f of factors) {
      const d = domainOf(f.marketId);
      if (!d) continue;
      const arr = m.get(d) ?? [];
      arr.push(f);
      m.set(d, arr);
    }
    return m;
  };
  const aBy = bucket(a);
  const bBy = bucket(b);

  const out: DomainDnaScore[] = [];
  for (const [domain, aFactors] of aBy) {
    const bFactors = bBy.get(domain);
    if (!bFactors) continue;
    const score = scoreRelationship(aFactors, bFactors);
    if (score.sharedBeliefs < DOMAIN_MIN_SHARED) continue;
    const { relationship } = classifyRelationship({ currentScore: score });
    out.push({
      domain,
      agreement: Math.round(score.agreement),
      sharedBeliefs: score.sharedBeliefs,
      confidence: score.confidence,
      evidenceLevel: score.evidenceLevel,
      relationship,
    });
  }

  const evidenceRank: Record<EvidenceLevel, number> = {
    established: 3,
    growing: 2,
    early: 1,
    insufficient: 0,
  };
  return out.sort((x, y) => {
    if (evidenceRank[y.evidenceLevel] !== evidenceRank[x.evidenceLevel])
      return evidenceRank[y.evidenceLevel] - evidenceRank[x.evidenceLevel];
    const dx = Math.abs(x.agreement - 50);
    const dy = Math.abs(y.agreement - 50);
    if (dy !== dx) return dy - dx;
    return y.sharedBeliefs - x.sharedBeliefs;
  });
}

/** The strongest aligned (agreement>50) and opposed (<50) domains, capped. */
export function splitDomains(
  domains: DomainDnaScore[],
  limit = 3,
): { aligned: DomainDnaScore[]; opposed: DomainDnaScore[] } {
  const aligned = domains.filter((d) => d.agreement > 50).slice(0, limit);
  const opposed = domains
    .filter((d) => d.agreement < 50)
    .sort((a, b) => a.agreement - b.agreement)
    .slice(0, limit);
  return { aligned, opposed };
}
