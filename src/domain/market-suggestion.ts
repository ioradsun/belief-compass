/**
 * "The House has an idea" — the pure domain of personalized market creation.
 *
 * Everything that decides IF a suggestion may appear, WHICH candidate wins, and
 * WHAT the card says lives here: no IO, no React, no prompts. The server module
 * gathers signals and calls the model; this module judges the result.
 *
 * The product rule this file exists to protect: the House may claim FIT and
 * NOVELTY. It must never invent demand, earnings, or urgency.
 */

/** Every tunable in one place — never scattered through components. */
export const SUGGESTION = {
  ENGINE_VERSION: 1,

  // ── Participation gate (server-side, from real answer history) ──
  MIN_MEANINGFUL_ACTIONS: 5,
  MIN_YES_NO_DECISIONS: 3,
  MIN_CATEGORIES_TOUCHED: 2,
  /** How much recent history shapes the profile. */
  HISTORY_WINDOW: 30,

  // ── Session gate (client-side, this browsing session) ──
  MIN_SESSION_CARDS_VIEWED: 5,
  MIN_CARDS_BETWEEN_SUGGESTIONS: 12,
  MAX_PER_SESSION: 1,

  // ── Cooldowns ──
  DISMISS_COOLDOWN_DAYS: 7,
  CREATED_COOLDOWN_DAYS: 14,
  EXPIRY_DAYS: 7,
  /** Regenerate only after this many further meaningful actions. */
  REGENERATE_EVERY_ACTIONS: 5,

  // ── Signal weights ──
  WEIGHT: {
    BUY: 5,
    SELECT: 3,
    CASE_OPENED: 2,
    PASS: 1,
    VIEW: 0,
  },

  // ── Candidate quality ──
  QUESTION_MIN_CHARS: 16,
  QUESTION_MAX_CHARS: 110,
  /** Above this text similarity a candidate is treated as an existing market. */
  DUPLICATE_THRESHOLD: 0.62,
  /** Ranking weights: relevance / novelty / clarity. */
  RANK: { RELEVANCE: 0.5, NOVELTY: 0.3, CLARITY: 0.2 },
} as const;

export const CREATOR_FEE_FALLBACK_BPS = 450;

export type SignalAction = "YES" | "NO" | "PASS" | "CASE_OPENED";

export interface InterestSignal {
  marketId: string;
  category: string | null;
  action: SignalAction;
  /** True when the action was backed with real money. */
  backed?: boolean;
  title?: string | null;
}

export interface UserMarketInterest {
  viewerId: string;
  topCategories: { category: string; score: number }[];
  recentMarketTitles: string[];
  recentDecisions: { marketId: string; category: string; action: SignalAction }[];
  previouslyCreatedTitles: string[];
}

export interface MarketIdeaOpportunity {
  primaryCategory: string;
  secondaryCategory: string | null;
  relevantTopics: string[];
  recentRelatedQuestions: string[];
  similarExistingQuestions: string[];
}

export interface IdeaCandidate {
  question: string;
  category: string;
  shortReason: string;
  keywords: string[];
}

export interface ParticipationStats {
  meaningfulActions: number;
  yesNoDecisions: number;
  categoriesTouched: number;
}

export interface SessionStats {
  cardsViewed: number;
  cardsSinceSuggestion: number;
  suggestionsThisSession: number;
}

// ── Eligibility ────────────────────────────────────────────────────────────

/** Has this person participated enough for personalization to be honest? */
export function isParticipationEligible(s: ParticipationStats): boolean {
  return (
    s.meaningfulActions >= SUGGESTION.MIN_MEANINGFUL_ACTIONS &&
    s.yesNoDecisions >= SUGGESTION.MIN_YES_NO_DECISIONS &&
    s.categoriesTouched >= SUGGESTION.MIN_CATEGORIES_TOUCHED
  );
}

export interface InsertGate extends SessionStats {
  dismissedAt: number | null;
  createdAt: number | null;
  now?: number;
  hasReadySuggestion: boolean;
}

const DAY = 86_400_000;

export function withinDays(at: number | null, days: number, now: number): boolean {
  return at != null && now - at < days * DAY;
}

/**
 * The one predicate the feed asks. Rare on purpose: a surprise, never a
 * recurring advertisement.
 */
