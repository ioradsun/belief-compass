/**
 * Conviction DNA — exact relationship scoring (canonical, pure, v1).
 *
 * ZERO IO. The ONE module that owns DNA scoring. Given two wallets' actions,
 * agreement is the conviction-weighted fraction of shared markets they take the
 * SAME action on. Confidence (evidence depth) is returned separately and is never
 * folded into agreement.
 *
 * ACTIONS ARE YES, NO, OR PASS. Directional beliefs (YES/NO) carry conviction and
 * are what "shared convictions" and the evidence tiers count. A PASS is
 * non-directional — two people declining the same question share something, so it
 * counts toward AGREEMENT (both-passed is a match) but never toward the shared-
 * conviction evidence that mints a strong label. A pass and a stated side are
 * INCOMPARABLE (not opposites): they are skipped, never scored against each other.
 * Conviction weights are clamped to ≥0.
 */
import {
  confidenceFor,
  evidenceLevelFor,
  PAST_WEIGHT,
  PASS_MATCH_WEIGHT,
  type EvidenceLevel,
} from "./config";

/** A wallet's action in one market — a directional stake, or a pass. */
export interface DnaFactor {
  marketId: string | number;
  side: "YES" | "NO" | "PASS";
  /** Absolute normalized conviction strength, 0..1. A pass carries PASS_MATCH_WEIGHT. */
  conviction: number;
  /**
   * Have they LEFT this position? A remembered side, not a held one.
   *
   * Absent means currently held, so every existing caller keeps its meaning
   * without a change. See PAST_WEIGHT for what a remembered side is worth. Never
   * set on a pass.
   */
  past?: boolean;
}

export interface DnaScore {
  /** Conviction-weighted same-side fraction, 0..100 (100 = full agreement). */
  agreement: number;
  /** Every conviction the two have shared, held or remembered. The human count. */
  sharedBeliefs: number;
  sameSideBeliefs: number;
  oppositeSideBeliefs: number;
  /** Shared convictions BOTH still hold. */
  currentShared: number;
  /** Shared convictions at least one of them has left. */
  pastShared: number;
  /**
   * Shared convictions in CURRENT-EQUIVALENT terms:
   * `currentShared + PAST_WEIGHT × pastShared`.
   *
   * This — not the raw count — is what confidence and every evidence threshold
   * read, so a bar that meant "eight convictions worth of evidence" still means
   * that after history was let in. Thirty-two remembered markets do not quietly
   * mint a Twin.
   */
  evidence: number;
  sharedWeight: number;
  sameSideWeight: number;
  oppositeSideWeight: number;
  /** Evidence confidence, 0..1 — separate from agreement. */
  confidence: number;
  evidenceLevel: EvidenceLevel;
}

const EPS = 1e-9;
const key = (m: string | number) => String(m);
const isAction = (s: string): boolean => s === "YES" || s === "NO" || s === "PASS";

export function scoreRelationship(a: DnaFactor[], b: DnaFactor[]): DnaScore {
  const byId = new Map<string, DnaFactor>();
  for (const x of a) {
    if (isAction(x.side)) byId.set(key(x.marketId), x);
  }

  let sharedBeliefs = 0;
  let sameSideBeliefs = 0;
  let oppositeSideBeliefs = 0;
  let currentShared = 0;
  let pastShared = 0;
  let sharedWeight = 0;
  let sameSideWeight = 0;
  let oppositeSideWeight = 0;

  for (const y of b) {
    if (!isAction(y.side)) continue;
    const x = byId.get(key(y.marketId));
    if (!x) continue;
    const xPass = x.side === "PASS";
    const yPass = y.side === "PASS";
    // A pass and a stated side are INCOMPARABLE — one declined, one committed.
    // Not agreement, not opposition; simply not a shared stance to score.
    if (xPass !== yPass) continue;

    // A shared market is LIVE only while both are still standing in it. If
    // either has left, this is a place the two once met — and the weaker of the
    // two claims is the honest one to carry. (A pass is never "past".)
    const live = !x.past && !y.past;
    const convX = xPass ? PASS_MATCH_WEIGHT : Math.max(0, x.conviction);
    const convY = yPass ? PASS_MATCH_WEIGHT : Math.max(0, y.conviction);
    const w = Math.sqrt(convX * convY) * (live ? 1 : PAST_WEIGHT);
    sharedWeight += w;
    // Both-passed is a match; YES/NO are compared exactly as before.
    const same = x.side === y.side;
    if (same) sameSideWeight += w;
    else oppositeSideWeight += w;

    // A PASS never counts as a shared CONVICTION. The human "shared beliefs"
    // count, the together/apart tallies and the evidence tiers stay directional,
    // so mutual indifference shapes the percentage without minting a Twin or a
    // Circle out of it.
    if (!xPass) {
      sharedBeliefs += 1;
      if (live) currentShared += 1;
      else pastShared += 1;
      if (same) sameSideBeliefs += 1;
      else oppositeSideBeliefs += 1;
    }
  }
  const evidence = currentShared + PAST_WEIGHT * pastShared;

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
    currentShared,
    pastShared,
    evidence,
    sharedWeight,
    sameSideWeight,
    oppositeSideWeight,
    // Confidence and the evidence tier read CURRENT-EQUIVALENT convictions, never
    // the raw count — otherwise letting history in would have silently loosened
    // every threshold that was calibrated against live positions.
    confidence: confidenceFor(evidence),
    evidenceLevel: evidenceLevelFor(evidence),
  };
}
