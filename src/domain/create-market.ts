/**
 * Create-Market domain logic (pure, ZERO IO).
 *
 * The safe, testable core behind the "Create a market" flow: the exact on-chain
 * argument tuple, seed math (USD↔wei), the yes/no-answerability gate, immutable
 * questionId generation, and near-duplicate detection. The chain hooks
 * (src/lib/create-market.ts) and the creation UI consume these — no contract
 * argument, seed conversion, or validation rule is ever assembled ad hoc.
 *
 * Contract facts pinned from the committed ABI (src/chain/abi.json), never guessed:
 *   createMarket(string questionId, string _yesAgent, string _noAgent,
 *                address curve, bool yes) payable returns (uint256)
 */
import { usdToWei, weiToUsd } from "./order";

/**
 * V1 agent identifiers. The contract's `_yesAgent` / `_noAgent` are STRINGS
 * (agent ids), NOT addresses. This is a stable default convention for
 * Conviction-created markets.
 *
 * ⚠️ Confirm these match POV's agent convention before mainnet use — the trade
 * events carry per-agent fees, so the identifier is economically meaningful.
 */
export const V1_YES_AGENT = "conviction";
export const V1_NO_AGENT = "conviction";

/** A tiny gas cushion (in wei) required on top of the seed before we let a create through. */
export const DEFAULT_GAS_HEADROOM_WEI = 300_000_000_000_000n; // ~0.0003 ETH

// ── questionId: immutable, unique, human-legible ─────────────────────────────

/** URL/id-safe slug of the question (bounded), for a legible questionId. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/g, "");
}

/**
 * The IMMUTABLE on-chain identifier. Combines a legible slug with a caller-
 * supplied unique id (e.g. crypto.randomUUID()) so it's both human-scannable for
 * other indexers AND collision-free. Generated ONCE at draft time; editing the
 * display question never changes it.
 */
export function makeQuestionId(question: string, uid: string): string {
  const slug = slugify(question) || "market";
  return `conviction-${slug}-${uid}`;
}

// ── yes/no-answerability gate (heuristic; LLM seam in the lib layer) ──────────

export interface YesNoCheck {
  ok: boolean;
  /** A single soft nudge when it doesn't read as yes/no — never a hard error. */
  reason: string | null;
}

/** Open-ended interrogatives that are almost never yes/no-answerable. */
const OPEN_ENDED = /^(who|what|whats|when|where|why|how|which|whom|whose)\b/i;
/** The shape of a genuine yes/no question: starts with an auxiliary/copula. */
const YESNO_OPENER =
  /^(is|are|was|were|will|would|should|could|can|does|do|did|has|have|had|am|shall|may|might|must)\b/i;

/**
 * Heuristic check that a question is answerable with yes or no. Deliberately
 * lenient (it only nudges): a clear open-ended question is flagged, everything
 * plausibly binary passes. A real LLM gate can replace this behind the same shape.
 */
export function checkYesNo(question: string): YesNoCheck {
  const t = question.trim().replace(/\s+/g, " ");
  if (t.length < 8) return { ok: false, reason: "Add a little more detail." };
  if (OPEN_ENDED.test(t)) {
    return {
      ok: false,
      reason: 'Rephrase as yes/no — try starting with "Will", "Is", or "Did".',
    };
  }
  // A binary question either opens with an auxiliary/copula or reads as a claim
  // (no interrogative opener). Multiple question marks usually mean several asks.
  if ((t.match(/\?/g) ?? []).length > 1) {
    return { ok: false, reason: "Ask one thing — split multi-part questions." };
  }
  if (/\bor\b.*\?$/i.test(t) && !YESNO_OPENER.test(t)) {
    return { ok: false, reason: "This reads as a choice, not yes/no." };
  }
  return { ok: true, reason: null };
}

// ── seed math (USD is displayed; ETH/wei is sent) ────────────────────────────

/** Convert the creator's USD stake to the wei `value` sent to createMarket. */
export function seedWeiFromUsd(amountUsd: number, usdPerEth: number): bigint {
  return usdToWei(amountUsd, usdPerEth);
}

/** The on-chain minimum seed, expressed in USD for display next to the input. */
export function minSeedUsd(minSeedWei: bigint, usdPerEth: number): number {
  return weiToUsd(minSeedWei, usdPerEth);
}

export interface SeedCheck {
  ok: boolean;
  belowMin: boolean;
}

/** The seed must be positive AND at least the live-read minSeedEth(). */
export function checkSeed(seedWei: bigint, minSeedWei: bigint): SeedCheck {
  const belowMin = seedWei < minSeedWei;
  return { ok: seedWei > 0n && !belowMin, belowMin };
}

export interface BalanceGuard {
  ok: boolean;
  /** seed + gas headroom — what the wallet must hold. */
  requiredWei: bigint;
}

/** Inline balance guard: does the wallet cover the seed plus a gas cushion? */
export function checkBalance(
  balanceWei: bigint,
  seedWei: bigint,
  gasHeadroomWei: bigint = DEFAULT_GAS_HEADROOM_WEI,
): BalanceGuard {
  const requiredWei = seedWei + gasHeadroomWei;
  return { ok: balanceWei >= requiredWei, requiredWei };
}

// ── the on-chain argument tuple (exact order from the verified ABI) ──────────

export type CreateMarketArgs = readonly [
  questionId: string,
  yesAgent: string,
  noAgent: string,
  curve: `0x${string}`,
  yes: boolean,
];

/**
 * Assemble createMarket's args in the EXACT verified order. Centralized so no
 * caller can reorder or mistype the tuple (the contract is unaudited — arg order
 * must be provably correct).
 */
export function createMarketArgs(p: {
  questionId: string;
  yesAgent?: string;
  noAgent?: string;
  curve: `0x${string}`;
  yes: boolean;
}): CreateMarketArgs {
  return [
    p.questionId,
    p.yesAgent ?? V1_YES_AGENT,
    p.noAgent ?? V1_NO_AGENT,
    p.curve,
    p.yes,
  ] as const;
}

// ── near-duplicate detection (client-side, before the exact on-chain check) ──

/** Content words of a question, lowercased, stop-words dropped. */
const STOP = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "will",
  "would",
  "should",
  "could",
  "can",
  "does",
  "do",
  "did",
  "has",
  "have",
  "had",
  "of",
  "to",
  "in",
  "on",
  "for",
  "and",
  "or",
  "by",
  "be",
  "it",
  "this",
  "that",
  "at",
  "as",
  "with",
  "from",
  "into",
  "than",
  "then",
  "by",
]);

export function questionWords(q: string): string[] {
  return slugify(q)
    .split("-")
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Jaccard overlap of two questions' content words (0..1). */
export function questionSimilarity(a: string, b: string): number {
  const A = new Set(questionWords(a));
  const B = new Set(questionWords(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Near-duplicate if the questions share most of their content words. */
export function isNearDuplicate(a: string, b: string, threshold = 0.6): boolean {
  return questionSimilarity(a, b) >= threshold;
}
