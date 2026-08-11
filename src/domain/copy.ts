/**
 * CONTEXTUAL COPY — decoration over canonical truth, and never a state machine.
 *
 * WHAT THIS MAY CHANGE: an emotional headline and one supporting line.
 * WHAT IT MAY NEVER CHANGE: a CTA label, a count, an eligibility, a destination,
 * a card state, a slot rule, or which category applies. Those are decided by
 * `resolvePostAction` and the Challenge projections, and this module CONSUMES
 * the category they already produced rather than re-deriving one from raw rows.
 * A second inference of "what kind of moment is this" would be a second owner
 * of the thing three PRs were spent giving one owner.
 *
 * IT IS DETERMINISTIC, AND THAT IS THE HARD REQUIREMENT. Copy chosen at random
 * mutates while the reader is looking at it: the emotional premise of a screen
 * changes between two renders of identical state, which reads as the software
 * being unsure what it thinks. Selection is a pure function of the category and
 * a stable seed, so the same moment says the same thing every time it is drawn.
 *
 * HISTORY IS OPTIONAL AND NEVER INVENTED. Avoiding the last three hooks is worth
 * doing where a trustworthy record exists, and fabricating one — a ref, a
 * localStorage key written on render — would be persistence pretending to be
 * memory. Passing nothing gives deterministic selection without history, which
 * is the honest default.
 *
 * ZERO IO, pure, fully testable.
 */
import type { CopyCategory } from "@/domain/post-action";

export interface Hook {
  headline: string;
  support: string | null;
}

/**
 * THE PRIORITY, AND EXACTLY ONE CATEGORY WINS.
 *
 * Higher is stronger. The order is the brief's, and it is an order of
 * CONSEQUENCE rather than of novelty: somebody asked you and you answered
 * outranks everything, because it is the only one where another person is
 * already involved. `exit` sits at the bottom with `general` — a closed position
 * is not an emotional argument for anything.
 *
 * Three emotional arguments on one screen is the failure this prevents. A reader
 * told they were early AND that their Tribe is watching AND that a chain reached
 * them believes none of it.
 */
const PRIORITY: Record<CopyCategory, number> = {
  reciprocity: 7,
  market_maker: 6,
  first_or_early: 5,
  chain: 4,
  tribe_rivals: 3,
  still_forming: 2,
  general: 1,
  exit: 0,
};

/**
 * THE SINGLE STRONGEST CATEGORY AMONG THOSE THAT APPLY.
 *
 * `general` is the answer to an EMPTY context, not a floor under a supplied one.
 * Seeding `best` with it instead of with the first candidate made `exit` — the
 * only category ranked below it — unreachable whenever it was offered alone,
 * so somebody who had just closed a position got a rousing generic headline
 * over the sale. The reduce starts inside the candidate list now.
 */
export function pickCategory(candidates: readonly CopyCategory[]): CopyCategory {
  if (candidates.length === 0) return "general";
  return candidates.reduce((best, c) => (PRIORITY[c] > PRIORITY[best] ? c : best));
}

export function categoryRank(c: CopyCategory): number {
  return PRIORITY[c];
}

/**
 * THE VARIANTS. Every one is a claim the product can support.
 *
 * None asserts agreement, none invents a crowd, none implies somebody showed up
 * when only a call row exists, and none frames a Rival as being against the
 * reader. The Still Forming family in particular never promises discovery — it
 * says the map is unclear, which is true, rather than that somebody interesting
 * is out there, which is the sentence that would make the whole surface filler.
 */
