/**
 * PROFILE STORY — three acts, and the refusal to say the same thing twice.
 *
 * WHAT THIS REPLACED. The profile narrated the database. For a person with one
 * conviction it said so six times: "their story is still taking shape", "taken
 * a side in 1 market", Start Here (that market), Convictions That Define Them
 * (that market), Their Conviction Map (that market again, under a taxonomy
 * heading), and "1 active conviction". Depth by repetition is not depth.
 *
 * THE RULE. Every section must answer a question no other section answers:
 *
 *   US      what are we?                 (only when there is a shared record)
 *   NEXT    what could we do now?        (only when there is something to do)
 *   THEM    what do they believe?
 *
 * And the non-repetition invariant: one market may not headline two acts. NEXT
 * is an invitation, THEM is an inventory — when the inventory is short enough
 * to read whole, the invited market is not repeated inside it.
 *
 * THIN RELATIONSHIP → THIN PROFILE. Nothing here fills a hole with a fallback.
 * Every act returns null when it has nothing true to say, and the page gets
 * shorter. The interface adapts to density rather than rendering an emaciated
 * version of the maximum-data architecture: a taxonomy over one conviction is
 * ceremony, so grouping only appears once there is something to navigate.
 *
 * WHAT IS DELIBERATELY NOT SAID. No invented relationship insight ("you seem to
 * be exploring similar ideas from different directions" over one shared market
 * is a sentence trying to make thin evidence profound). No tenure comparison in
 * the hero — interesting analysis, wrong emotional priority. No Follow: the
 * relationship model here is showing up, not subscribing.
 *
 * ZERO IO, pure, fully testable.
 */
import { convictionMatch } from "./relationship";

export type Side = "YES" | "NO";

/* ────────────────────────────── ACT I · US ────────────────────────────── */

export interface UsInput {
  /** Markets both people took a side in. */
  shared: number;
  /** Of those, how many they landed on the same side of. */
  together: number;
  apart: number;
  /** Topics they usually land the same way on, strongest first. */
  alignedTopics?: readonly string[];
}

export interface UsAct {
  /** together ÷ shared, the number the evidence line proves. Null when unknown. */
  matchPct: number | null;
  /** "1 of 1 together" — the arithmetic, always present. */
  evidence: string;
  /** One plain sentence, or null when the evidence cannot carry one. */
  sentence: string | null;
  /**
   * True while the record is too short for the percentage to mean much. The
   * page uses it to keep the count visually at least as loud as the percentage:
   * with 1 of 1, the count is the more important fact.
   */
  thin: boolean;
}

/** Below this many shared markets a percentage is a coin flip with a decimal. */
export const THIN_EVIDENCE = 8;

/**
 * What the two of them are, from counted markets only. Null when they have
 * never met — an empty "what connects you" is worse than starting with them.
 */
export function usAct(i: UsInput): UsAct | null {
  const shared = Math.max(0, Math.floor(i.shared));
  if (shared === 0) return null;
  const together = Math.max(0, Math.floor(i.together));
  const apart = Math.max(0, Math.floor(i.apart));
  const topic = i.alignedTopics?.[0] ?? null;

  let sentence: string | null = null;
  if (together === shared) {
    sentence =
      shared === 1
        ? topic
          ? `You both backed the same side on ${topic}.`
          : "You backed the same side once."
        : `You have backed the same side all ${shared} times.`;
  } else if (together === 0) {
    sentence =
      shared === 1
        ? "You landed on opposite sides once."
        : `You have landed on opposite sides all ${shared} times.`;
  } else if (topic) {
    sentence = `You keep meeting on ${topic}.`;
  }

  return {
    matchPct: convictionMatch(together, shared, apart),
    evidence: `${together} of ${shared} together`,
    sentence,
    thin: shared < THIN_EVIDENCE,
  };
}

/* ───────────────────────────── ACT II · NEXT ──────────────────────────── */

export interface CallFromThem {
  marketId: number;
  title: string;
  /** The side they took. Null for a question they wrote rather than backed. */
  side: Side | null;
}

export interface JoinCandidate {
  marketId: number;
  title: string;
  side: Side;
}

