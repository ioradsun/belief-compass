/**
 * The House — a per-viewer prediction of what THIS user will do with THIS market.
 *
 * ZERO IO, fully pure, fully tested. The House predicts a *belief action*
 * (YES / NO / SKIP) from the viewer's own answer history, their category
 * behaviour (including skips), and their Conviction DNA relationships on this
 * market. It never predicts price and it never bluffs: when the evidence is
 * thin or contradictory it returns an honest no-read state instead of a side.
 */

export type BeliefAction = "YES" | "NO" | "SKIP";

export type NoReadKind =
  | "no_user"
  | "cold_start"
  | "new_category"
  | "conflicting"
  | "weak_sample"
  | "no_relationship_signal";

/** Bump when the prediction rules change materially. */
export const HOUSE_ENGINE_VERSION = 1;

/** Answers needed before the House will read anyone at all. */
export const FOUNDATION_ANSWERS = 5;

/** Below this the House refuses to name a side. */
export const MIN_CONFIDENCE = 0.55;

export interface RelationshipLean {
  /** Close matches (twin/tribe) currently holding YES on this market. */
  yes: number;
  /** Close matches currently holding NO on this market. */
  no: number;
  /** Strength of the relationship evidence behind those people, 0..1. */
  confidence: number;
  /** Best single label present, for copy. */
  label?: "twin" | "tribe" | "opp" | "inverse";
  /** Domain/Circle name when the match is domain-scoped. */
  domain?: string | null;
}

export interface HouseSignals {
  connected: boolean;
  category: string | null;
  /** Prior *answered* markets (YES + NO + SKIP), excluding this one. */
  totalAnswers: number;
  overall: { yes: number; no: number; skip: number };
  inCategory: { yes: number; no: number; skip: number };
  relationship?: RelationshipLean | null;
}

export interface NoRead {
  kind: NoReadKind;
  title: string;
  body: string;
  detail: string[];
}

