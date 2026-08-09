/**
 * THE QUESTION LAYER — the last stage of the Insider pipeline.
 *
 *     facts → detect tension → explain what changed → ASK THE OPEN QUESTION → rank
 *
 * Everything before this file establishes what is true and says it plainly. This
 * file does the one thing that makes the feed read like an investigator rather
 * than a faster ticker: when two facts genuinely do not fit together, it asks
 * the reader the question the data has exposed — and never answers it.
 *
 * FOUR RULES, ALL ENFORCED BELOW.
 *
 * 1. THE QUESTION IS EARNED, NOT DECORATIVE. Only a row the vector already calls
 *    Intelligence, carrying a named unresolved shape (a contradiction, a silence
 *    after real money, a hierarchy that changed hands, a person unwinding), may
 *    ask anything. Receipts and milestones never do.
 * 2. IF THE FACTS ALREADY ANSWER IT, THERE IS NO QUESTION. A `resolved` clue has
 *    its own ending ("Now it's moving") — asking after that is theatre.
 * 3. THE QUESTION COMES FROM THE SIGNAL, NOT FROM A BADGE. Every line here is
 *    written against a specific `tensionKind` / `concentrationKind` / signal, so
 *    it can only ask about the gap those numbers actually expose. There is no
 *    generic "why now?" pool.
 * 4. NO HYPOTHESIS THE EVIDENCE DOES NOT SUPPORT. The PI may name the two
 *    candidate readings the data leaves open ("losing conviction, or just taking
 *    money off the table?") and must never assert either, imply hidden
 *    knowledge, or manufacture urgency.
 *
 * Determinism is inherited from pi-voice: variants are a hash of a stable key,
 * so a row asks the same question on every refresh, on server and client.
 */
import { piHash, pickVariant, voiceLevel, type VoiceInput } from "./pi-voice";

/** The shape of gap being asked about. One per feed window (see `rationQuestions`). */
export type QuestionKind =
  | "people_up_capital_down"
  | "capital_up_price_flat"
  | "price_up_believers_flat"
  | "believers_left_price_rose"
  | "whales_out_newcomers_in"
  | "nonresponse"
  | "before_price"
  | "largest_holder_left"
  | "newcomers_replaced_a_whale"
  | "concentrating"
  | "person_unwinding"
  | "unusual";

export type PIQuestion = { text: string; kind: QuestionKind };

export type QuestionInput = {
  /** Stable per-row key — the row id. Drives variant choice. */
  key: string;
  signal: VoiceInput | null | undefined;
  headline: string;
  body: string;
  /** Cross-market person observation, when the row has one. */
  pattern?: string | null;
  /** Display name of the single actor, when the row is about one person. */
  actorName?: string | null;
};

/**
 * At most this many questions in one feed window. A page of questions is an
 * interrogation, not an investigation.
 */
export const MAX_QUESTIONS_PER_FEED = 3;

/** A person visibly reducing exposure across a market — the pattern layer's words. */
const UNWINDING = /backing away|unwinding|cutting|reducing|stepped back|trimming/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function personQuestions(name: string | null): string[] {
  const who = name && name.trim().length > 0 ? name.trim() : "they";
  const Who = cap(who);
  return [
    `Is ${who} losing conviction, or just taking money off the table?`,
    `Did ${who} learn something, or is this position sizing?`,
    `${Who} left in pieces rather than all at once — winding down, or making room?`,
  ];
}

/**
 * The question this row has earned, or null — which is the answer for the large
 * majority of rows.
 */
