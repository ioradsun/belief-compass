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
// "persons" round-trips to itself above; the plural a person actually says is "people".
PLURAL.person = "people";

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
 * agrees with the number in front of it. Adjectives between the two ("2 new
 * believers") are preserved, and any word that is not a noun this product
 * counts is left exactly as written.
 *
 * Tokenised rather than pattern-matched, because a single regex either misses
 * "1 new believers" or mangles "backed 3 markets at once"; walking the words
 * lets the rule stay narrow: fix the FIRST countable noun after a number.
 */
export function fixAgreement(text: string): string {
  if (!text) return text;
  const parts = text.split(/([A-Za-z']+|\d[\d,]*)/);
  const isWord = (i: number) => i % 2 === 1;

  for (let i = 1; i < parts.length; i += 2) {
    const tok = parts[i];
    const numeric = Number(tok.replace(/,/g, ""));
    const isOne = ONE.test(tok) || numeric === 1;
    const isMany = !isOne && Number.isFinite(numeric) && numeric > 1;
    if (!isOne && !isMany) continue;
    // Only a plain count — never a token inside a longer word or a decimal.
    if (parts[i + 1]?.startsWith(".")) continue;

    // The first countable noun within three words of the number.
    let nounAt = -1;
    for (let k = i + 2; k <= i + 6 && k < parts.length; k += 2) {
      if (!isWord(k)) break;
      if (/\S/.test(parts[k - 1].replace(/\s/g, ""))) break; // punctuation between → stop
      const w = parts[k].toLowerCase();
      if (SINGULAR[w] || PLURAL[w]) {
        nounAt = k;
        break;
      }
    }
    if (nounAt < 0) continue;

    const noun = parts[nounAt];
    const key = noun.toLowerCase();
    parts[nounAt] = matchCase(noun, isOne ? (SINGULAR[key] ?? key) : (PLURAL[key] ?? key));

    // The verb immediately after the noun, when there is one.
    const vAt = nounAt + 2;
    if (vAt < parts.length && /^\s*$/.test(parts[vAt - 1])) {
      const verb = parts[vAt]?.toLowerCase();
      const swapped = isOne ? TO_SINGULAR[verb] : TO_PLURAL[verb];
      if (swapped) parts[vAt] = matchCase(parts[vAt], swapped);
    }
  }

  let out = parts.join("");


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
