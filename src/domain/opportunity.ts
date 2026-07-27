/**
 * Global opportunity engine — pure, deterministic, dependency-free.
 *
 * Answers: "which markets are objectively worth attention right now, and why?"
 * using ONLY canonical global market facts. NO viewer data (no wallet, Tribe,
 * Rival, match, category preference). NO IO. Fully testable.
 *
 * Two stages: (A) each of the six types evaluates its own candidacy from an
 * evidence ladder (1h→24h→7d→lifecycle); (B) a documented precedence + hysteresis
 * chooses ONE primary type. Scoring is separate from classification and bounded to
 * 0..100. Every result carries its window, sample size, confidence, reason code
 * and a structured evidence payload — evidence before labels.
 */
import { OPP, logScale01, clamp01, clamp100 } from "./opportunity-config";

export type OpportunityType = "hot" | "early" | "hidden" | "contested" | "conviction" | "new";
export type Confidence = "low" | "medium" | "high";
export type OppWindow = "1h" | "24h" | "7d" | "lifecycle";

export interface OpportunityInput {
  marketId: string;
  marketAgeHours: number | null;
  directionalBelievers: number;
  believersYes: number;
  believersNo: number;
  uniqueWallets1h: number;
  uniqueWallets24h: number;
  uniqueWallets7d: number;
  newBelievers1h: number;
  newBelievers24h: number;
  newBelievers7d: number;
  volumeEth1h: number;
  volumeEth24h: number;
  volumeEth7d: number;
  tradeCount1h: number;
  tradeCount24h: number;
  tradeCount7d: number;
  circulation1h: number | null;
  circulation24h: number | null;
  circulation7d: number | null;
  sellRate24h: number | null;
  peopleYesPct: number | null; // 0..100
  moneyYesPct: number | null; // 0..100
  totalCapitalUsd: number | null;
  avgDirectionalDays: number | null;
  medianDirectionalDays: number | null;
  avgConvictionStrength: number | null; // 0..1
  priceChange1h: number | null;
  priceChange24h: number | null;
  hasValidPrices: boolean;
  lastTradeAt: string | null;
  calculatedAt: string | null;
}

export interface OpportunityContext {
  nowMs: number;
  eligibleMarketCount: number; // for percentile availability + cold-start
  prevType?: OpportunityType | null;
  prevTypeStrength?: number | null; // strength that produced prevType last time
}

interface TypeCandidate {
  type: OpportunityType;
  qualifies: boolean;
  strength: number; // 0..1
  window: OppWindow;
  sampleSize: number;
  reasonCode: string | null;
  evidence: Record<string, unknown>;
}

export interface OpportunityResult {
  eligible: boolean;
  ineligibleReason: string | null;
  type: OpportunityType | null;
  rawScore: number;
  normalizedScore: number;
  reasonCode: string | null;
  window: OppWindow | null;
  sampleSize: number;
  confidence: Confidence;
  percentilesAvailable: boolean;
  evidence: Record<string, unknown>;
}

// ── Concentration proxy (canonical fields only: trades ÷ unique wallets) ──────
function concentration(input: OpportunityInput): number {
  const wallets = input.uniqueWallets24h;
  if (wallets <= 0) return 0;
  const tpw = input.tradeCount24h / wallets;
  return clamp01(
    (tpw - OPP.CONCENTRATION_TRADES_PER_WALLET_FLOOR) / OPP.CONCENTRATION_TRADES_PER_WALLET_SPAN,
  );
}

// ── Eligibility gate ─────────────────────────────────────────────────────────
export function eligibility(input: OpportunityInput, ctx: OpportunityContext): string | null {
  if (input.marketAgeHours == null) return "missing_market_time";
  if (!input.hasValidPrices) return "missing_price_state";
  if (input.totalCapitalUsd != null && input.totalCapitalUsd < 0) return "invalid_capital";
  if (input.calculatedAt) {
    const age = (ctx.nowMs - new Date(input.calculatedAt).getTime()) / 1000;
    if (age > OPP.STALE_SECONDS) return "stale_market_state";
  }
  const anyActivity = input.tradeCount7d > 0 || input.directionalBelievers > 0;
  if (!anyActivity) return "no_participation";
  return null;
}

