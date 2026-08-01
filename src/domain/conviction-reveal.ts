/**
 * Conviction Reveal — a story engine, not a receipt.
 *
 * Every completed YES/NO position ends with ONE emotional payoff that answers
 * "what did this decision reveal?" — never "your order completed". Like Spotify
 * Wrapped, it never shows every statistic; it picks the one or two most
 * surprising, meaningful things and lets the rest stay hidden, so no two reveals
 * feel the same and each one creates anticipation for the next.
 *
 * This module OWNS the selection. React only renders what it returns. The engine:
 *   • takes every available signal (most are optional / absent),
 *   • ranks the candidate stories,
 *   • gives The House the headline when it has something to say,
 *   • returns AT MOST one headline + two cards + one CTA — never a dashboard.
 *
 * ZERO IO, pure, deterministic per `seed` (the market id) so a reveal is stable
 * if it re-renders. It never invents a story the signals don't support.
 */
import { houseAfter, houseSurpriseBeat } from "./the-house";

export type Side = "YES" | "NO";

export interface RevealFace {
  name: string;
  avatarUrl: string | null;
  wallet: string;
}

export interface ConvictionRevealInput {
  side: Side;
  /** Market id — deterministic rotation of the House's voice. */
  seed: number;
  /** The House's pick for this market, if it had a read. null → no House headline. */
  housePredicted?: Side | "PASS" | null;
  /** Consecutive times you've defied the House — a surprise streak is celebrated. */
  surpriseStreak?: number;
  /** Believers on YOUR side, including you. */
  believers?: number | null;
  /** You are the very first believer on this side. */
  firstBeliever?: boolean;
  /** Real holders on your side (faces for the belonging card). */
  believerFaces?: RevealFace[];
  /** Tribe/twin members who made the SAME call (side-resolved by the caller). */
  tribe?: RevealFace[];
  /** Opp/inverse members who went the OTHER way. */
  opps?: RevealFace[];
  /** Your Conviction Twin, when they're on your side. */
  twin?: RevealFace | null;
  /** This answer changed who your closest Twin is. */
  twinChanged?: boolean;
  /** The House's map of you got clearer from this decision. */
  dnaAdvanced?: boolean;
  /** The market's own momentum, when notable. */
  momentum?: "accelerating" | "shifted" | null;
  /** The market's creator, when naming them adds something. */
  creatorName?: string | null;
}

export type RevealCardType =
  "surprise" | "twin" | "tribe" | "opps" | "belonging" | "early" | "momentum" | "dna" | "creator";

export interface RevealCard {
  type: RevealCardType;
  title: string;
  body: string;
  /** Up to five faces for a social story; empty otherwise. */
  faces: RevealFace[];
  /** People beyond the shown faces ("+12"). */
  overflow: number;
  icon: string;
}

export interface RevealCta {
  label: string;
  kind: "next" | "tribe" | "market";
}

export interface RevealStory {
  /** The lead line — The House's voice when it has a read, else a warm confirm. */
  headline: string;
  subheadline: string | null;
  /** Tint: the side, or the House's neutral voice. */
  tone: "yes" | "no" | "house";
  /** At most two — the strongest stories, never every signal. */
  cards: RevealCard[];
  /** The one primary action: keep going. */
  cta: RevealCta;
  /** A single quiet secondary link, only when it genuinely adds a path. */
  secondaryCta: RevealCta | null;
}

/** At/below this many believers, a side is "early". */
export const EARLY_MAX = 8;
/** At/above this many, belonging (a crowd) is the story. */
export const BELONGING_MIN = 10;
/** Never crowd a card with more than a handful of faces. */
export const MAX_FACES = 5;

const pick = (pool: readonly string[], seed: number): string =>
  pool[Math.abs(Math.trunc(seed)) % pool.length];

const CONFIRM = ["You're in.", "Locked in.", "Conviction backed.", "That's a real call."];

const facesOf = (all: RevealFace[], total: number): { faces: RevealFace[]; overflow: number } => {
  const faces = all.slice(0, MAX_FACES);
  return { faces, overflow: Math.max(0, total - faces.length) };
};

/** The House headline, when it had a read. Reuses the House's own voice. */
function houseHeadline(input: ConvictionRevealInput): string | null {
  const p = input.housePredicted;
  if (p == null) return null;
  const correct = p !== "PASS" && p === input.side;
  if (correct) return houseAfter(true, input.seed);
  return houseSurpriseBeat(input.surpriseStreak ?? 0, input.seed) ?? houseAfter(false, input.seed);
}