export function shouldInsertSuggestion(g: InsertGate): boolean {
  const now = g.now ?? Date.now();
  return (
    g.hasReadySuggestion &&
    g.suggestionsThisSession < SUGGESTION.MAX_PER_SESSION &&
    g.cardsViewed >= SUGGESTION.MIN_SESSION_CARDS_VIEWED &&
    g.cardsSinceSuggestion >= SUGGESTION.MIN_CARDS_BETWEEN_SUGGESTIONS &&
    !withinDays(g.dismissedAt, SUGGESTION.DISMISS_COOLDOWN_DAYS, now) &&
    !withinDays(g.createdAt, SUGGESTION.CREATED_COOLDOWN_DAYS, now)
  );
}

// ── Interest profile ───────────────────────────────────────────────────────

export function signalWeight(action: SignalAction, backed = false): number {
  if (action === "YES" || action === "NO")
    return backed ? SUGGESTION.WEIGHT.BUY : SUGGESTION.WEIGHT.SELECT;
  if (action === "CASE_OPENED") return SUGGESTION.WEIGHT.CASE_OPENED;
  if (action === "PASS") return SUGGESTION.WEIGHT.PASS;
  return SUGGESTION.WEIGHT.VIEW;
}

/** Weighted category ranking over the recent window. Deterministic ties. */
export function rankCategories(signals: InterestSignal[]): { category: string; score: number }[] {
  const score = new Map<string, number>();
  for (const s of signals.slice(0, SUGGESTION.HISTORY_WINDOW)) {
    if (!s.category) continue;
    const w = signalWeight(s.action, s.backed);
    if (w <= 0) continue;
    score.set(s.category, (score.get(s.category) ?? 0) + w);
  }
  return [...score.entries()]
    .map(([category, v]) => ({ category, score: v }))
    .sort((a, b) => b.score - a.score || a.category.localeCompare(b.category));
}

export function participationOf(signals: InterestSignal[]): ParticipationStats {
  const window = signals.slice(0, SUGGESTION.HISTORY_WINDOW);
  return {
    meaningfulActions: window.filter((s) => signalWeight(s.action, s.backed) > 0).length,
    yesNoDecisions: window.filter((s) => s.action === "YES" || s.action === "NO").length,
    categoriesTouched: new Set(window.map((s) => s.category).filter(Boolean)).size,
  };
}

// ── Text similarity (V1 duplicate detection) ───────────────────────────────

const STOP = new Set([
  "the", "a", "an", "is", "are", "will", "be", "to", "of", "in", "on", "for", "and", "or",
  "that", "this", "it", "do", "does", "did", "by", "at", "with", "than", "more", "less",
  "who", "what", "when", "why", "how", "should", "would", "could", "can", "we", "you",
]);