// ── Type classifiers (Stage A) ───────────────────────────────────────────────
function hotCandidate(input: OpportunityInput): TypeCandidate {
  const base = (): TypeCandidate => ({
    type: "hot",
    qualifies: false,
    strength: 0,
    window: "1h",
    sampleSize: 0,
    reasonCode: null,
    evidence: {},
  });
  // 1h vs the 24h hourly baseline.
  const baseline1h = Math.max(input.uniqueWallets24h / 24, OPP.HOT_BASELINE_FLOOR);
  const accel1h = input.uniqueWallets1h / baseline1h;
  if (input.uniqueWallets1h >= OPP.HOT_MIN_UNIQUE_WALLETS_1H && accel1h >= OPP.HOT_MIN_ACCEL) {
    return {
      ...base(),
      qualifies: true,
      window: "1h",
      sampleSize: input.uniqueWallets1h,
      strength: clamp01(
        0.4 * logScale01(input.uniqueWallets1h, 30) + 0.6 * clamp01((accel1h - 1) / 3),
      ),
      reasonCode: input.volumeEth1h > 0 ? "HOT_ACCELERATING_BREADTH" : "HOT_ACCELERATING_BREADTH",
      evidence: {
        window: "1h",
        unique_wallets: input.uniqueWallets1h,
        baseline_wallets_per_hour: round(baseline1h, 2),
        acceleration: round(accel1h, 2),
        volume_eth: round(input.volumeEth1h, 4),
        new_believers: input.newBelievers1h,
        concentration: round(concentration(input), 2),
      },
    };
  }
  // 24h fallback vs the 7d hourly baseline ("accelerating today").
  const baseline24h = Math.max(input.uniqueWallets7d / (7 * 24), OPP.HOT_BASELINE_FLOOR);
  const rate24h = input.uniqueWallets24h / 24;
  const accel24h = rate24h / baseline24h;
  if (input.uniqueWallets24h >= OPP.HOT_MIN_UNIQUE_WALLETS_24H && accel24h >= OPP.HOT_MIN_ACCEL) {
    return {
      ...base(),
      qualifies: true,
      window: "24h",
      sampleSize: input.uniqueWallets24h,
      strength:
        clamp01(0.5 * logScale01(input.uniqueWallets24h, 60) + 0.5 * clamp01((accel24h - 1) / 3)) *
        0.85,
      reasonCode: "HOT_ACCELERATING_VOLUME",
      evidence: {
        window: "24h",
        unique_wallets: input.uniqueWallets24h,
        baseline_wallets_per_hour: round(baseline24h, 2),
        acceleration: round(accel24h, 2),
        volume_eth: round(input.volumeEth24h, 4),
        new_believers: input.newBelievers24h,
        concentration: round(concentration(input), 2),
      },
    };
  }
  return base();
}