export interface NextAct {
  kind: "call" | "join";
  marketId: number;
  title: string;
  side: Side | null;
  /** "cryptsam believes YES" / "cryptsam wrote this question". */
  detail: string;
  cta: string;
}

/**
 * What the two of you could do right now.
 *
 * AN OUTSTANDING CALL OUTRANKS A POSITION. Someone asking you directly is a
 * stronger reason to act than a market they happen to hold, and it is the one
 * thing on this page with a deadline.
 *
 * THE JOIN CANDIDATE MUST BE UNANSWERED. The old "Start here" recommended their
 * biggest position whether or not the visitor had already taken a side in it —
 * "start here" then meant "their largest holding", not "the best place to meet
 * this person". The caller filters to markets the viewer has never answered;
 * when none is left this returns null and the section disappears rather than
 * degrading into a boring fallback.
 */
export function nextAct(input: {
  name: string;
  callFromThem?: CallFromThem | null;
  joinCandidate?: JoinCandidate | null;
}): NextAct | null {
  const who = input.name.trim() || "They";
  const call = input.callFromThem;
  if (call && call.title.trim()) {
    return {
      kind: "call",
      marketId: call.marketId,
      title: call.title,
      side: call.side,
      detail: call.side ? `${who} believes ${call.side}` : `${who} opened this question`,
      cta: "Answer the call →",
    };
  }
  const join = input.joinCandidate;
  if (join && join.title.trim()) {
    return {
      kind: "join",
      marketId: join.marketId,
      title: join.title,
      side: join.side,
      detail: `${who} believes ${join.side}`,
      cta: "Take a look →",
    };
  }
  return null;
}

/* ───────────────────────────── ACT III · THEM ─────────────────────────── */

export interface ThemPosition {
  marketId: number;
  title: string;
  side: Side;
  valueUsd: number | null;
  daysHeld: number;
  tenureIsFloor: boolean;
  category: string | null;
}

export interface ThemAct {
  rows: ThemPosition[];
  /** "3 convictions · typically held 14 days" — the whole supporting footer. */
  summary: string;
  /**
   * True once there is enough history for a taxonomy to be navigation rather
   * than ceremony. Below it, grouping one position under "Elsewhere 1" is UI
   * about almost no information.
   */
  grouped: boolean;
  /** Rows beyond the flat preview, reachable by expanding. Never hidden. */
  hidden: number;
}

export const DENSITY = {
  /** Convictions before grouping by theme earns its heading. */
  groupAt: 12,
  /** Convictions shown flat before the list offers to expand. */
  preview: 8,
  /** At or below this, a market shown in Act II is not repeated in the list. */
  shortList: 5,
} as const;

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/**
 * What they believe — one section, not three presentations of one dataset.
 *
 * Strongest commitment first, then longest held, so a reader meets the position
 * that cost them the most before the ones that cost nothing.
 */
export function themAct(
  positions: readonly ThemPosition[],
  opts: { total?: number; medianDays?: number | null; excludeMarketId?: number | null } = {},
): ThemAct {
  const total = Math.max(opts.total ?? positions.length, 0);
  const sorted = [...positions].sort(
    (a, b) => n(b.valueUsd) - n(a.valueUsd) || n(b.daysHeld) - n(a.daysHeld),
  );
  // NON-REPETITION. A short list is read whole, so the market already offered
  // above must not appear again three rows down. A long one is an inventory and
  // an inventory with holes is broken, not tidy.
  const rows =
    opts.excludeMarketId != null && total <= DENSITY.shortList
      ? sorted.filter((p) => p.marketId !== opts.excludeMarketId)
      : sorted;

  const bits = [`${total} ${total === 1 ? "conviction" : "convictions"}`];
  const days = opts.medianDays == null ? 0 : Math.round(opts.medianDays);
  if (days >= 1) bits.push(`typically held ${days} ${days === 1 ? "day" : "days"}`);

  return {
    rows,
    summary: bits.join(" · "),
    grouped: total >= DENSITY.groupAt,
    hidden: Math.max(0, rows.length - DENSITY.preview),
  };
}