export function piQuestion(input: QuestionInput): PIQuestion | null {
  const v = input.signal;
  if (!v) return null;

  // RULE 1 — only a genuine clue may ask anything.
  if (voiceLevel(v) !== "intelligence") return null;
  // RULE 2 — a clue with a proven ending answers itself.
  if (v.clue === "resolved") return null;

  const s = v.signals;
  let kind: QuestionKind | null = null;
  let variants: string[] = [];

  if (s.tension > 0 && v.tensionKind) {
    kind = v.tensionKind;
    switch (v.tensionKind) {
      case "people_up_capital_down":
        variants = [
          "Are smaller holders replacing someone bigger?",
          "Who left while everyone else was arriving?",
          "More hands, less money — is that new believers, or one exit hidden behind them?",
        ];
        break;
      case "capital_up_price_flat":
        variants = [
          "Money keeps arriving and nothing moves — who is selling into it?",
          "What is absorbing all of this?",
          "Is someone selling as fast as this is being bought?",
        ];
        break;
      case "price_up_believers_flat":
        variants = [
          "What moved the price if conviction didn't move with it?",
          "Same crowd, different price — did a few people get much bigger?",
          "Is this new belief, or the same believers paying more?",
        ];
        break;
      case "believers_left_price_rose":
        variants = [
          "People left and the price went up anyway — who bought what they sold?",
          "Is the exit the story, or whoever was happy to take the other side?",
        ];
        break;
      case "whales_out_newcomers_in":
        variants = [
          "Did the big money learn something the newcomers haven't?",
          "Is this a handover, or a distribution?",
        ];
        break;
    }
  } else if (s.nonresponse > 0) {
    kind = "nonresponse";
    variants = [
      "Real money landed and nothing moved — is anyone on the other side paying attention?",
      "Why hasn't this been priced yet?",
      "Is the market disagreeing with that money, or hasn't it noticed it?",
    ];
  } else if (s.concentration > 0 && v.concentrationKind) {
    switch (v.concentrationKind) {
      case "largest_holder_left":
        kind = "largest_holder_left";
        variants = [
          "Does anyone here still hold a position that size?",
          "Did the biggest holder know something, or need the money?",
        ];
        break;
      case "newcomers_replaced_a_whale":
        kind = "newcomers_replaced_a_whale";
        variants = [
          "Are smaller holders replacing someone bigger?",
          "Is the conviction the same size now that it's spread across more people?",
        ];
        break;
      case "concentrating":
        kind = "concentrating";
        variants = [
          "This side is now mostly one person — whose read is the price?",
          "If that holder leaves, what is left behind them?",
        ];
        break;
      default:
        kind = null;
    }
  } else if (s.beforePrice > 0) {
    kind = "before_price";
    variants = [
      "Money moved first — is the price about to follow, or is nobody convinced?",
      "Who is taking the other side of this quietly?",
    ];
  } else if (s.unusual >= 0.8) {
    kind = "unusual";
    variants = [
      "Why here, and why today?",
      "Something brought this crowd — what did they see?",
    ];
  }

  // A person visibly unwinding is the one PERSON-shaped question. It may lead
  // when the market shapes above found nothing, because the behaviour is the
  // unresolved thing.
  if (!kind && input.pattern && UNWINDING.test(input.pattern)) {
    kind = "person_unwinding";
    variants = personQuestions(input.actorName ?? null);
  }
  // ...and it overrides a bare concentration read, where the person IS the gap.
  if (
    (kind === "largest_holder_left" || kind === "concentrating") &&
    input.pattern &&
    UNWINDING.test(input.pattern)
  ) {
    kind = "person_unwinding";
    variants = personQuestions(input.actorName ?? null);
  }

  if (!kind || variants.length === 0) return null;

  const text = pickVariant(`${input.key}:${kind}`, variants);

  // RULE 4-adjacent: a question that only repeats the sentence above it is not
  // a question, it is an echo. It must introduce something the row hasn't said.
  if (!questionAdds(text, `${input.headline} ${input.body} ${input.pattern ?? ""}`)) return null;

  return { text, kind };
}

const STOP = new Set([
  "the","a","an","is","are","was","were","and","or","but","if","it","its","this","that","these",
  "those","to","of","in","on","at","for","with","by","as","from","did","do","does","has","have",
  "had","not","no","yes","just","still","now","who","what","why","how","them","they","their",
  "there","here","been","be","more","less","than","into","out","up","down","over","anyone",
  "someone","something","else","much","many","one","two","same","other","another","while","when",
]);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9$%.\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * True when the question introduces a term the row has not already printed —
 * the canonical rule ("if it doesn't change how I read the line above, it isn't
 * intelligence") applied to the third line.
 */
export function questionAdds(question: string, said: string): boolean {
  const known = new Set(words(said));
  const fresh = words(question).filter((w) => !known.has(w));
  return fresh.length >= 2;
}

/**
 * Window-wide rationing. Keeps the strongest few questions and at most one of
 * each shape, so a busy hour cannot turn the feed into a quiz. Returns the set
 * of row ids allowed to keep their question.
 */
export function rationQuestions(
  rows: Array<{ id: string; kind: QuestionKind; gain: number }>,
  max: number = MAX_QUESTIONS_PER_FEED,
): Set<string> {
  const keep = new Set<string>();
  const seen = new Set<QuestionKind>();
  const ordered = [...rows].sort(
    (a, b) => b.gain - a.gain || (piHash(a.id) - piHash(b.id) || a.id.localeCompare(b.id)),
  );
  for (const r of ordered) {
    if (keep.size >= max) break;
    if (seen.has(r.kind)) continue;
    seen.add(r.kind);
    keep.add(r.id);
  }
  return keep;
}