function earlyCandidate(input: OpportunityInput): TypeCandidate {
  const notMature = input.directionalBelievers <= OPP.EARLY_MAX_DIRECTIONAL;
  const w: OppWindow | null =
    input.newBelievers1h >= OPP.EARLY_MIN_NEW_BELIEVERS &&
    input.uniqueWallets1h >= OPP.EARLY_MIN_WALLETS
      ? "1h"
      : input.newBelievers24h >= OPP.EARLY_MIN_NEW_BELIEVERS &&
          input.uniqueWallets24h >= OPP.EARLY_MIN_WALLETS
        ? "24h"
        : input.newBelievers7d >= OPP.EARLY_MIN_NEW_BELIEVERS &&
            input.uniqueWallets7d >= OPP.EARLY_MIN_WALLETS
          ? "7d"
          : null;
  const hasCapital = (input.totalCapitalUsd ?? 0) > 0 || (input.circulation24h ?? 0) > 0;
  if (!notMature || !w || !hasCapital) {
    return {
      type: "early",
      qualifies: false,
      strength: 0,
      window: "24h",
      sampleSize: 0,
      reasonCode: null,
      evidence: {},
    };
  }
  const nb =
    w === "1h" ? input.newBelievers1h : w === "24h" ? input.newBelievers24h : input.newBelievers7d;
  const wallets =
    w === "1h"
      ? input.uniqueWallets1h
      : w === "24h"
        ? input.uniqueWallets24h
        : input.uniqueWallets7d;
  const room = clamp01(1 - input.directionalBelievers / OPP.EARLY_MAX_DIRECTIONAL);
  const strength = clamp01(0.5 * logScale01(nb, 20) + 0.3 * logScale01(wallets, 20) + 0.2 * room);
  return {
    type: "early",
    qualifies: true,
    strength,
    window: w,
    sampleSize: wallets,
    reasonCode: nb >= wallets ? "EARLY_NEW_BELIEVERS" : "EARLY_BREADTH_WITH_LOW_MATURITY",
    evidence: {
      window: w,
      new_believers: nb,
      unique_wallets: wallets,
      directional_believers: input.directionalBelievers,
      maturity_cap: OPP.EARLY_MAX_DIRECTIONAL,
      concentration: round(concentration(input), 2),
    },
  };
}

function hiddenCandidate(input: OpportunityInput): TypeCandidate {
  const cap = input.totalCapitalUsd;
  const conc = concentration(input);
  // Denominator safety: circulation only trustworthy above the capital floor.
  const capValid = cap != null && cap >= OPP.CAPITAL_FLOOR_USD;
  const lowVisible = cap != null && cap <= OPP.HIDDEN_MAX_CAPITAL_USD;
  const w: OppWindow | null =
    (input.circulation1h ?? 0) >= OPP.HIDDEN_MIN_CIRCULATION &&
    input.uniqueWallets1h >= OPP.HIDDEN_MIN_WALLETS
      ? "1h"
      : (input.circulation24h ?? 0) >= OPP.HIDDEN_MIN_CIRCULATION &&
          input.uniqueWallets24h >= OPP.HIDDEN_MIN_WALLETS
        ? "24h"
        : (input.circulation7d ?? 0) >= OPP.HIDDEN_MIN_CIRCULATION &&
            input.uniqueWallets7d >= OPP.HIDDEN_MIN_WALLETS
          ? "7d"
          : null;
  const wallets =
    w === "1h"
      ? input.uniqueWallets1h
      : w === "24h"
        ? input.uniqueWallets24h
        : (input.uniqueWallets7d ?? 0);
  const circ =
    w === "1h" ? input.circulation1h : w === "24h" ? input.circulation24h : input.circulation7d;
  if (
    !capValid ||
    !lowVisible ||
    !w ||
    wallets < OPP.HIDDEN_MIN_WALLETS ||
    conc > OPP.HIDDEN_MAX_CONCENTRATION
  ) {
    return {
      type: "hidden",
      qualifies: false,
      strength: 0,
      window: "24h",
      sampleSize: 0,
      reasonCode: null,
      evidence: {},
    };
  }
  const sizeRelative = clamp01(1 - logScale01(cap ?? 0, OPP.HIDDEN_MAX_CAPITAL_USD));
  const strength = clamp01(
    0.5 * clamp01((circ ?? 0) / 5) + 0.3 * logScale01(wallets, 20) + 0.2 * sizeRelative,
  );
  return {
    type: "hidden",
    qualifies: true,
    strength,
    window: w,
    sampleSize: wallets,
    reasonCode: "HIDDEN_HIGH_CIRCULATION_LOW_CAPITAL",
    evidence: {
      window: w,
      circulation: round(circ ?? 0, 2),
      unique_wallets: wallets,
      total_capital_usd: round(cap ?? 0, 2),
      concentration: round(conc, 2),
    },
  };
}

