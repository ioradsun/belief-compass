/**
 * THE EXPLORE LENS — five ways to ask "why is this market in front of me?"
 *
 * ONE CONTROL, NOT A GRAMMAR. The feed's existing filter (`./filters`) is a
 * three-dimensional selection — network AND topic AND momentum, OR within each
 * — rendered as ~24 checkboxes in one dropdown. It is expressive and it asks the
 * reader to classify markets, which is the engine's job. A lens asks the reader
 * for one thing instead: which question they want answered.
 *
 *   FOR YOU         why this matters to me
 *   MOVING          what is changing
 *   MOST CAPITAL    where the money is
 *   MOST PARTICIPANTS  where the people are
 *   FRESH           where I can be early
 *
 * The grammar is NOT deleted and this module does not replace it — both run, the
 * filter narrows and the lens ranks. What each lens can honestly claim was
 * measured against production (2,779 markets) before any of them shipped:
 *
 *   capital > 0            788 markets   top $505, only 9 at or above $100,
 *                                        median of those holding any: $0.93
 *   people in a market     797 markets   top 37, 60 markets at 5 or more
 *   traded in 24h / 7d      40 / 183
 *   created <24h / <7d        9 /  71    (2,726 of 2,779 are under 30 days old,
 *                                        so age only discriminates inside a week)
 *
 * AND THEY ARE GENUINELY DIFFERENT QUESTIONS, which was worth checking rather
 * than assuming: across the top twenty of each, capital and people share 5
 * markets, capital and moving 6, people and fresh 1. Capital is not a proxy
 * for volume either — the top forty by capital and the top forty by lifetime
 * volume share only FIVE markets. Five lenses, five answers.
 *
 * WHY "MOST PARTICIPANTS" AND NOT "MOST BELIEVERS". Believer is the product's
 * own word and it earns its place inside a market, but on a discovery control it
 * asks the reader a question instead of answering one: believers on YES, on NO,
 * both, holding now, or everyone who ever traded? The lens ranks the total
 * number of people in the market irrespective of side, and "participants" is
 * what that is. The label should need no interpretation.
 *
 * TWO KINDS OF LENS, and the distinction is the whole semantic rule here.
 *
 *   DIRECTIONAL   For You and Moving may name a side, because their reason is
 *                 genuinely about one: "Your Tribe is backing YES", "YES moved
 *                 up 8.4% today". Both sentences come from the canonical
 *                 engines (`reasonFor`, `momentumReason`) — this module invents
 *                 no side-specific arithmetic.
 *   MARKET-LEVEL  Most Capital, Most Participants and Fresh rank on a
 *                 WHOLE-MARKET total, so they describe the whole market.
 *                 Turning "Most Capital" into "YES has $505" would describe a
 *                 side while ranking on the sum — the interface would be
 *                 explaining a different ordering than the one it applied.
 *
 * ZERO IO, pure, fully testable.
 */
import { compactUsd } from "@/domain/market-discovery";
import { participantsLabel } from "@/domain/participants";

export type Lens = "for_you" | "moving" | "capital" | "participants" | "fresh";

/**
 * Every lens the engine can rank by. Includes `moving`, which is no longer
 * OFFERED — see `DISCOVER_LENSES`.
 */
export const LENSES: Lens[] = ["for_you", "moving", "capital", "participants", "fresh"];

/**
 * THE FOUR CHOICES EXPLORE ACTUALLY OFFERS.
 *
 * Moving was a fifth and is not one any more. Not because the signal is weak —
 * it is the most sophisticated thing in the feed, drift-corrected against the
 * exchange rate so a market only "moves" when it really did — but because it
 * cannot fill a permanent destination: 41 markets traded platform-wide in the
 * last 24 hours, and the lens admits only markets that moved. A discovery choice
 * that is usually near-empty teaches the reader not to press it.
 *
 * NOTHING UNDERNEATH IT IS DELETED. `classifyMomentum` still runs on every
 * market and still feeds the `momentum` scoring component, the headline reason
 * on a card, the market stories, the live tape and the position stories. The
 * intelligence stays; the permanent shelf space goes. `moving` also remains a
 * valid `Lens`, so a saved link or an in-flight request still resolves rather
 * than falling back and quietly showing a different feed.
 */