export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentTokens(text: string): Set<string> {
  return new Set(
    normalizeQuestion(text)
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Jaccard token overlap on content words. 1 = the same proposition. */
export function textSimilarity(a: string, b: string): number {
  if (normalizeQuestion(a) === normalizeQuestion(b)) return 1;
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** How close the nearest existing market is (0 = nothing like it). */
export function nearestExisting(question: string, existing: string[]): number {
  let max = 0;
  for (const e of existing) max = Math.max(max, textSimilarity(question, e));
  return max;
}

// ── Candidate validation ───────────────────────────────────────────────────

const BANNED = [
  "guaranteed", "profit", "high earning", "will perform", "algorithm",
  "our ai", "based on your data", "tracking", "your wallet", "moon", "pump",
];

export type RejectReason =
  | "too-short"
  | "too-long"
  | "not-a-question"
  | "compound"
  | "banned-phrase"
  | "bad-category"
  | "duplicate";

export interface Validation {
  ok: boolean;
  reason: RejectReason | null;
}

export function validateCandidate(
  c: IdeaCandidate,
  allowedCategories: readonly string[],
  existing: string[],
): Validation {
  const q = (c.question ?? "").trim();
  if (q.length < SUGGESTION.QUESTION_MIN_CHARS) return { ok: false, reason: "too-short" };
  if (q.length > SUGGESTION.QUESTION_MAX_CHARS) return { ok: false, reason: "too-long" };
  if (!q.endsWith("?")) return { ok: false, reason: "not-a-question" };
  // One clear thing: a second question mark or an " and should"-style joint ask.
  if ((q.match(/\?/g) ?? []).length > 1) return { ok: false, reason: "compound" };
  if (/\b(and|or)\s+(should|will|is|are|can|would)\b/i.test(q))
    return { ok: false, reason: "compound" };
  const lower = q.toLowerCase();
  if (BANNED.some((b) => lower.includes(b))) return { ok: false, reason: "banned-phrase" };
  if (!allowedCategories.includes(c.category)) return { ok: false, reason: "bad-category" };
  if (nearestExisting(q, existing) >= SUGGESTION.DUPLICATE_THRESHOLD)
    return { ok: false, reason: "duplicate" };
  return { ok: true, reason: null };
}

// ── Deterministic ranking ──────────────────────────────────────────────────

export function clarityScore(question: string): number {
  const len = question.length;
  // Concise is the target; a very short or very long question loses points.
  const lengthFit = len <= 90 ? 1 : Math.max(0, 1 - (len - 90) / 40);
  const words = normalizeQuestion(question).split(" ").length;
  const wordFit = words >= 5 && words <= 16 ? 1 : words < 5 ? 0.5 : 0.6;
  return Math.min(1, lengthFit * 0.5 + wordFit * 0.5);
}

export function relevanceScore(c: IdeaCandidate, opp: MarketIdeaOpportunity): number {
  let s = 0;
  if (c.category === opp.primaryCategory) s += 0.6;
  else if (opp.secondaryCategory && c.category === opp.secondaryCategory) s += 0.35;
  const q = normalizeQuestion(c.question);
  const topics = opp.relevantTopics.map((t) => t.toLowerCase()).filter(Boolean);
  const hits = topics.filter((t) => q.includes(normalizeQuestion(t))).length;
  if (topics.length) s += 0.4 * Math.min(1, hits / Math.min(2, topics.length));
  return Math.min(1, s);
}

export function candidateScore(
  c: IdeaCandidate,
  opp: MarketIdeaOpportunity,
  existing: string[],
): number {
  const relevance = relevanceScore(c, opp);
  const novelty = 1 - nearestExisting(c.question, existing);
  const clarity = clarityScore(c.question);
  return (
    SUGGESTION.RANK.RELEVANCE * relevance +
    SUGGESTION.RANK.NOVELTY * novelty +
    SUGGESTION.RANK.CLARITY * clarity
  );
}

/**
 * Pick the one idea to store. The model never chooses — the scores do, and ties
 * break on the question text so the same inputs always yield the same idea.
 */
export function selectBestCandidate(
  candidates: IdeaCandidate[],
  opp: MarketIdeaOpportunity,
  allowedCategories: readonly string[],
  existing: string[],
): { candidate: IdeaCandidate; score: number } | null {
  const scored = candidates
    .filter((c) => validateCandidate(c, allowedCategories, existing).ok)
    .map((c) => ({ candidate: c, score: candidateScore(c, opp, existing) }))
    .sort((a, b) => b.score - a.score || a.candidate.question.localeCompare(b.candidate.question));
  return scored[0] ?? null;
}

// ── Copy ───────────────────────────────────────────────────────────────────

/**
 * Why this idea fits. Two shapes only: a single reliable interest, or a genuine
 * cross-category connection. Never a claim about how the market will do.
 */
export function fitLine(topics: string[]): string {
  const [a, b] = topics.filter(Boolean);
  if (a && b) return `You keep returning to ${a} and ${b}. This question connects both.`;
  if (a) return `You keep returning to questions about ${a}. This one is still missing.`;
  return "No close market currently asks this.";
}

export function rewardLine(creatorFeeBps: number | null): string {
  const bps = creatorFeeBps ?? CREATOR_FEE_FALLBACK_BPS;
  return `Create it and earn ${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}% of eligible trading fees generated by the market.`;
}

export const SUGGESTION_EVENTS = [
  "suggestion_generated",
  "suggestion_shown",
  "suggestion_create_clicked",
  "suggestion_edit_clicked",
  "suggestion_dismissed",
  "suggestion_publish_started",
  "suggestion_created_unchanged",
  "suggestion_created_edited",
  "suggestion_publish_failed",
] as const;
export type SuggestionEvent = (typeof SUGGESTION_EVENTS)[number];