function contestedCandidate(input: OpportunityInput): TypeCandidate {
  const pYes = input.peopleYesPct;
  const balance = pYes == null ? 0 : clamp01(1 - Math.abs(pYes / 100 - 0.5) * 2);
  const bothSides =
    input.believersYes >= OPP.MIN_CONTESTED_SIDE_BELIEVERS &&
    input.believersNo >= OPP.MIN_CONTESTED_SIDE_BELIEVERS;
  const active = input.tradeCount24h >= OPP.CONTESTED_MIN_RECENT_TRADES;
  if (balance < OPP.CONTESTED_BALANCE_MIN || !bothSides || !active) {
    return {
      type: "contested",
      qualifies: false,
      strength: 0,
      window: "24h",
      sampleSize: 0,
      reasonCode: null,
      evidence: {},
    };
  }
  const divergence =
    pYes != null && input.moneyYesPct != null ? Math.abs(pYes - input.moneyYesPct) : 0;
  const strength = clamp01(0.6 * balance + 0.4 * logScale01(input.tradeCount24h, 40));
  return {
    type: "contested",
    qualifies: true,
    strength,
    window: "24h",
    sampleSize: input.believersYes + input.believersNo,
    reasonCode:
      divergence >= 15 ? "CONTESTED_PEOPLE_MONEY_DISAGREEMENT" : "CONTESTED_BALANCED_ACTIVE_SIDES",
    evidence: {
      window: "24h",
      believers_yes: input.believersYes,
      believers_no: input.believersNo,
      people_yes_pct: pYes == null ? null : round(pYes, 1),
      money_yes_pct: input.moneyYesPct == null ? null : round(input.moneyYesPct, 1),
      trade_count_24h: input.tradeCount24h,
    },
  };
}

function convictionCandidate(input: OpportunityInput): TypeCandidate {
  const persistence = input.medianDirectionalDays;
  const strengthAvg = input.avgConvictionStrength;
  const cohort = input.directionalBelievers;
  const hasPersistence = persistence != null && persistence >= OPP.CONVICTION_MIN_MEDIAN_DAYS;
  const hasStrength = strengthAvg != null && strengthAvg >= OPP.CONVICTION_MIN_STRENGTH;
  const hasBreadth = cohort >= OPP.CONVICTION_MIN_COHORT;
  // CHALLENGE: real recent circulation, selling, or an active opposing side.
  const circ7d = input.circulation7d ?? 0;
  const sell = input.sellRate24h ?? 0;
  const opposing =
    Math.min(input.believersYes, input.believersNo) >= OPP.MIN_CONTESTED_SIDE_BELIEVERS;
  const challenge =
    circ7d >= OPP.CONVICTION_MIN_CIRCULATION_7D ||
    (input.tradeCount24h >= OPP.MIN_TRADES_FOR_SELL_RATE && sell >= OPP.CONVICTION_MIN_SELL_RATE) ||
    (opposing && input.tradeCount7d >= OPP.CONTESTED_MIN_RECENT_TRADES);
  if (!hasPersistence || !hasStrength || !hasBreadth || !challenge) {
    return {
      type: "conviction",
      qualifies: false,
      strength: 0,
      window: "7d",
      sampleSize: cohort,
      reasonCode: null,
      evidence: {},
    };
  }
  const strength = clamp01(
    0.4 * clamp01((persistence ?? 0) / 30) + 0.3 * (strengthAvg ?? 0) + 0.3 * clamp01(circ7d / 5),
  );
  return {
    type: "conviction",
    qualifies: true,
    strength,
    window: circ7d >= OPP.CONVICTION_MIN_CIRCULATION_7D ? "7d" : "lifecycle",
    sampleSize: cohort,
    reasonCode:
      circ7d >= OPP.CONVICTION_MIN_CIRCULATION_7D
        ? "CONVICTION_PERSISTENCE_UNDER_CHALLENGE"
        : "CONVICTION_BREADTH_WITH_CIRCULATION",
    evidence: {
      median_directional_days: round(persistence ?? 0, 1),
      avg_conviction_strength: round(strengthAvg ?? 0, 2),
      directional_believers: cohort,
      circulation_7d: round(circ7d, 2),
      sell_rate_24h: input.sellRate24h == null ? null : round(input.sellRate24h, 2),
    },
  };
}