export const DISCOVER_LENSES: Lens[] = ["for_you", "capital", "participants", "fresh"];

/** The one-line answer each choice gives. Shown once, in the open menu. */
export const LENS_QUESTIONS: Record<Lens, string> = {
  for_you: "What should I look at?",
  moving: "What is changing?",
  capital: "Where is the money?",
  participants: "Where is the crowd?",
  fresh: "Where can I be early?",
};

/**
 * WHAT EACH CHOICE IS CALLED.
 *
 * "Up Next" replaced "For You": in this menu these are not personalised
 * recommendations, they are different ways to find markets worth acting on now.
 * "Up Next" claims cadence, not intimacy. And "Most People" replaced "Most
 * Participants" — the product's vocabulary is human (people, believers,
 * conviction) and "participants" reads like analytics software.
 *
 * The CLOSED control does not use this map: the section is always "Up Next"
 * (see `EXPLORE_LABEL`), because choosing a ranking is not going somewhere else.
 */
export const LENS_LABELS: Record<Lens, string> = {
  for_you: "For You",
  moving: "Moving",
  capital: "Most Capital",
  participants: "Most People",
  fresh: "Fresh",
};

/**
 * THE STABLE DESTINATION NAME. The header never changes when the sort changes —
 * the label says where you are, the checkmark says how it is ranked.
 */
export const EXPLORE_LABEL = "Up Next";


/**
 * Which whole-market total a lens RANKS on — and therefore the one figure it has
 * already said out loud. Null for the two lenses that lead with a sentence.
 *
 * This exists so the scale line can subtract it. A row reading "$505 committed"
 * above "18 participants · $505 committed" says the hero number twice, and the
 * second printing is pure noise in the quietest line on the card.
 */
export type LensMetric = "capital" | "participants" | null;

export function heroMetric(lens: Lens): LensMetric {
  return lens === "capital" ? "capital" : lens === "participants" ? "participants" : null;
}

/** May this lens name YES or NO? See the header — it is about what it ranks on. */
export function isDirectional(lens: Lens): boolean {
  return lens === "for_you" || lens === "moving";
}

/**
 * Everything a lens needs to admit and rank one market. Every field is already
 * on the feed's read-model row — nothing here requires a new read.
 */
export interface LensCandidate {
  onchainId: number;
  /** Whole-market capital committed right now, USD: yes + no. */
  capitalUsd: number;
  /**
   * How many people are in this market — the canonical count, irrespective of
   * side. See @/domain/participants: it is the ONLY number in the data model
   * that means what the label "Most Participants" promises.
   */
  participants: number;
  /** Epoch ms the market was created, or null when we were never told. */
  createdAtMs: number | null;
  /**
   * 0..1 significance of the strongest drift-corrected move, from
   * `classifyMomentum`. Zero on a still market — never re-derived here.
   */
  momentumWeight: number;
  /** Does the canonical classifier place this market in the "moving" lens? */
  moving: boolean;
  /** The composite rank the scorer already produced, 0..100. */
  score: number;
}

/**
 * Will this lens show this market at all?
 *
 * A lens must never list a market it cannot make its claim about. "Most Capital"
 * with $0 committed is not a small entry at the bottom of the ranking — it is the
 * lens saying something untrue in order to fill a row. An empty lens is the
 * honest outcome, and the panel already says so plainly.
 */
export function admits(lens: Lens, c: LensCandidate): boolean {
  switch (lens) {
    case "capital":
      return c.capitalUsd > 0;
    case "participants":
      return c.participants > 0;
    case "fresh":
      return c.createdAtMs != null;
    case "moving":
      return c.moving || c.momentumWeight > 0;
    default:
      return true;
  }
}

