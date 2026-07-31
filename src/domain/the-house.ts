/**
 * The House — a companion, not an analytics card. Pure, no IO.
 *
 * The House doesn't predict the market; it predicts YOU, and slowly becomes your
 * Conviction Twin. It occupies one line. It never exposes math, probabilities,
 * "AI", confidence scores, or "based on your previous choices" — the magic is
 * stronger than the explanation. This module owns the whole voice: the
 * relationship stage, the pre-decision confidence mode, and the one sentence.
 *
 * Familiarity is real (decisions observed + how often the House reads you right),
 * but it is exposed only as a STAGE the user levels up — never a number.
 */

export type BeliefAction = "YES" | "NO" | "PASS";

export type HouseStage = "learning" | "familiar" | "understanding" | "in_sync" | "twin";

export const STAGE_LABEL: Record<HouseStage, string> = {
  learning: "Learning You",
  familiar: "Getting Familiar",
  understanding: "Understanding You",
  in_sync: "In Sync",
  twin: "Conviction Twin",
};

/**
 * The relationship stage. It deepens with decisions observed, but the top two
 * stages also require the House to actually read you right — "Conviction Twin"
 * has to mean it, so it can't be reached by volume alone.
 */
export function houseStage(decisions: number, accuracy: number | null): HouseStage {
  const acc = accuracy == null ? 0 : accuracy;
  const n = Math.max(0, Math.floor(decisions));
  if (n < 5) return "learning";
  if (n < 15) return "familiar";
  if (n < 40) return "understanding";
  // In Sync / Conviction Twin are earned by being right, not just by showing up.
  if (n < 90 || acc < 0.68) return acc >= 0.6 ? "in_sync" : "understanding";
  return "twin";
}

export type HouseMode = "low" | "medium" | "high";

/**
 * The pre-decision confidence mode from the read's band. High is deliberately
 * rare (only the strongest reads) so the reveal stays exciting — and, like the
 * whole app, it never leaks the side before the decision.
 */
export function houseMode(band: string | null): HouseMode {
  if (band === "STRONG_READ") return "high";
  if (band === "READ" || band === "HUNCH") return "medium";
  return "low";
}

/* ── The voice. Deterministic pick by seed so a market's line is stable. ────── */

const BEFORE_LOW = [
  "Still learning you.",
  "I'm not sure about this one yet.",
  "You're hard to read here.",
  "This one could go either way.",
  "I'm watching.",
];
const BEFORE_MEDIUM = [
  "I think I know this one…",
  "I've got a feeling.",
  "This sounds like you.",
  "I have a read.",
];
// High = strong intensity. The generic pool never names the side; when the read
// is strong enough to call it, BEFORE_NAMED does (see houseBeforeNamed).
const BEFORE_HIGH = [
  "I've got a strong read on this one.",
  "I'm almost certain I know you here.",
  "This one feels like you.",
  "I'd put money on knowing you here.",
];
// Strong read, side named — the dramatic call before you decide. "{s}" = YES/NO.
const BEFORE_NAMED_DIRECTIONAL = [
  "I think you're a {s} here.",
  "Something tells me you'll go {s}.",
  "I'd put money on you taking {s}.",
  "This one feels like a {s} from you.",
];
const BEFORE_NAMED_PASS = [
  "I don't think this one earns your conviction.",
  "I think you'll let this one pass.",
  "This doesn't feel like one you take.",
];
const AFTER_CORRECT = [
  "I knew it.",
  "Exactly what I expected.",
  "We're in sync.",
  "That felt like you.",
  "Another piece of the puzzle.",
  "We're thinking alike.",
  "That strengthened our connection.",
];
const AFTER_WRONG = [
  "You surprised me.",
  "Didn't see that coming.",
  "Interesting…",
  "I'm rethinking you.",
  "You broke the pattern.",
  "I learned something today.",
  "You're changing.",
];
const MILESTONE = [
  "I've started recognizing your patterns.",
  "We're becoming more alike.",
  "This is the strongest read I've ever had on you.",
  "You're becoming predictable…",
  "I almost think like you now.",
];
const DELIGHT = [
  "This market reminded me of you.",
  "You trusted your instincts again.",
  "You ignore the crowd more than most.",
  "You usually stick with your first instinct.",
  "You changed your mind this time. Interesting.",
];

const pick = (pool: readonly string[], seed: number): string =>
  pool[Math.abs(Math.trunc(seed)) % pool.length];

/** The pre-decision line for a confidence mode. Never names a side. */
export function houseBefore(mode: HouseMode, seed: number): string {
  const pool = mode === "high" ? BEFORE_HIGH : mode === "medium" ? BEFORE_MEDIUM : BEFORE_LOW;
  return pick(pool, seed);
}

/**
 * The pre-decision line when the read is strong enough to CALL the side — the
 * high-confidence reveal ("I think you're a YES here"). Reserved for the top
 * band; every other read still hides the side until you decide.
 */
export function houseBeforeNamed(side: BeliefAction, seed: number): string {
  if (side === "PASS") return pick(BEFORE_NAMED_PASS, seed);
  return pick(BEFORE_NAMED_DIRECTIONAL, seed).replaceAll("{s}", side);
}

/** The immediate reaction after a decision — emotion, never analytics. Being
 *  wrong is simply learning; the House is never disappointed. */
export function houseAfter(correct: boolean, seed: number): string {
  return pick(correct ? AFTER_CORRECT : AFTER_WRONG, seed);
}

/** A rare relationship beat — reads as an achievement, not a notification.
 *  Only from the deeper stages, and only ~1 in 6 (seeded), so it stays special. */
export function houseMilestone(stage: HouseStage, seed: number): string | null {
  if (stage === "twin") return "Conviction Twin unlocked.";
  if (stage !== "in_sync") return null;
  return Math.abs(Math.trunc(seed)) % 6 === 0 ? pick(MILESTONE, seed) : null;
}

/** An occasional pattern observation — the feeling that the House notices you.
 *  Rare (~1 in 5, seeded) so it delights rather than nags. */
export function houseDelight(seed: number): string | null {
  return Math.abs(Math.trunc(seed)) % 5 === 0 ? pick(DELIGHT, seed) : null;
}
