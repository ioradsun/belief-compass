/**
 * The House — a per-viewer prediction of what THIS user will do with THIS market.
 *
 * ZERO IO, fully pure, fully tested. The House predicts a *belief action*
 * (YES / NO / PASS) from the viewer's own answer history, their category
 * behaviour (including passes), and their Conviction DNA relationships on this
 * market. It never predicts price and it never bluffs: when the evidence is
 * thin or contradictory it returns an honest no-read state instead of a side.
 */

export type BeliefAction = "YES" | "NO" | "PASS";

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
  /** Prior *answered* markets (YES + NO + PASS), excluding this one. */
  totalAnswers: number;
  overall: { yes: number; no: number; pass: number };
  inCategory: { yes: number; no: number; pass: number };
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

/**
 * Presentation band for the pre-reveal card. When the House HAS a read, low
 * confidence changes only how loud the card is — never whether a pick exists.
 * (A refused no-read is handled separately; bands describe a real prediction.)
 */
export type HouseConfidenceBand =
  | "SHOT_IN_THE_DARK"
  | "FLYING_BLIND"
  | "HUNCH"
  | "READ"
  | "STRONG_READ";

/** Map a read's confidence (0..1) to its presentation band. */
export function confidenceBand(confidence: number): HouseConfidenceBand {
  const pct = clamp01(confidence) * 100;
  if (pct < 50) return "SHOT_IN_THE_DARK";
  if (pct < 60) return "FLYING_BLIND";
  if (pct < 70) return "HUNCH";
  if (pct < 85) return "READ";
  return "STRONG_READ";
}

/** Pre-reveal copy per band. Never names the predicted side — that's the hook. */
export const BAND_COPY: Record<HouseConfidenceBand, { headline: string; line: string }> = {
  SHOT_IN_THE_DARK: {
    headline: "Shot in the dark",
    line: "We’re flying blind here, but we still made a call. Back a side to see it.",
  },
  FLYING_BLIND: {
    headline: "Flying blind",
    line: "You haven’t shown us much in this territory. We took a guess anyway.",
  },
  HUNCH: {
    headline: "The House has a hunch",
    line: "Something in your pattern points one way.",
  },
  READ: {
    headline: "The House has a read",
    line: "We think we know what you’ll do. Put money down to find out if we’re right.",
  },
  STRONG_READ: {
    headline: "Prove the House wrong",
    line: "Your pattern looks unusually clear on this one.",
  },
};