function newCandidate(input: OpportunityInput): TypeCandidate {
  const recent = input.marketAgeHours != null && input.marketAgeHours <= OPP.NEW_MARKET_MAX_HOURS;
  return {
    type: "new",
    qualifies: recent,
    strength: recent ? 0.2 : 0,
    window: "lifecycle",
    sampleSize: input.directionalBelievers,
    reasonCode: recent ? "NEW_RECENT_MARKET" : null,
    evidence: {
      market_age_hours: input.marketAgeHours == null ? null : round(input.marketAgeHours, 1),
      max_hours: OPP.NEW_MARKET_MAX_HOURS,
    },
  };
}

// ── Precedence (Stage B) ─────────────────────────────────────────────────────
// Documented order: Hot (when unusually strong) → Contested → Conviction → Early
// → Hidden → New (fallback). A type only reaches here if its gates (which include
// strength/challenge minimums) pass. New never wins over a qualifying real type.
const PRECEDENCE: OpportunityType[] = ["hot", "contested", "conviction", "early", "hidden", "new"];

function pickPrimary(cands: Map<OpportunityType, TypeCandidate>): TypeCandidate | null {
  // Hot only "wins first" when its acceleration is unusually strong; otherwise it
  // still competes but doesn't preempt a defining Contested/Conviction feature.
  const hot = cands.get("hot");
  if (hot?.qualifies && hot.strength >= OPP.HOT_STRONG_STRENGTH) return hot;
  for (const t of PRECEDENCE) {
    const c = cands.get(t);
    if (c?.qualifies) {
      // New is fallback: only if nothing non-new qualified (handled by order —
      // new is last, so reaching it means no earlier type qualified).
      return c;
    }
  }
  return null;
}

// ── Confidence ───────────────────────────────────────────────────────────────
function confidenceOf(
  input: OpportunityInput,
  cand: TypeCandidate,
  ctx: OpportunityContext,
  percentilesAvailable: boolean,
): Confidence {
  const conc = concentration(input);
  let signals = 0;
  if (cand.sampleSize >= OPP.MIN_ACTIVITY_WALLETS) signals++;
  if (cand.sampleSize >= 10) signals++;
  if (cand.window === "1h" || cand.window === "24h") signals++;
  if (conc <= 0.3) signals++;
  if (percentilesAvailable) signals++;
  if (cand.type === "new") return "low";
  if (conc > 0.6 || cand.sampleSize < OPP.MIN_ACTIVITY_WALLETS) return "low";
  if (signals >= 4) return "high";
  if (signals >= 2) return "medium";
  return "low";
}

// ── Score ────────────────────────────────────────────────────────────────────
function scoreOf(
  input: OpportunityInput,
  cand: TypeCandidate,
  confidence: Confidence,
  ctx: OpportunityContext,
): { raw: number; normalized: number } {
  const globalQuality =
    (0.35 * logScale01(input.uniqueWallets24h, 60) +
      0.25 * logScale01(input.volumeEth24h, 50) +
      0.25 * logScale01(input.directionalBelievers, 200) +
      0.15 * clamp01((input.circulation24h ?? 0) / 5)) *
    OPP.W_GLOBAL_QUALITY;
  const typeStrength = cand.strength * OPP.W_TYPE_STRENGTH;
  const confBonus = OPP.CONFIDENCE_BONUS[confidence];

  let staleness = 0;
  if (input.calculatedAt) {
    const age = (ctx.nowMs - new Date(input.calculatedAt).getTime()) / 1000;
    staleness = clamp01(age / OPP.STALE_SECONDS) * OPP.STALENESS_PENALTY_MAX;
  }
  const concPenalty = concentration(input) * OPP.CONCENTRATION_PENALTY_MAX;

  const raw = globalQuality + typeStrength + confBonus;
  const normalized = clamp100(raw - staleness - concPenalty);
  return { raw: clamp100(raw), normalized };
}

