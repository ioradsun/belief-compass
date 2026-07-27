/**
 * Conviction DNA — viewer-centered bounded output (pure, Phase 8).
 *
 * ZERO IO. Given the viewer's directional factors and the exact factors of the
 * bounded candidate pool, run the ONE canonical scorer (`matchScore`) and the
 * ONE canonical per-domain scorer (`circleMatches`), classify with neutral
 * semantics, and emit ONLY the bounded relationships the product caches:
 * closest match, top Tribe, top Rivals, and supported domain Circles.
 *
 * Weak evidence yields no claim. Overall Tribe stays separate from domain
 * Circles. Nothing here reads a DB, a clock, or the network.
 */
import { circleMatches, type BeliefFactor, type MatchResult } from "./domain";
import { MATCH, type RelationshipType } from "./match-config";
import { agreementStrength, classifyRelationship, matchConfidence, matchScore } from "./match";

/** A cached relationship row — bounded, structured evidence (no histories). */
export interface MatchEntry {
  wallet: string;
  score: number; // match_score, 0..100
  confidence: number;
  sharedMarkets: number;
  agreements: number;
  disagreements: number;
  relationship: RelationshipType;
  scope: "overall" | string; // "overall" or a domain name
}

export interface ViewerMatchOutput {
  closestMatch: MatchEntry | null;
  tribe: MatchEntry[];
  rivals: MatchEntry[];
  domains: Record<string, MatchEntry[]>;
  candidateCount: number;
  scoredCount: number;
}

function entry(wallet: string, r: MatchResult, scope: string, minShared: number): MatchEntry {
  const confidence = matchConfidence(r.shared);
  return {
    wallet,
    score: Math.round(r.match_score),
    confidence,
    sharedMarkets: r.shared,
    agreements: r.agreements,
    disagreements: r.disagreements,
    relationship: classifyRelationship(r, confidence, minShared),
    scope,
  };
}

export interface BuildOptions {
  domainOf?: (onchainId: string | number) => string | null;
  /** Count of the viewer's directional factors per domain (gates empty Circles). */
  viewerDomainCounts?: Map<string, number>;
}

export function buildViewerMatchOutput(
  viewerFactors: BeliefFactor[],
  candidateFactors: Map<string, BeliefFactor[]>,
  opts: BuildOptions = {},
): ViewerMatchOutput {
  const overall: Array<{ e: MatchEntry; strength: number }> = [];
  let scored = 0;

  for (const [wallet, factors] of candidateFactors) {
    const r = matchScore(viewerFactors, factors);
    scored += 1;
    if (r.shared < MATCH.MIN_SHARED_OVERALL) continue;
    const e = entry(wallet, r, "overall", MATCH.MIN_SHARED_OVERALL);
    if (e.confidence < MATCH.MIN_MATCH_CONFIDENCE) continue;
    overall.push({ e, strength: agreementStrength(r, e.confidence) });
  }

  // Tribe: confident agreement, strongest (confidence-adjusted) first.
  const tribe = overall
    .filter((x) => x.e.relationship === "tribe")
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MATCH.MAX_TRIBE_RESULTS)
    .map((x) => x.e);

  // Rivals: confident opposition, strongest opposition (most negative) first.
  const rivals = overall
    .filter((x) => x.e.relationship === "rival")
    .sort((a, b) => a.strength - b.strength)
    .slice(0, MATCH.MAX_RIVAL_RESULTS)
    .map((x) => x.e);

  // Closest verified match: highest confidence-adjusted agreement among all
  // gate-passing candidates, and only when that agreement is positive.
  let closestMatch: MatchEntry | null = null;
  let bestStrength = 0;
  for (const x of overall) {
    if (x.strength <= 0) continue;
    if (
      closestMatch == null ||
      x.strength > bestStrength ||
      (x.strength === bestStrength && x.e.sharedMarkets > closestMatch.sharedMarkets) ||
      (x.strength === bestStrength &&
        x.e.sharedMarkets === closestMatch.sharedMarkets &&
        x.e.wallet < closestMatch.wallet)
    ) {
      closestMatch = x.e;
      bestStrength = x.strength;
    }
  }

  // Domain Circles: same formula restricted to a domain, gated by evidence.
  const domains: Record<string, MatchEntry[]> = {};
  if (opts.domainOf) {
    const domainOf = opts.domainOf;
    const viewerCounts = opts.viewerDomainCounts ?? new Map();
    const perDomain = new Map<string, Array<{ e: MatchEntry; strength: number }>>();
    for (const [wallet, factors] of candidateFactors) {
      const circles = circleMatches(viewerFactors, factors, domainOf);
      for (const [dom, r] of circles) {
        if ((viewerCounts.get(dom) ?? 0) < MATCH.MIN_SHARED_DOMAIN) continue;
        if (r.shared < MATCH.MIN_SHARED_DOMAIN) continue;
        const e = entry(wallet, r, dom, MATCH.MIN_SHARED_DOMAIN);
        if (e.confidence < MATCH.MIN_MATCH_CONFIDENCE) continue;
        if (e.relationship !== "tribe") continue; // Circles list allies
        const arr = perDomain.get(dom) ?? [];
        arr.push({ e, strength: agreementStrength(r, e.confidence) });
        perDomain.set(dom, arr);
      }
    }
    for (const [dom, arr] of perDomain) {
      if (arr.length === 0) continue; // no empty domain shells
      domains[dom] = arr
        .sort((a, b) => b.strength - a.strength)
        .slice(0, MATCH.MAX_DOMAIN_RESULTS)
        .map((x) => x.e);
    }
  }

  return {
    closestMatch,
    tribe,
    rivals,
    domains,
    candidateCount: candidateFactors.size,
    scoredCount: scored,
  };
}
