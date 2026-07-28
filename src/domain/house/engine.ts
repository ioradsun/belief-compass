/**
 * House Read — the prediction engine (canonical, pure, v1). ZERO IO.
 *
 * Two explainable stages, no black box:
 *   Stage 1 (engagement): P(BUY) vs P(SKIP) — will they act at all?
 *   Stage 2 (direction):  P(YES | BUY) vs P(NO | BUY) — which side?
 * Combined → P(BUY_YES), P(BUY_NO), P(SKIP); the argmax is the locked action.
 *
 * Everything is weighted log-odds with sample-size shrinkage, so every call can
 * name WHY (reasonCodes). Deterministic for a fixed bundle + engineVersion — the
 * only nondeterministic input is a caller-supplied `tiebreak` in [0,1), derived
 * from stable non-secret inputs (never browser randomness), used solely to settle
 * exact ties. The server turns reasonCodes into honest, specific sentences.
 */
import {
  HOUSE_ENGINE_VERSION,
  confidenceBand,
  clamp01,
  type HouseAction,
  type HouseConfidenceBand,
} from "./config";

/**
 * Normalized signals for one (user, market). Every field is optional/nullable;
 * a missing signal contributes nothing and the engine shrinks toward priors.
 * The server assembles this from Conviction DNA, positions, and market data — the
 * engine never touches the database.
 */
export interface SignalBundle {
  // ── engagement (act vs skip) ──
  /** Lifetime skip fraction, 0..1 — the base rate for acting. */
  overallSkipRate?: number | null;
  /** Skip fraction within this market's category, 0..1. */
  categorySkipRate?: number | null;
  /** Recent (last-N) skip fraction, 0..1. */
  recentSkipRate?: number | null;
  /** How engaged the user is in this category, 0..1 (count-based). */
  categoryEngagement?: number | null;
  /** Similarity of this belief to ones the user already holds, 0..1. */
  semanticSimilarityToPriors?: number | null;
  hasTwinPosition?: boolean;
  hasTribePosition?: boolean;
  hasOppPosition?: boolean;

  // ── direction (which side), each in [-1,1] where + = leans YES ──
  /** The user's own directional history in this category. */
  categoryDirectionalLean?: number | null;
  /** Closest Twin's side here (+1 YES, −1 NO). */
  twinLean?: number | null;
  /** Tribe's aggregate side here. */
  tribeLean?: number | null;
  /** An Opp's side here — the engine INVERTS this (you diverge from your opposite). */
  oppLean?: number | null;
  /** Market money-YES share, 0..1 (the crowd). */
  crowdYesPct?: number | null;
  /** How much the user follows the crowd: +1 follows, −1 contrarian. */
  crowdSensitivity?: number | null;
  /** How absolutist the market's wording is, 0..1 (absolutes nudge toward NO). */
  framingAbsolutism?: number | null;

  // ── sample sizes for shrinkage ──
  /** Directional decisions observed in this category (shrinks category signals). */
  categorySamples?: number;
  /** Total directional positions the user holds (shrinks personal-history signals). */
  priorPositions?: number;
}

export interface HousePrediction {
  action: HouseAction;
  pBuyYes: number;
  pBuyNo: number;
  pSkip: number;
  /** Max probability — drives the confidence band and the post-reveal number. */
  confidence: number;
  band: HouseConfidenceBand;
  /** Ranked, most-impactful first; server renders these into sentences. */
  reasonCodes: string[];
  engineVersion: number;
}

// ── weights (named for explainability; tuned, not learned) ───────────────────
const W = {
  categoryEngagement: 1.1,
  categorySkip: 1.3,
  recentSkip: 0.9,
  overallSkipPrior: 1.6,
  semanticSimilarity: 1.0,
  socialPresence: 0.5, // per twin/tribe/opp position present
  categoryDirection: 1.4,
  twin: 1.2,
  tribe: 0.9,
  opp: 0.8,
  crowd: 0.7,
  framing: 0.4,
} as const;

const SHRINK_K_CATEGORY = 5;
const SHRINK_K_PERSONAL = 8;

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const num = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : v;
/** Damp a signal by evidence depth: value · n/(n+k). */
const shrink = (value: number, samples: number, k: number): number =>
  value * (Math.max(0, samples) / (Math.max(0, samples) + k));

interface Contribution {
  code: string;
  impact: number; // signed contribution to the relevant logit
}

/**
 * Predict the user's finalized action. Pure and deterministic given
 * (sig, tiebreak, engineVersion). `tiebreak` (0..1) only settles exact ties.
 */