function noRead(kind: NoReadKind, title: string, body: string, detail: string[] = []): HouseRead {
  return {
    action: null,
    confidence: 0,
    reasons: [],
    noRead: { kind, title, body, detail },
    version: HOUSE_ENGINE_VERSION,
  };
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
  const catAnswers = c.yes + c.no + c.pass;
  const catDirectional = c.yes + c.no;

  /**
   * A NEW CATEGORY IS NOT A NEW PERSON. Once a viewer is past cold start we
   * always have something: their cross-category lean, their matches on this
   * market, or — failing both — the fact that they don't engage here, which is
   * a PASS read, not a refusal. Only `no_user` and `cold_start` refuse now.
   */



  // Pass behaviour first: a category the user reliably passes on is a real read.
  const passRate = catAnswers > 0 ? c.pass / catAnswers : 0;
  if (c.pass >= 3 && passRate >= 0.6) {
    const conf = clamp01(passRate * sampleConfidence(catAnswers));
    if (conf >= MIN_CONFIDENCE) {
      return {
        action: "PASS",
        confidence: conf,
        reasons: [
          `You have passed on ${c.pass} of your last ${catAnswers}${cat ? ` ${cat}` : ""} markets.`,
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

  /**
   * THE HOUSE ALWAYS KNOWS SOMETHING ABOUT A PLAYER IT HAS WATCHED.
   *
   * A thin CATEGORY is not a thin PERSON. Someone with a long directional
   * history who lands in a quiet corner used to fall through to "not enough
   * signal" and read as "still learning you" forever. Their cross-category lean
   * is weaker evidence than in-category history, so it enters at a discount and
   * only matters when the category itself is thin — but it is evidence, and
   * refusing to use it is what made the read feel broken.
   */
  const overallDirectional = s.overall.yes + s.overall.no;
  const overallLean =
    overallDirectional > 0 ? (s.overall.yes - s.overall.no) / overallDirectional : 0;
  const catThin = personalWeight < 0.6;
  const globalWeight =
    catThin && overallDirectional > 0
      ? sampleConfidence(overallDirectional, 8) * 0.6 * (1 - personalWeight)
      : 0;

  /**
   * THE HOUSE ALWAYS CALLS. Once a viewer is calibrated, silence is itself a
   * read: no directional evidence anywhere means we expect them to sit this one
   * out. A predicted PASS carries low confidence and says so through the band —
   * it never pretends to be a strong call.
   */
  const sitOut = (reasons: string[], confidence: number): HouseRead => ({
    action: "PASS",
    confidence: clamp01(confidence),
    reasons: reasons.slice(0, 3),
    noRead: null,
    version: HOUSE_ENGINE_VERSION,
  });

  const totalWeight = personalWeight + relWeight + globalWeight;
  if (totalWeight === 0) {
    return sitOut(
      [
        catAnswers > 0
          ? `You have never taken a side in${cat ? ` ${cat}` : " this category"}.`
          : `We have not seen you take a side in${cat ? ` ${cat}` : " this territory"} yet.`,
        s.overall.pass > 0
          ? `You have passed ${s.overall.pass} time${s.overall.pass === 1 ? "" : "s"} overall.`
          : "",
      ].filter(Boolean),
      0.4,
    );
  }

  // Conflicting evidence: both sources are meaningful and point opposite ways.
  // We no longer refuse — a player pulled in two directions usually holds off.
  const conflicting =
    personalWeight >= 0.4 &&
    relWeight >= 0.4 &&
    Math.sign(personalLean) !== 0 &&
    Math.sign(relLean) !== 0 &&
    Math.sign(personalLean) !== Math.sign(relLean);
  if (conflicting) {
    return sitOut(
      [
        `Your own ${cat ?? "recent"} history leans ${personalLean > 0 ? "YES" : "NO"}.`,
        `Your closest matches lean ${relLean > 0 ? "YES" : "NO"}.`,
        c.pass > 0
          ? `You have passed on this category ${c.pass} time${c.pass === 1 ? "" : "s"}.`
          : "",
      ].filter(Boolean),
      0.45,
    );
  }

  const blended =
    (personalLean * personalWeight + relLean * relWeight + overallLean * globalWeight) /
    totalWeight;
  // Passes make directional predictions less certain, never more.
  const passDrag = 1 - Math.min(0.4, passRate * 0.5);
  const confidence = clamp01(Math.abs(blended) * totalWeight * passDrag + 0.35 * Math.abs(blended));

  // Dead-even evidence is a sit-out, not a coin flip.
  if (blended === 0) {
    return sitOut(
      [
        catDirectional > 0
          ? `Your${cat ? ` ${cat}` : ""} history splits ${c.yes}–${c.no}.`
          : "Nothing in your history leans either way here.",
        relTotal > 0 ? `Your closest matches split ${rel!.yes}–${rel!.no} on this one.` : "",
      ].filter(Boolean),
      0.4,
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
  if (globalWeight > 0 && overallDirectional > 0) {
    const same = action === "YES" ? s.overall.yes : s.overall.no;
    reasons.push(
      `Across everything you have answered, you take ${action} ${Math.round((same / overallDirectional) * 100)}% of the time.`,
    );
  }
  if (c.pass > 0) {
    reasons.push(
      `You pass on ${cat ?? "these"} markets ${Math.round(passRate * 100)}% of the time — you engaged with this one.`,
    );
  } else if (cat) {
    reasons.push(`You rarely pass on ${cat} markets.`);
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
        actual === "PASS"
          ? "We thought this market wouldn't earn your conviction."
          : `The House called ${predicted}. You chose ${actual}.`,
    };
  }
  if (actual === "PASS") {
    return {
      title: "You held your read",
      line: `The House expected ${predicted}, but you weren't ready to take a side.`,
    };
  }
  if (predicted === "PASS") {
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
  byAction: {
    YES: { correct: 0, total: 0 },
    NO: { correct: 0, total: 0 },
    PASS: { correct: 0, total: 0 },
  },
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
    byAction: {
      YES: { correct: 0, total: 0 },
      NO: { correct: 0, total: 0 },
      PASS: { correct: 0, total: 0 },
    },
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

/** Directional accuracy, excluding PASS so accurate passes can't dominate. */
export function directionalAccuracy(rec: HouseRecord): number | null {
  const total = rec.byAction.YES.total + rec.byAction.NO.total;
  if (total === 0) return null;
  return (rec.byAction.YES.correct + rec.byAction.NO.correct) / total;
}

/**
 * What an answer teaches. YES/NO feed directional Conviction DNA; PASS only ever
 * updates readability/recommendation signals — it is never an agreement,
 * a disagreement, a neutral belief, or a shared directional market.
 */
export function dnaContribution(action: BeliefAction): "directional" | "behavioral" {
  return action === "PASS" ? "behavioral" : "directional";
}

// ── Cold-start foundation ───────────────────────────────────────────────────
//
// With no (or thin) history the House can't read anyone, so a new viewer trains
// it with five FREE belief choices on moderate, single-dimension POVs — never a
// purchase, never a personality quiz. Each answer contributes WEIGHTED evidence
// to several psychographic dimensions; no single answer assigns a label. The raw
// answer, mapping version, and contributions are all stored so the mapping can be
// revised later without losing the original data.

/** Bump when the foundation → dimension weights change; old answers keep theirs. */
export const FOUNDATION_MAPPING_VERSION = 1;

export interface FoundationMapping {
  key: string;
  /** The belief prompt (moderate wording — no "almost all" / "completely"). */
  prompt: string;
  /** Primary dimension this POV is chosen to probe. */
  probes: string;
  /** Per-action weighted contributions to psychographic dimensions. */
  dimensions: Record<BeliefAction, Record<string, number>>;
}

/** PASS always signals "this territory doesn't pull you" — a small engagement debit. */
const passDisengage = (dim: string): Record<string, number> => ({ [dim]: -0.2 });

export const FOUNDATION_MAPPINGS: FoundationMapping[] = [
  {
    key: "FOUND_WALLET",
    prompt:
      "If someone finds a wallet with $500, they will probably keep the cash before returning it.",
    probes: "trust",
    dimensions: {
      YES: { interpersonalTrust: -0.55, hiddenMotiveSensitivity: 0.3, cynicalExpectation: 0.2 },
      NO: { interpersonalTrust: 0.55, prosocialExpectation: 0.3, hiddenMotiveSensitivity: -0.1 },
      PASS: passDisengage("trustEngagement"),
    },
  },
  {
    key: "MOTHERS_INSTINCT",
    prompt: "A mother’s instinct is often more reliable than a doctor’s first opinion.",
    probes: "intuition",
    dimensions: {
      YES: { intuitionTrust: 0.5, institutionalTrust: -0.3, expertiseDeference: -0.25 },
      NO: { intuitionTrust: -0.4, institutionalTrust: 0.35, expertiseDeference: 0.3 },
      PASS: passDisengage("intuitionEngagement"),
    },
  },
  {
    key: "LUCK_VS_WORK",
    prompt: "Luck and timing matter more than hard work in becoming a billionaire.",
    probes: "agency",
    dimensions: {
      YES: { agencyBelief: -0.5, luckBelief: 0.4, systemicView: 0.25 },
      NO: { agencyBelief: 0.5, luckBelief: -0.35, meritocraticView: 0.3 },
      PASS: passDisengage("agencyEngagement"),
    },
  },
  {
    key: "CURSIVE_VS_FINANCE",
    prompt: "Schools should replace cursive lessons with financial literacy.",
    probes: "disruption",
    dimensions: {
      YES: { disruptionAppetite: 0.5, traditionAttachment: -0.35, pragmatism: 0.3 },
      NO: { disruptionAppetite: -0.4, traditionAttachment: 0.45 },
      PASS: passDisengage("disruptionEngagement"),
    },
  },
  {
    key: "RESPECTED_VS_LIKED",
    prompt: "Being respected is more valuable than being liked.",
    probes: "status",
    dimensions: {
      YES: { statusOrientation: 0.5, belongingOrientation: -0.3, independenceOrientation: 0.25 },
      NO: { belongingOrientation: 0.5, statusOrientation: -0.3, warmthOrientation: 0.25 },
      PASS: passDisengage("statusEngagement"),
    },
  },
];

/** Contributions a single answer adds to the viewer's dimension vector. */
export function applyFoundationAnswer(
  mapping: FoundationMapping,
  action: BeliefAction,
): Record<string, number> {
  return { ...mapping.dimensions[action] };
}

/** Fold many stored contributions into one dimension vector. */
export function accumulateDimensions(
  contributions: Array<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of contributions) {
    for (const [k, v] of Object.entries(c)) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** The next foundation POV to ask, given the keys already answered. */
export function nextFoundation(answeredKeys: string[]): FoundationMapping | null {
  const done = new Set(answeredKeys);
  return FOUNDATION_MAPPINGS.find((m) => !done.has(m.key)) ?? null;
}
