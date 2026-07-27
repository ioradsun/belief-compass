/**
 * Conviction DNA — exact relationship scoring (canonical, pure, v1).
 *
 * ZERO IO. The ONE module that owns DNA scoring. Given two wallets' directional
 * beliefs, agreement is the conviction-weighted fraction of shared markets they
 * take the SAME side on. Confidence (evidence depth) is returned separately and
 * is never folded into agreement.
 *
 * Only directional beliefs (YES/NO) participate — MIXED/INACTIVE are excluded by
 * construction (DnaFactor.side is YES|NO). Conviction weights are clamped to ≥0.
 */
import { confidenceFor, evidenceLevelFor, type EvidenceLevel } from "./config";

/** A wallet's directional stake in one market. */
export interface DnaFactor {
  marketId: string | number;
  side: "YES" | "NO";
  /** Absolute normalized conviction strength, 0..1. */
  conviction: number;
}

export interface DnaScore {
  /** Conviction-weighted same-side fraction, 0..100 (100 = full agreement). */
  agreement: number;
  sharedBeliefs: number;
  sameSideBeliefs: number;
  oppositeSideBeliefs: number;
  sharedWeight: number;
  sameSideWeight: number;
  oppositeSideWeight: number;
  /** Evidence confidence, 0..1 — separate from agreement. */
  confidence: number;
  evidenceLevel: EvidenceLevel;
}

const EPS = 1e-9;
const key = (m: string | number) => String(m);

export function scoreRelationship(a: DnaFactor[], b: DnaFactor[]): DnaScore {
  const byId = new Map<string, DnaFactor>();
  for (const x of a) {
    if (x.side === "YES" || x.side === "NO") byId.set(key(x.marketId), x);
  }

  let sharedBeliefs = 0;
  let sameSideBeliefs = 0;
  let oppositeSideBeliefs = 0;
  let sharedWeight = 0;
  let sameSideWeight = 0;
  let oppositeSideWeight = 0;

  for (const y of b) {
    if (y.side !== "YES" && y.side !== "NO") continue;
    const x = byId.get(key(y.marketId));
    if (!x) continue;
    sharedBeliefs += 1;
    const w = Math.sqrt(Math.max(0, x.conviction) * Math.max(0, y.conviction));
    sharedWeight += w;
    if (x.side === y.side) {
      sameSideBeliefs += 1;
      sameSideWeight += w;
    } else {
      oppositeSideBeliefs += 1;
      oppositeSideWeight += w;
    }
  }

  // Prefer the conviction-weighted fraction; fall back to the count fraction when
  // every shared conviction is ~0 (weights vanish) so agreement stays defined.
  const agreement =
    sharedWeight > EPS
      ? (sameSideWeight / sharedWeight) * 100
      : sharedBeliefs > 0
        ? (sameSideBeliefs / sharedBeliefs) * 100
        : 0;

  return {
    agreement,
    sharedBeliefs,
    sameSideBeliefs,
    oppositeSideBeliefs,
    sharedWeight,
    sameSideWeight,
    oppositeSideWeight,
    confidence: confidenceFor(sharedBeliefs),
    evidenceLevel: evidenceLevelFor(sharedBeliefs),
  };
}