// ── Entry point ──────────────────────────────────────────────────────────────
export function evaluateOpportunity(
  input: OpportunityInput,
  ctx: OpportunityContext,
): OpportunityResult {
  const ineligible = eligibility(input, ctx);
  const percentilesAvailable = ctx.eligibleMarketCount >= OPP.MIN_MARKETS_FOR_PERCENTILES;
  const emptyEvidence = { percentiles_available: percentilesAvailable };
  if (ineligible) {
    return {
      eligible: false,
      ineligibleReason: ineligible,
      type: null,
      rawScore: 0,
      normalizedScore: 0,
      reasonCode: null,
      window: null,
      sampleSize: 0,
      confidence: "low",
      percentilesAvailable,
      evidence: emptyEvidence,
    };
  }

  const cands = new Map<OpportunityType, TypeCandidate>([
    ["hot", hotCandidate(input)],
    ["contested", contestedCandidate(input)],
    ["conviction", convictionCandidate(input)],
    ["early", earlyCandidate(input)],
    ["hidden", hiddenCandidate(input)],
    ["new", newCandidate(input)],
  ]);

  let winner = pickPrimary(cands);

  // Hysteresis: keep the current type unless the new winner beats it by a margin
  // (or the current type no longer qualifies).
  if (winner && ctx.prevType && ctx.prevType !== winner.type) {
    const prev = cands.get(ctx.prevType);
    if (prev?.qualifies && winner.strength < prev.strength + OPP.HYSTERESIS_MARGIN) {
      winner = prev;
    }
  }

  if (!winner) {
    // No type qualified. A recent market would have matched New, so this market is
    // not recent and has no meaningful signal → excluded from the opportunity feed.
    return {
      eligible: false,
      ineligibleReason: "insufficient_evidence",
      type: null,
      rawScore: 0,
      normalizedScore: 0,
      reasonCode: null,
      window: null,
      sampleSize: 0,
      confidence: "low",
      percentilesAvailable,
      evidence: emptyEvidence,
    };
  }

  const confidence = confidenceOf(input, winner, ctx, percentilesAvailable);
  const { raw, normalized } = scoreOf(input, winner, confidence, ctx);
  return {
    eligible: true,
    ineligibleReason: null,
    type: winner.type,
    rawScore: round(raw, 2),
    normalizedScore: round(normalized, 2),
    reasonCode: winner.reasonCode,
    window: winner.window,
    sampleSize: winner.sampleSize,
    confidence,
    percentilesAvailable,
    evidence: { ...winner.evidence, percentiles_available: percentilesAvailable },
  };
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Explainability (item 31): full per-type candidacy + eligibility + final result
 * for one market. Pure — for tuning + the debug endpoint, never product copy.
 */
export function debugEvaluate(input: OpportunityInput, ctx: OpportunityContext) {
  return {
    eligibility: eligibility(input, ctx),
    percentilesAvailable: ctx.eligibleMarketCount >= OPP.MIN_MARKETS_FOR_PERCENTILES,
    concentration: concentration(input),
    candidates: {
      hot: hotCandidate(input),
      contested: contestedCandidate(input),
      conviction: convictionCandidate(input),
      early: earlyCandidate(input),
      hidden: hiddenCandidate(input),
      new: newCandidate(input),
    },
    result: evaluateOpportunity(input, ctx),
  };
}