/** The ordering key — higher is earlier, always descending on the named measure. */
export function lensRank(lens: Lens, c: LensCandidate): number {
  switch (lens) {
    case "capital":
      return c.capitalUsd;
    case "participants":
      return c.participants;
    case "fresh":
      return c.createdAtMs ?? 0;
    case "moving":
      return c.momentumWeight;
    default:
      return c.score;
  }
}

/**
 * Rank a lens's markets, descending, admitting only what it can speak about.
 *
 * STABLE, and the tiebreak matters more here than in a blended feed: 2,726 of
 * 2,779 markets were created within one 30-day import, so the Fresh lens has
 * long runs of identical timestamps. Ties fall back to the composite score and
 * then to the id, so the order is the same on the server, on the client, and
 * across two polls a second apart — a ranked list that reshuffles under the
 * reader is worse than one that is merely arbitrary.
 */
export function orderForLens<T extends LensCandidate>(lens: Lens, candidates: T[]): T[] {
  if (lens === "for_you") return candidates;
  return candidates
    .filter((c) => admits(lens, c))
    .map((c, i) => ({ c, i, k: lensRank(lens, c) }))
    .sort((a, b) => b.k - a.k || b.c.score - a.c.score || a.c.onchainId - b.c.onchainId)
    .map((x) => x.c);
}

/** Read a lens off a URL/query value, defaulting rather than throwing. */
export function toLens(v: unknown): Lens {
  return LENSES.includes(v as Lens) ? (v as Lens) : "for_you";
}

/* ── What a row says ──────────────────────────────────────────────────────── */

/** The two universal measures of scale, as the row has them. */
export interface Scale {
  /** Canonical whole-market participant count — see @/domain/participants. */
  participants: number;
  capitalUsd: number;
}

/**
 * How long ago, in the shortest true form. Deliberately coarse past a day: the
 * reader is choosing what to open, and "4d ago" and "4d 6h ago" lead to the same
 * decision.
 */
export function freshLabel(ageHours: number): string | null {
  if (!Number.isFinite(ageHours) || ageHours < 0) return null;
  if (ageHours < 1) return `Created ${Math.max(1, Math.round(ageHours * 60))}m ago`;
  if (ageHours < 48) return `Created ${Math.round(ageHours)}h ago`;
  return `Created ${Math.round(ageHours / 24)}d ago`;
}

/**
 * THE HERO — why this market is here, for a market-level lens.
 *
 * Null for For You and Moving: their hero is the sentence the canonical reason
 * engine already wrote, and composing a second one here would be a third place
 * that decides what a market's headline says.
 */
export function lensHero(lens: Lens, s: Scale, ageHours: number | null): string | null {
  if (lens === "capital") return s.capitalUsd > 0 ? `${compactUsd(s.capitalUsd)} committed` : null;
  if (lens === "participants") return s.participants > 0 ? participantsLabel(s.participants) : null;
  if (lens === "fresh") return ageHours == null ? null : freshLabel(ageHours);
  return null;
}

/**
 * THE QUIET LINE — the universal scale of the market, minus whatever the hero
 * already said.
 *
 * Believers and capital ground every market regardless of lens: they are how a
 * reader tells a real question from an empty one, and no lens replaces them. But
 * the lens that RANKED on one of them has already printed it in a larger, louder
 * line directly above, so that one is dropped here rather than repeated.
 *
 * A zero is omitted, never printed. "0 participants" is a true fact that costs a
 * line to say nothing with; absence carries it.
 */
export function scaleLine(lens: Lens, s: Scale): string | null {
  const hero = heroMetric(lens);
  const parts: string[] = [];
  if (hero !== "participants" && s.participants > 0) parts.push(participantsLabel(s.participants));
  if (hero !== "capital" && s.capitalUsd > 0) parts.push(`${compactUsd(s.capitalUsd)} committed`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