export interface HouseRead {
  action: BeliefAction | null;
  /** 0..1, only meaningful when action is non-null. */
  confidence: number;
  /** At most three real reasons. Never generic filler. */
  reasons: string[];
  noRead: NoRead | null;
  version: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Sample shrink: n / (n + k). Keeps small samples honest. */
export function sampleConfidence(n: number, k = 4): number {
  return n <= 0 ? 0 : n / (n + k);
}

function noRead(kind: NoReadKind, title: string, body: string, detail: string[] = []): HouseRead {
  return { action: null, confidence: 0, reasons: [], noRead: { kind, title, body, detail }, version: HOUSE_ENGINE_VERSION };
}

/**
 * The single prediction entry point. Deterministic: the same signals always
 * produce the same read, which is what makes locking a prediction meaningful.
 */
export function predictHouse(s: HouseSignals): HouseRead {
  if (!s.connected) {
    return noRead(
      "no_user",
      "Connect to unlock House Read",
      "The House needs a profile before it can learn your patterns.",
    );
  }

  if (s.totalAnswers < FOUNDATION_ANSWERS) {
    return noRead(
      "cold_start",
      "Teach the House",
      "We don't know you well enough yet. Answer a few beliefs to unlock your House Read.",
      [`${s.totalAnswers} of ${FOUNDATION_ANSWERS} foundational reads complete`],
    );
  }

  const cat = s.category;
  const c = s.inCategory;
  const catAnswers = c.yes + c.no + c.skip;
  const catDirectional = c.yes + c.no;

  if (cat && catAnswers === 0) {
    const known = s.overall.yes + s.overall.no > 0;
    return noRead(
      "new_category",
      "New territory",
      known
        ? `We know how you think elsewhere, but not ${cat} yet. Your answer here will establish the first signal.`
        : "This is a category the House has never seen you in. Your answer here will establish the first signal.",
    );
  }

  // Skip behaviour first: a category the user reliably passes on is a real read.
  const skipRate = catAnswers > 0 ? c.skip / catAnswers : 0;
  if (c.skip >= 3 && skipRate >= 0.6) {
    const conf = clamp01(skipRate * sampleConfidence(catAnswers));
    if (conf >= MIN_CONFIDENCE) {
      return {
        action: "SKIP",
        confidence: conf,
        reasons: [
          `You have skipped ${c.skip} of your last ${catAnswers}${cat ? ` ${cat}` : ""} markets.`,
          catDirectional === 0
            ? "You have never taken a side in this category."
            : `You have only taken a side ${catDirectional} time${catDirectional === 1 ? "" : "s"} here.`,
        ],
        noRead: null,
        version: HOUSE_ENGINE_VERSION,
      };
    }
  }

  // Personal directional lean, −1 (NO) … +1 (YES).
  const personalLean = catDirectional > 0 ? (c.yes - c.no) / catDirectional : 0;
  const personalWeight = sampleConfidence(catDirectional, 3);

  const rel = s.relationship ?? null;
  const relTotal = rel ? rel.yes + rel.no : 0;
  const relLean = relTotal > 0 ? ((rel!.yes - rel!.no) / relTotal) * clamp01(rel!.confidence) : 0;
  const relWeight = relTotal > 0 ? sampleConfidence(relTotal, 2) * clamp01(rel!.confidence) : 0;

  const totalWeight = personalWeight + relWeight;
  if (totalWeight === 0) {
    return noRead(
      "weak_sample",
      "Not enough signal",
      "There are not enough relevant answers to make a reliable read.",
      ["One more choice will make this category easier to understand."],
    );
  }

  // Conflicting evidence: both sources are meaningful and point opposite ways.
  const conflicting =
    personalWeight >= 0.4 &&
    relWeight >= 0.4 &&
    Math.sign(personalLean) !== 0 &&
    Math.sign(relLean) !== 0 &&
    Math.sign(personalLean) !== Math.sign(relLean);
  if (conflicting) {
    return noRead(
      "conflicting",
      "You're hard to read here",
      "Your previous choices point in both directions. The House won't bluff.",
      [
        `Your own ${cat ?? "recent"} history leans ${personalLean > 0 ? "YES" : "NO"}.`,
        `Your closest matches lean ${relLean > 0 ? "YES" : "NO"}.`,
        c.skip > 0 ? `You have skipped this category ${c.skip} time${c.skip === 1 ? "" : "s"}.` : "",
      ].filter(Boolean),
    );
  }

  const blended = (personalLean * personalWeight + relLean * relWeight) / totalWeight;
  // Skips make directional predictions less certain, never more.
  const skipDrag = 1 - Math.min(0.4, skipRate * 0.5);
  const confidence = clamp01(Math.abs(blended) * totalWeight * skipDrag + 0.35 * Math.abs(blended));

  if (confidence < MIN_CONFIDENCE || blended === 0) {
    return noRead(
      "weak_sample",
      "Not enough signal",
      "There are not enough relevant answers to make a reliable read.",
      ["One more choice will make this category easier to understand."],
    );
  }

  const action: BeliefAction = blended > 0 ? "YES" : "NO";
  const reasons: string[] = [];
  if (catDirectional > 0) {
    const same = action === "YES" ? c.yes : c.no;
    reasons.push(
      `You chose ${action} in ${same} of ${catDirectional}${cat ? ` ${cat}` : ""} beliefs.`,
    );
  }
  if (relTotal > 0) {
    const share = Math.round(((action === "YES" ? rel!.yes : rel!.no) / relTotal) * 100);
    reasons.push(
      rel!.domain
        ? `Your ${rel!.domain} Circle leans ${share}% toward ${action}.`
        : `${share}% of your closest matches back ${action} here.`,
    );
  }
  if (c.skip > 0) {
    reasons.push(
      `You skip ${cat ?? "these"} markets ${Math.round(skipRate * 100)}% of the time — you engaged with this one.`,
    );
  } else if (cat) {
    reasons.push(`You rarely skip ${cat} markets.`);
  }

  return {
    action,
    confidence,
    reasons: reasons.slice(0, 3),
    noRead: null,
    version: HOUSE_ENGINE_VERSION,
  };
}

export type HouseOutcome = "correct" | "miss" | "unscored";

/** Exact three-way accuracy. A refused read never scores. */
export function scoreHouse(predicted: BeliefAction | null, actual: BeliefAction): HouseOutcome {
  if (!predicted) return "unscored";
  return predicted === actual ? "correct" : "miss";
}

/** Headline copy for the revealed state. */
export function revealHeadline(
  predicted: BeliefAction | null,
  actual: BeliefAction,
): { title: string; line: string } {
  if (!predicted) {
    return {
      title: "The House had no read",
      line: `You chose ${actual}. This one teaches the House something new.`,
    };
  }
  if (predicted === actual) {
    return {
      title: "The House read you",
      line:
        actual === "SKIP"
          ? "We thought this market wouldn't earn your conviction."
          : `The House called ${predicted}. You chose ${actual}.`,
    };
  }
  if (actual === "SKIP") {
    return {
      title: "You held your read",
      line: `The House expected ${predicted}, but you weren't ready to take a side.`,
    };
  }
  if (predicted === "SKIP") {
    return {
      title: "You surprised the House",
      line: `We expected you to pass. You chose ${actual}.`,
    };
  }
  return {
    title: "You surprised the House",
    line: `The House called ${predicted}. You chose ${actual}.`,
  };
}

export interface HouseRecord {
  correct: number;
  miss: number;
  noRead: number;
  streak: number;
  surpriseStreak: number;
  byAction: Record<BeliefAction, { correct: number; total: number }>;
}

export const EMPTY_RECORD: HouseRecord = {
  correct: 0,
  miss: 0,
  noRead: 0,
  streak: 0,
  surpriseStreak: 0,
  byAction: { YES: { correct: 0, total: 0 }, NO: { correct: 0, total: 0 }, SKIP: { correct: 0, total: 0 } },
};

/**
 * Fold scored predictions (newest first) into the record shown on the card.
 * Rows without a locked prediction or without an answer never score.
 */
export function foldRecord(
  rows: { predicted: BeliefAction | null; actual: BeliefAction | null }[],
): HouseRecord {
  const rec: HouseRecord = {
    ...EMPTY_RECORD,
    byAction: { YES: { correct: 0, total: 0 }, NO: { correct: 0, total: 0 }, SKIP: { correct: 0, total: 0 } },
  };
  let streakOpen = true;
  let surpriseOpen = true;
  for (const r of rows) {
    if (!r.actual) continue;
    if (!r.predicted) {
      rec.noRead++;
      continue;
    }
    const hit = r.predicted === r.actual;
    rec.byAction[r.predicted].total++;
    if (hit) {
      rec.correct++;
      rec.byAction[r.predicted].correct++;
      if (streakOpen) rec.streak++;
      surpriseOpen = false;
    } else {
      rec.miss++;
      if (surpriseOpen) rec.surpriseStreak++;
      streakOpen = false;
    }
    if (!hit) streakOpen = false;
    if (hit) surpriseOpen = false;
  }
  return rec;
}

/** Directional accuracy, excluding SKIP so accurate passes can't dominate. */
export function directionalAccuracy(rec: HouseRecord): number | null {
  const total = rec.byAction.YES.total + rec.byAction.NO.total;
  if (total === 0) return null;
  return (rec.byAction.YES.correct + rec.byAction.NO.correct) / total;
}
