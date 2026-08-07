/**
 * Conviction DNA — the one continuous game. Pure, no IO.
 *
 * There is no calibration quiz. Every market decision (YES / NO / PASS) maps how
 * you think, and the map is exposed as a STAGE you level up — never a percentage,
 * never a score. As the map sharpens, real believers surface: first your Tribe
 * and your Opps, and eventually the single closest person, your Conviction Twin.
 *
 * This module owns the honest rules: which stage a real decision count has
 * earned, whether there is enough evidence to NAME a relationship yet, and which
 * one person is meaningful enough to reveal first. It never invents people and
 * never inflates a count — if the evidence isn't there, the copy says so.
 *
 * Consumer-copy discipline: nothing here says wallet, address, vector, embedding,
 * calibration, algorithm, or a probability. The magic is stronger than the math.
 */

export type DnaStage =
  | "unmapped"
  | "forming"
  | "recognizable"
  | "distinct"
  | "stable"
  | "twin_ready";

/** Low → high. Used for `stageAtLeast` comparisons. */
export const DNA_STAGE_ORDER: readonly DnaStage[] = [
  "unmapped",
  "forming",
  "recognizable",
  "distinct",
  "stable",
  "twin_ready",
] as const;

export const DNA_STAGE_LABEL: Record<DnaStage, string> = {
  unmapped: "Unmapped",
  forming: "Forming",
  recognizable: "Recognizable",
  distinct: "Distinct",
  stable: "Stable",
  twin_ready: "Twin Ready",
};

/** Honest one-liner for each stage. No numbers, no banned terms. */
export const DNA_STAGE_HEADLINE: Record<DnaStage, string> = {
  unmapped: "Every decision starts mapping how you think.",
  forming: "Your convictions are starting to take shape.",
  recognizable: "Your pattern is recognizable now — your people are showing up.",
  distinct: "Your convictions are distinct. Real matches are forming around you.",
  stable: "Your DNA is stable. The map of who thinks like you is clear.",
  twin_ready: "Your Conviction Twin is ready to meet.",
};

/** The product promise, kept in one place so the copy never drifts. */
export const DNA_PROMISE = "Build your Conviction DNA. Find your Tribe. Beat your Opps.";

export const stageAtLeast = (stage: DnaStage, min: DnaStage): boolean =>
  DNA_STAGE_ORDER.indexOf(stage) >= DNA_STAGE_ORDER.indexOf(min);

export interface DnaInput {
  /** Real directional decisions (YES / NO / PASS) the viewer has made. */
  decisions: number;
  /** Whether a Conviction Twin has actually qualified (evidence-gated upstream). */
  hasTwinCandidate: boolean;
  /**
   * How many distinct domains the viewer has decided in, when known. Breadth
   * gates Stable+ — a one-note pattern is deep, not broad — but it's optional so
   * a caller without the signal still gets an honest stage from volume alone.
   */
  categories?: number;
}

/** The decision-count boundaries between the volume-driven stages. */
const STAGE_GATES: readonly { at: number; stage: DnaStage }[] = [
  { at: 1, stage: "forming" },
  { at: 5, stage: "recognizable" },
  { at: 15, stage: "distinct" },
  { at: 40, stage: "stable" },
] as const;

/** Distinct domains required before the map is broad enough to be "stable". */
export const STABLE_MIN_CATEGORIES = 3;

/**
 * The stage a viewer has earned. Volume moves you through the early stages;
 * Stable also wants breadth (when we can measure it), and Twin Ready is gated on
 * an actual Twin existing — it can never be reached by showing up alone.
 */
export function dnaStage(input: DnaInput): DnaStage {
  const d = Math.max(0, Math.floor(input.decisions));
  if (d < 1) return "unmapped";
  if (d < 5) return "forming";
  if (d < 15) return "recognizable";
  if (d < 40) return "distinct";
  // Stable / Twin Ready: a deep but narrow pattern stays "distinct".
  if (input.categories != null && input.categories < STABLE_MIN_CATEGORIES) return "distinct";
  return input.hasTwinCandidate ? "twin_ready" : "stable";
}

/**
 * Decisions remaining until the next volume-driven stage, for honest "one more"
 * copy. Null once past the count-driven stages (Stable/Twin Ready are earned by
 * evidence, not by a number).
 */
export function decisionsToNextStage(decisions: number): { next: DnaStage; need: number } | null {
  const d = Math.max(0, Math.floor(decisions));
  for (const g of STAGE_GATES) if (d < g.at) return { next: g.stage, need: g.at - d };
  return null;
}

export interface DnaCounts {
  twin: number;
  tribe: number;
  opp: number;
}

export interface DnaReveal {
  canNameTribe: boolean;
  canNameOpp: boolean;
  canNameTwin: boolean;
}

/**
 * What may be NAMED at this stage. Tribe/Opp need a recognizable pattern and at
 * least one real match; a Twin needs the full Twin Ready stage. Below that we
 * stay honest and name nothing.
 */
export function dnaReveal(stage: DnaStage, counts: DnaCounts): DnaReveal {
  const recognizable = stageAtLeast(stage, "recognizable");
  return {
    canNameTribe: recognizable && counts.tribe > 0,
    canNameOpp: recognizable && counts.opp > 0,
    canNameTwin: stage === "twin_ready" && counts.twin > 0,
  };
}

/** A real, never-inflated count line. `singular` e.g. "Tribe member", "Opp". */
export function matchCountLine(count: number, singular: string): string {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return `No ${singular}s yet`;
  return `${n} ${singular}${n === 1 ? "" : "s"}`;
}

export const MIN_SHARED_FOR_REVEAL = 3;

export interface RevealCandidate {
  relationship: "twin" | "tribe" | "opp" | "inverse" | "neutral" | "insufficient";
  sharedBeliefs: number;
  agreement: number;
}

/** Priority when choosing the one person to surface first. */
const REVEAL_PRIORITY: Record<RevealCandidate["relationship"], number> = {
  twin: 4,
  tribe: 3,
  opp: 2,
  inverse: 1,
  neutral: 0,
  insufficient: -1,
};

/**
 * The index of the single most meaningful person to reveal first, or -1 when the
 * evidence isn't there yet. Requires a recognizable pattern and a person with
 * real shared decisions behind the relationship — we never reveal a stranger.
 */
export function firstMeaningfulIndex(people: RevealCandidate[], stage: DnaStage): number {
  if (!stageAtLeast(stage, "recognizable")) return -1;
  let bestIdx = -1;
  let bestScore = -Infinity;
  people.forEach((p, i) => {
    if (p.sharedBeliefs < MIN_SHARED_FOR_REVEAL) return;
    const pr = REVEAL_PRIORITY[p.relationship] ?? -1;
    if (pr < 1) return; // only genuine relationships (twin/tribe/opp/inverse)
    // Break ties toward stronger relationship, then more distinctive agreement,
    // then more shared evidence.
    const score = pr * 1000 + Math.abs(p.agreement - 50) + p.sharedBeliefs;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });
  return bestIdx;
}