export function predictHouse(
  sig: SignalBundle,
  tiebreak = 0.5,
  engineVersion: number = HOUSE_ENGINE_VERSION,
): HousePrediction {
  const catN = Math.max(0, sig.categorySamples ?? 0);
  const persN = Math.max(0, sig.priorPositions ?? 0);

  // ── Stage 1: engagement logit (+ favors BUY) ──
  const engage: Contribution[] = [];
  const overallSkip = num(sig.overallSkipRate);
  // Prior: a high lifetime skip rate pulls the base toward SKIP.
  let engageLogit = overallSkip == null ? 0 : (0.5 - overallSkip) * 2 * W.overallSkipPrior;
  if (overallSkip != null) engage.push({ code: "OVERALL_SKIP", impact: engageLogit });

  const catEng = num(sig.categoryEngagement);
  if (catEng != null) {
    const i = shrink((catEng - 0.5) * 2, catN, SHRINK_K_CATEGORY) * W.categoryEngagement;
    engageLogit += i;
    engage.push({ code: "CATEGORY_ENGAGEMENT", impact: i });
  }
  const catSkip = num(sig.categorySkipRate);
  if (catSkip != null) {
    const i = shrink((0.5 - catSkip) * 2, catN, SHRINK_K_CATEGORY) * W.categorySkip;
    engageLogit += i;
    engage.push({ code: "CATEGORY_SKIP", impact: i });
  }
  const recentSkip = num(sig.recentSkipRate);
  if (recentSkip != null) {
    const i = (0.5 - recentSkip) * 2 * W.recentSkip;
    engageLogit += i;
    engage.push({ code: "RECENT_SKIP", impact: i });
  }
  const sim = num(sig.semanticSimilarityToPriors);
  if (sim != null) {
    const i = shrink((sim - 0.4) * 2, persN, SHRINK_K_PERSONAL) * W.semanticSimilarity;
    engageLogit += i;
    engage.push({ code: "SEMANTIC_SIMILARITY", impact: i });
  }
  const social =
    (sig.hasTwinPosition ? 1 : 0) + (sig.hasTribePosition ? 1 : 0) + (sig.hasOppPosition ? 1 : 0);
  if (social > 0) {
    const i = social * W.socialPresence;
    engageLogit += i;
    engage.push({ code: "SOCIAL_PRESENCE", impact: i });
  }

  // ── Stage 2: direction logit (+ favors YES) ──
  const dir: Contribution[] = [];
  let dirLogit = 0;
  const addDir = (code: string, raw: number | null, weight: number, k = 0, n = 0) => {
    if (raw == null) return;
    const i = (k > 0 ? shrink(raw, n, k) : raw) * weight;
    dirLogit += i;
    dir.push({ code, impact: i });
  };
  addDir(
    "CATEGORY_DIRECTION",
    num(sig.categoryDirectionalLean),
    W.categoryDirection,
    SHRINK_K_CATEGORY,
    catN,
  );
  addDir("TWIN_LEAN", num(sig.twinLean), W.twin);
  addDir("TRIBE_LEAN", num(sig.tribeLean), W.tribe);
  // Opp inverts: your opposite leaning YES pushes you toward NO.
  const opp = num(sig.oppLean);
  if (opp != null) addDir("OPP_LEAN", -opp, W.opp);
  const crowd = num(sig.crowdYesPct);
  const sens = num(sig.crowdSensitivity);
  if (crowd != null && sens != null) addDir("CROWD", (crowd - 0.5) * 2 * sens, W.crowd);
  const framing = num(sig.framingAbsolutism);
  if (framing != null) addDir("FRAMING", -framing, W.framing);

  // ── combine ──
  const pBuy = sigmoid(engageLogit);
  let pYesGivenBuy = sigmoid(dirLogit);
  // Deterministic tie settlement: nudge an exact directional tie by the salt.
  if (Math.abs(dirLogit) < 1e-9) pYesGivenBuy = 0.5 + (clamp01(tiebreak) - 0.5) * 1e-3;

  let pBuyYes = pBuy * pYesGivenBuy;
  let pBuyNo = pBuy * (1 - pYesGivenBuy);
  let pSkip = 1 - pBuy;
  const sum = pBuyYes + pBuyNo + pSkip || 1;
  pBuyYes /= sum;
  pBuyNo /= sum;
  pSkip /= sum;

  const action = argmax(pBuyYes, pBuyNo, pSkip, tiebreak);
  const confidence = Math.max(pBuyYes, pBuyNo, pSkip);

  return {
    action,
    pBuyYes,
    pBuyNo,
    pSkip,
    confidence,
    band: confidenceBand(confidence),
    reasonCodes: rankReasons(action, engage, dir),
    engineVersion,
  };
}

/** Argmax with a deterministic, salt-based tiebreak (never randomness). */
function argmax(yes: number, no: number, skip: number, tiebreak: number): HouseAction {
  const order: Array<[HouseAction, number]> = [
    ["BUY_YES", yes],
    ["BUY_NO", no],
    ["SKIP", skip],
  ];
  const top = Math.max(yes, no, skip);
  const tied = order.filter(([, p]) => top - p < 1e-9);
  if (tied.length === 1) return tied[0][0];
  return tied[Math.floor(clamp01(tiebreak) * tied.length) % tied.length][0];
}

/** Pick the contributions that argue FOR the chosen action, strongest first. */
function rankReasons(action: HouseAction, engage: Contribution[], dir: Contribution[]): string[] {
  const rel: Contribution[] = [];
  if (action === "SKIP") {
    for (const c of engage) if (c.impact < 0) rel.push(c);
  } else {
    for (const c of engage) if (c.impact > 0) rel.push(c);
    const wantYes = action === "BUY_YES";
    for (const c of dir) if (wantYes ? c.impact > 0 : c.impact < 0) rel.push(c);
  }
  return rel
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 3)
    .map((c) => c.code);
}