const HOOKS: Record<CopyCategory, readonly Hook[]> = {
  reciprocity: [
    { headline: "You showed up for them", support: "Now see who shows up for you." },
    { headline: "You answered their call", support: "Put yours on the table." },
    { headline: "Somebody asked. You answered.", support: "The same is available to you, once." },
  ],
  market_maker: [
    { headline: "The question began with you", support: "It doesn't have to end there." },
    { headline: "You wrote it. Now find out who bites.", support: null },
    { headline: "Your question exists because you made it", support: "See where it travels." },
  ],
  first_or_early: [
    { headline: "There was no crowd to join", support: "You made the call anyway." },
    { headline: "You got here before the argument did", support: null },
    { headline: "Nobody had answered this yet", support: "You went first." },
  ],
  chain: [
    {
      headline: "This question reached you through someone else",
      support: "Where does it go next?",
    },
    { headline: "It travelled to get here", support: "It can keep going." },
    { headline: "Somebody carried this to you", support: "Carry it further." },
  ],
  /**
   * TRIBE AND RIVALS SHARE ONE FAMILY BECAUSE THEY ARE ONE QUESTION.
   *
   * "Will the divide hold?" is a Rival line and "Do your people see it too?" is
   * a Tribe line, and both ask the same thing: does the map survive contact with
   * a real answer. Neither frames a Rival as being AGAINST the reader — a Rival
   * answering is the most informative event the graph can receive, and copy that
   * treats it as an attack teaches the reader to want less of it.
   */
  tribe_rivals: [
    { headline: "Do your people see it too?", support: null },
    {
      headline: "You don't choose your people",
      support: "You discover them one real answer at a time.",
    },
    { headline: "Agreement is comforting. Disagreement is revealing.", support: null },
    { headline: "Will the divide hold?", support: null },
  ],
  still_forming: [
    { headline: "The map is still taking shape", support: "Every honest answer makes it clearer." },
    { headline: "Not enough answers to name this yet", support: "One more would help." },
    { headline: "The pattern is thin here", support: "A real answer thickens it." },
  ],
  general: [
    {
      headline: "Belief is easy when no one can answer back",
      support: "Put this one in front of your people.",
    },
    { headline: "A conviction nobody sees is a hunch", support: null },
    { headline: "Say it where it can be answered", support: null },
  ],
  /**
   * AN EXIT IS NOT AN EMOTIONAL ARGUMENT. One flat variant, no rotation worth
   * having: somebody who just closed a position is not the person to sell an
   * idea to, and a rousing headline over a sale reads as a system that has not
   * noticed what happened.
   */
  exit: [{ headline: "That's closed", support: null }],
};

/**
 * A SMALL STABLE HASH. Not for security — for a number that is the same every
 * time the same moment is drawn, on every device, with no clock in it.
 */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export interface HookRequest {
  category: CopyCategory;
  /**
   * WHAT MAKES THIS MOMENT THIS MOMENT — a market id, a challenge id, anything
   * stable. It must NOT contain a timestamp or a render counter: those are what
   * turn deterministic selection back into rotation the reader can watch happen.
   */
  seed: string;
  /**
   * The last few headlines this reader saw, newest first, when a trustworthy
   * record exists. Omitted entirely rather than fabricated.
   */
  recent?: readonly string[];
}

/**
 * ONE HOOK, THE SAME ONE, EVERY TIME.
 *
 * The seed picks a starting point and history only moves it forward — so with no
 * history the choice is pure, and with history it is still pure given the same
 * history. Nothing here reads a clock or a counter.
 *
 * A CATEGORY WHOSE VARIANTS ARE ALL RECENT STILL RETURNS ONE. Repeating a hook
 * is a small cost; returning nothing would blank a headline, and an empty screen
 * is a much larger one than a familiar sentence.
 */
export function pickHook({ category, seed, recent }: HookRequest): Hook {
  const family = HOOKS[category];
  const start = hash(`${category}:${seed}`) % family.length;
  if (!recent || recent.length === 0) return family[start];

  const avoid = new Set(recent.slice(0, 3).map((s) => s.trim().toLowerCase()));
  for (let i = 0; i < family.length; i++) {
    const candidate = family[(start + i) % family.length];
    if (!avoid.has(candidate.headline.trim().toLowerCase())) return candidate;
  }
  return family[start];
}

/* ── The constraints, exported so the tests can hold every variant to them ── */

export const HEADLINE_MAX_WORDS = 12;
export const SUPPORT_MAX_WORDS = 18;

export const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/** Every variant, for the gates. */
export function allHooks(): { category: CopyCategory; hook: Hook }[] {
  return (Object.keys(HOOKS) as CopyCategory[]).flatMap((category) =>
    HOOKS[category].map((hook) => ({ category, hook })),
  );
}

/**
 * WHAT NO HOOK MAY SAY.
 *
 * The casino words import a reward system this product decided against. The
 * delivery words claim a channel that does not exist. `against you` frames a
 * Rival as an attacker when their answer is the most interesting thing the
 * system can produce. And `everyone`, `nobody is`, `people are waiting` are here
 * because a hook must never invent social proof — a headline that claims a crowd
 * on a screen with no crowd is the one lie that makes every other sentence
 * suspect.
 */
export const COPY_BANNED: readonly string[] = [
  "accepted",
  "invite",
  "invited",
  "credits",
  "tokens",
  "allowance",
  "streak",
  "notified",
  "delivered",
  "against you",
  "everyone agrees",
  "people are waiting",
  "join the crowd",
  "trending",
  "jackpot",
  "win big",
];