interface Candidate {
  priority: number;
  card: RevealCard;
}

/** Build every card the signals actually support, each with its priority. */
function candidates(input: ConvictionRevealInput): Candidate[] {
  const out: Candidate[] = [];
  const side = input.side;
  const believers = Math.max(0, Number(input.believers ?? 0));
  const tribe = input.tribe ?? [];
  const opps = input.opps ?? [];

  if (input.twinChanged) {
    out.push({
      priority: 95,
      card: {
        type: "surprise",
        title: "New discovery",
        body: "This answer changed who your closest Twin is.",
        faces: input.twin ? [input.twin] : [],
        overflow: 0,
        icon: "✨",
      },
    });
  }
  if (input.twin && !input.twinChanged) {
    out.push({
      priority: 90,
      card: {
        type: "twin",
        title: "Your Twin",
        body: "Your closest match made the same choice.",
        faces: [input.twin],
        overflow: 0,
        icon: "👯",
      },
    });
  }
  if (tribe.length > 0) {
    const { faces, overflow } = facesOf(tribe, tribe.length);
    out.push({
      priority: 80,
      card: {
        type: "tribe",
        title: "Your Tribe",
        body: `${tribe.length} ${tribe.length === 1 ? "person who thinks" : "people who think"} like you made the same call.`,
        faces,
        overflow,
        icon: "🤝",
      },
    });
  }
  if (opps.length > 0) {
    const { faces, overflow } = facesOf(opps, opps.length);
    out.push({
      priority: 70,
      card: {
        type: "opps",
        title: "Your Opps",
        body: `${opps.length} of your ${opps.length === 1 ? "rivals" : "rivals"} went the other way.`,
        faces,
        overflow,
        icon: "⚔️",
      },
    });
  }
  if (believers >= BELONGING_MIN) {
    const { faces, overflow } = facesOf(input.believerFaces ?? [], believers);
    out.push({
      priority: 60,
      card: {
        type: "belonging",
        title: "You're not alone",
        body: `${believers} believers chose ${side}.`,
        faces,
        overflow,
        icon: "🙂",
      },
    });
  } else if (believers > 0 && believers <= EARLY_MAX) {
    out.push({
      priority: 55,
      card: input.firstBeliever
        ? {
            type: "early",
            title: "You're first",
            body: `You're the first believer on ${side}.`,
            faces: [],
            overflow: 0,
            icon: "🌱",
          }
        : {
            type: "early",
            title: "You're early",
            body: `Only ${believers} ${believers === 1 ? "believer has" : "believers have"} taken this side.`,
            faces: [],
            overflow: 0,
            icon: "🌱",
          },
    });
  }
  if (input.momentum) {
    out.push({
      priority: 45,
      card: {
        type: "momentum",
        title: "The market",
        body:
          input.momentum === "accelerating" ? "Belief is accelerating." : "Momentum shifted today.",
        faces: [],
        overflow: 0,
        icon: "📈",
      },
    });
  }
  if (input.dnaAdvanced) {
    out.push({
      priority: 40,
      card: {
        type: "dna",
        title: "Conviction DNA",
        body: "The House understands you a little better.",
        faces: [],
        overflow: 0,
        icon: "🧬",
      },
    });
  }
  if (input.creatorName) {
    out.push({
      priority: 30,
      card: {
        type: "creator",
        title: "Creator",
        body: `${input.creatorName} just gained another believer.`,
        faces: [],
        overflow: 0,
        icon: "✍️",
      },
    });
  }
  return out;
}

/**
 * The one function that decides what a completed conviction reveals. Returns a
 * headline (+ optional subheadline), at most two cards, and one CTA. Deterministic
 * for a given input.
 */
export function getConvictionReveal(input: ConvictionRevealInput): RevealStory {
  const side = input.side;
  const house = houseHeadline(input);

  const cards = candidates(input)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 2)
    .map((c) => c.card);

  const headline = house ?? pick(CONFIRM, input.seed);
  const tone: RevealStory["tone"] = house ? "house" : side === "YES" ? "yes" : "no";
  const subheadline = house ? `You backed ${side}.` : null;

  // A single quiet secondary path, only when a people-story is on screen.
  const social = cards.find((c) => c.type === "twin" || c.type === "tribe");
  const secondaryCta: RevealCta | null = social
    ? { label: "Meet your Tribe", kind: "tribe" }
    : null;

  return {
    headline,
    subheadline,
    tone,
    cards,
    cta: { label: "Next Question", kind: "next" },
    secondaryCta,
  };
}
