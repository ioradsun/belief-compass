/**
 * Conviction DNA — candidate generation (pure).
 *
 * ZERO IO. Turns "other wallets that share directional markets with the viewer"
 * into a bounded, deterministically-ranked candidate pool BEFORE any exact DNA
 * scoring runs. This is where scale is won: only plausible candidates (enough
 * shared directional markets, weighted by market distinctiveness) survive.
 *
 * Candidate weighting is a RETRIEVAL heuristic only — it never appears as the
 * user-facing DNA score. The canonical exact score is `scoreRelationship`
 * (src/domain/dna/score.ts).
 */
import { EPSILON, type Side } from "./domain";
import { DNA_THRESHOLDS, DNA_LIMITS } from "./dna/config";

/** One (candidate wallet, shared market) directional observation. */
export interface SharedBeliefRow {
  wallet: string;
  onchain_id: number;
  stance_side: Side;
  conviction: number;
  last_trade_at?: string | null;
}

export interface MatchCandidate {
  wallet: string;
  sharedMarkets: number;
  sameSideMarkets: number;
  oppositeSideMarkets: number;
  /** Cheap agreement tendency in [-1,1] (same−opposite)/shared — NOT the DNA score. */
  preliminaryAgreement: number;
  /** Σ sqrt(convViewer·convCand)·distinctiveness — the retrieval ranking key. */
  weightedSharedEvidence: number;
  lastSharedActivityAt: string | null;
}

/**
 * Market distinctiveness for candidate retrieval: a belief shared in a rarer
 * market is stronger evidence than one shared in a market everyone holds. This
 * downweights ubiquitous markets so one massive popular market cannot, by itself,
 * make everyone look related. Decreasing in the directional participant count.
 *
 * distinctiveness(p) = 1 / log2(2 + p)   → p=0 →1, p=2 →0.5, p=30 →~0.2, p=1000 →~0.1
 */
export function marketDistinctiveness(directionalParticipants: number): number {
  const p = Math.max(0, directionalParticipants);
  return 1 / Math.log2(2 + p);
}

export interface AggregateOptions {
  minShared?: number;
  maxCandidates?: number;
}

/**
 * Aggregate raw shared-belief rows into bounded candidates.
 *
 * @param viewerSides   viewer's directional side per market (YES/NO only)
 * @param rows          other wallets' directional beliefs in the viewer's markets
 * @param viewerConv    viewer's conviction per market (for weighted evidence)
 * @param popularity    directional participant count per market (distinctiveness)
 */
export function aggregateCandidates(
  viewerSides: Map<number, "YES" | "NO">,
  viewerConv: Map<number, number>,
  rows: SharedBeliefRow[],
  popularity: Map<number, number>,
  opts: AggregateOptions = {},
): MatchCandidate[] {
  const minShared = opts.minShared ?? DNA_THRESHOLDS.minSharedOverall;
  const maxCandidates = opts.maxCandidates ?? DNA_LIMITS.maxExactScored;

  type Acc = {
    shared: number;
    same: number;
    opp: number;
    evidence: number;
    lastAt: number;
  };
  const byWallet = new Map<string, Acc>();

  for (const r of rows) {
    if (r.stance_side !== "YES" && r.stance_side !== "NO") continue;
    const vSide = viewerSides.get(r.onchain_id);
    if (!vSide) continue; // only markets the viewer is directional in
    const w = r.wallet;
    const acc = byWallet.get(w) ?? { shared: 0, same: 0, opp: 0, evidence: 0, lastAt: 0 };
    acc.shared += 1;
    if (r.stance_side === vSide) acc.same += 1;
    else acc.opp += 1;
    const distinct = marketDistinctiveness(popularity.get(r.onchain_id) ?? 0);
    const vConv = Math.max(0, viewerConv.get(r.onchain_id) ?? 0);
    const cConv = Math.max(0, r.conviction ?? 0);
    acc.evidence += Math.sqrt(vConv * cConv) * distinct;
    const t = r.last_trade_at ? new Date(r.last_trade_at).getTime() : 0;
    if (t > acc.lastAt) acc.lastAt = t;
    byWallet.set(w, acc);
  }

  const candidates: MatchCandidate[] = [];
  for (const [wallet, a] of byWallet) {
    if (a.shared < minShared) continue; // prune before exact scoring
    candidates.push({
      wallet,
      sharedMarkets: a.shared,
      sameSideMarkets: a.same,
      oppositeSideMarkets: a.opp,
      preliminaryAgreement: a.shared > 0 ? (a.same - a.opp) / a.shared : 0,
      weightedSharedEvidence: a.evidence,
      lastSharedActivityAt: a.lastAt > 0 ? new Date(a.lastAt).toISOString() : null,
    });
  }

  return rankAndCapCandidates(candidates, maxCandidates);
}

/**
 * Deterministic ranking + cap. Highest weighted evidence first, then more shared
 * markets, then a stable wallet tie-breaker — so the same viewer always gets the
 * same bounded pool (never a random sample). Capped at maxCandidates.
 */
export function rankAndCapCandidates(
  candidates: MatchCandidate[],
  maxCandidates: number = DNA_LIMITS.maxExactScored,
): MatchCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (Math.abs(b.weightedSharedEvidence - a.weightedSharedEvidence) > EPSILON)
      return b.weightedSharedEvidence - a.weightedSharedEvidence;
    if (b.sharedMarkets !== a.sharedMarkets) return b.sharedMarkets - a.sharedMarkets;
    return a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0;
  });
  return sorted.slice(0, maxCandidates);
}
