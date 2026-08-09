/**
 * NUMBER AGREEMENT — the last thing between a story and a reader's trust.
 *
 * Copy is assembled from dozens of templates, and every one of them can be
 * handed a count of 1: "One people took YES", "1 believers left", "2 people is
 * out". Each of those is individually trivial and collectively fatal — broken
 * grammar reads as a broken system, and every number beside it stops being
 * believable.
 *
 * Rather than audit every template forever, agreement is enforced once, at the
 * point copy is rendered. This module is pure text, deterministic, and additive:
 * it only ever rewrites a phrase whose plurality provably disagrees with the
 * count in front of it.
 */

/** Nouns the feed counts. Anything not listed is left completely alone. */
const SINGULAR: Record<string, string> = {
  people: "person",
  persons: "person",
  believers: "believer",
  others: "other",
  wallets: "wallet",
  markets: "market",
  questions: "question",
  traders: "trader",
  positions: "position",
  sides: "side",
  holders: "holder",
  buyers: "buyer",
  sellers: "seller",
  dollars: "dollar",
  days: "day",
  hours: "hour",
  minutes: "minute",
  weeks: "week",
  months: "month",
  years: "year",
  times: "time",
  moves: "move",
  trades: "trade",
  bets: "bet",
  friends: "friend",
  followers: "follower",
  calls: "call",
};

const PLURAL = Object.fromEntries(
  Object.entries(SINGULAR).map(([p, s]) => [s, p]),
) as Record<string, string>;

/** Verbs that inflect for number, in both directions. */
const TO_SINGULAR: Record<string, string> = {
  are: "is",
  were: "was",
  have: "has",
  "aren't": "isn't",
  "weren't": "wasn't",
  "haven't": "hasn't",
};
const TO_PLURAL: Record<string, string> = {
  is: "are",
  was: "were",
  has: "have",
  "isn't": "aren't",
  "wasn't": "weren't",
  "hasn't": "haven't",
};

/** "1" and its spelled form, in the casings copy actually uses. */
const ONE = /^(1|one)$/i;

const matchCase = (sample: string, word: string): string =>
  sample[0] === sample[0]?.toUpperCase() && sample.slice(1) === sample.slice(1).toLowerCase()
    ? word[0].toUpperCase() + word.slice(1)
    : word;

/**
 * Rewrite counted phrases so the noun — and any verb immediately following it —
 * agrees with the number in front of it. Words in between (adjectives like
 * "new", "more") are preserved.
 */
export function fixAgreement(text: string): string {
  if (!text) return text;
  let out = text;

  // <count> [adjectives] <noun> [verb]
  out = out.replace(
    /\b([\d,]+|one|One|ONE)(\s+(?:[a-z]+\s+){0,2})([a-z]+)\b([ ,]+(?:is|are|was|were|has|have|isn't|aren't|wasn't|weren't|hasn't|haven't)\b)?/g,
    (whole, rawCount: string, gap: string, noun: string, tail: string | undefined) => {
      const numeric = Number(rawCount.replace(/,/g, ""));
      const isOne = ONE.test(rawCount) || numeric === 1;
      const isMany = !isOne && Number.isFinite(numeric) && numeric !== 1;
      if (!isOne && !isMany) return whole;

      let nextNoun = noun;
      if (isOne && SINGULAR[noun.toLowerCase()]) {
        nextNoun = matchCase(noun, SINGULAR[noun.toLowerCase()]);
      } else if (isMany && PLURAL[noun.toLowerCase()]) {
        nextNoun = matchCase(noun, PLURAL[noun.toLowerCase()]);
      } else if (!SINGULAR[noun.toLowerCase()] && !PLURAL[noun.toLowerCase()]) {
        return whole; // not a noun we count — never touch it
      }

      let nextTail = tail ?? "";
      if (tail) {
        const verb = tail.trim().replace(/^[, ]+/, "");
        const swapped = isOne ? TO_SINGULAR[verb] : TO_PLURAL[verb];
        if (swapped) nextTail = tail.replace(verb, swapped);
      }
      return `${rawCount}${gap}${nextNoun}${nextTail}`;
    },
  );

  // "Nobody ... are" style leftovers from group templates.
  out = out.replace(/\b(Nobody|Somebody|Someone|Everyone)\s+(are|were|have)\b/g, (_m, s, v) => {
    return `${s} ${TO_SINGULAR[v as keyof typeof TO_SINGULAR] ?? v}`;
  });

  return out;
}

/** Count + noun, correctly inflected. Prefer this over hand-written templates. */
export const countNoun = (n: number, singular: string, plural?: string): string =>
  `${n.toLocaleString("en-US")} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;

/** Apply agreement to every prose field of a story-shaped object. */
export function fixStoryAgreement<
  T extends {
    headline: string;
    body: string;
    attribution?: string | null;
    pattern?: string | null;
    question?: string | null;
  },
>(story: T): T {
  return {
    ...story,
    headline: fixAgreement(story.headline),
    body: fixAgreement(story.body),
    attribution: story.attribution == null ? story.attribution : fixAgreement(story.attribution),
    pattern: story.pattern == null ? story.pattern : fixAgreement(story.pattern),
    question: story.question == null ? story.question : fixAgreement(story.question),
  };
}
