/**
 * SEMANTIC QUESTIONS — the one place the PI is allowed to look UP from the tape
 * and notice what people were actually taking a side on.
 *
 * Everything else in the question layer reasons about mechanics: money against
 * people, price against positions, one wallet against its own history. That is
 * genuinely investigative and it is also, after a few hundred rows, a very
 * sophisticated ticker. The thing a human notices — and the machine did not —
 * is the relationship between a market's STATE and its PROPOSITION:
 *
 *   Observed:  nobody is left on NO.
 *   Market:    "Is selling your data worth a $20 airdrop?"
 *   PI:        "Is $20 really enough to make that trade-off feel worth it?"
 *
 * That is the champagne-and-strawberries move applied to the title instead of
 * to a second metric. The PI is not claiming why anyone acted; it is asking the
 * obvious human question created by putting two true things next to each other.
 *
 * WHAT THIS IS NOT. There is no proposition classifier here, no embedding, no
 * ontology and no model call. The title is COPY MATERIAL, nothing more. All
 * eligibility comes from state shapes the rest of the system already proves,
 * and the sentence is a deterministic template. That is the entire design: the
 * state decides whether a question may exist, the proposition decides what it
 * sounds like.
 *
 * FOUR GUARDRAILS, all enforced below:
 *
 *   1. STATE FIRST. A row must already be one of a short list of proven shapes
 *      (a side emptied, a long one-sidedness, a reawakening, a side finally
 *      getting company, a lopsided book). A plain receipt can never produce one.
 *   2. GROUNDED ONLY. Every fact in the sentence comes from the observed state
 *      or the literal title. No invented context, no external knowledge.
 *   3. SPECIFIC OR SILENT. If the question could be pasted unchanged under an
 *      unrelated market, it is not a question, it is a mood. `isPropositionSpecific`
 *      is the bar, and it is checked before the line is returned.
 *   4. CURIOSITY, NEVER CERTAINTY. `BANNED_QUESTION_PATTERNS` blocks motive,
 *      psychology, hidden knowledge and price prediction. A candidate that trips
 *      one is dropped rather than rewritten — a template that keeps needing an
 *      escape hatch is the wrong template.
 *
 * And the quiet one: SOME MARKETS DESERVE SILENCE. A joke question ("one
 * horse-sized duck or 100 duck-sized horses") has no proposition to interrogate,
 * and a semantic layer that comments on everything becomes unbearable in about
 * four rows. `looksLikeAJoke` exists so the feature can decline.
 *
 * ZERO IO, pure, deterministic, fully testable.
 */
import { pickVariant } from "./pi-voice";

/** The proven state shapes a semantic question may attach to. Nothing else. */
export type SemanticState =
  | "side_emptied"
  | "one_sided_persistence"
  | "lopsided_book"
  | "side_got_company"
  | "back_from_dead";

export interface SemanticInput {
  /** Stable row key — the only source of variation. */
  key: string;
  /** The literal market proposition. Absent means no semantic question. */
  title: string | null | undefined;
  state: SemanticState;
  /** The side the state is about, when it has one. */
  side: "YES" | "NO" | null;
  facts?: {
    /** Proven days of one-sidedness, for `one_sided_persistence`. */
    days?: number | null;
    /** Silent days before a reawakening. */
    quietDays?: number | null;
    /** Trades in the burst that ended the silence. */
    trades?: number | null;
    /** Money on the heavy side of a lopsided book. */
    leadUsd?: number | null;
    /** Money on the light side. */
    laggardUsd?: number | null;
  };
}

/* ── GUARDRAILS ──────────────────────────────────────────────────────────── */

/**
 * Sentences the PI may never say, whatever the state. Every one of these claims
 * something the tape cannot see: motive, private information, ideology, or where
 * the price goes next.
 */
export const BANNED_QUESTION_PATTERNS: readonly RegExp[] = [
  /what do (they|those|these) know/i,
  /what (are|were) they seeing/i,
  /\binsiders?\b/i,
  /why hasn.?t this been priced/i,
  /is (the )?price about to/i,
  /should you (buy|sell)/i,
  /are you missing/i,
  /people (clearly|obviously) believe/i,
  /nobody cares about/i,
  /this proves/i,
  /the crowd knows/i,
  /smart money/i,
];

export const containsBannedLanguage = (text: string): boolean =>
  BANNED_QUESTION_PATTERNS.some((re) => re.test(text));

/**
 * Markets with no proposition to interrogate. Deliberately a tiny, literal list
 * of joke FORMS rather than a topic model: a false negative costs one missing
 * question, a false positive costs the reader's trust in the whole layer.
 */
const JOKE_MARKERS: readonly RegExp[] = [
  /would you rather/i,
  /who would win/i,
  /duck-sized|horse-sized/i,
  /\b(lol|lmao|kek)\b/i,
  /[\u{1F600}-\u{1F64F}]/u,
];

export const looksLikeAJoke = (title: string): boolean =>
  JOKE_MARKERS.some((re) => re.test(title));

/* ── THE PROPOSITION AS COPY ─────────────────────────────────────────────── */

const LEADING =
  /^(will|is|are|was|were|should|shall|can|could|would|do|does|did|has|have|had|must|may)\s+/i;

/**
 * The title reduced to the thing being argued about, so it can sit inside a
 * sentence: "Is selling your data worth a $20 airdrop?" → "selling your data
 * worth a $20 airdrop". Pure string surgery — no meaning is extracted and none
 * is claimed.
 */
export function proposition(title: string): string | null {
  const t = title.trim().replace(/\s+/g, " ").replace(/[?.!]+$/, "");
  if (t.length < 12) return null;
  const stripped = t.replace(LEADING, "");
  const frag = (stripped.length >= 8 ? stripped : t).trim();
  if (frag.split(" ").length < 3) return null;
  return frag.charAt(0).toLowerCase() + frag.slice(1);
}

/** The most words a quoted topic may carry before it stops being a phrase and
 *  starts being the headline read back to the reader. */
export const MAX_TOPIC_WORDS = 8;

const SUBORDINATOR = /^(if|when|whether|that|because|after|before|once|unless)\s+/i;

/**
 * A quoted topic short enough to sit INSIDE a sentence.
 *
 * The failure this fixes: the headline already says the proposition, and then
 * the question quoted the whole of it again — "Nothing for 7 days and now this.
 * Did something change about “if you suddenly became rich, would you still
 * work”, or just the attention on it?" That is the tape repeating itself at
 * double length. A topic is a HANDLE for the thing above it, not a second copy
 * of it: keep the first clause, drop the subordinator, and if it is still long,
 * the sentence quotes nothing rather than quoting everything.
 */
export function shortTopic(frag: string): string | null {
  const clause = (frag.split(/[,;:]/)[0] ?? frag).trim().replace(SUBORDINATOR, "");
  const words = clause.split(" ").filter(Boolean);
  if (words.length < 3 || words.length > MAX_TOPIC_WORDS) return null;
  const out = words.join(" ");
  return out.charAt(0).toLowerCase() + out.slice(1);
}


/** A dollar figure named IN THE PROPOSITION — the strongest semantic hook there is. */
export function stakeInTitle(title: string): string | null {
  const m = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|bn|b)?/i.exec(title);
  if (!m) return null;
  return `$${m[1].replace(/,/g, "")}${(m[2] ?? "").toLowerCase()}`;
}

const MONEY_STOP = new Set([
  "the","a","an","and","or","of","to","in","on","for","with","is","are","be","this","that","it",
  "your","you","their","its","was","were","will","would","should","can","could","do","does","did",
  "has","have","had","not","no","yes","but","if","by","as","from","at","than","then","more","less",
]);

const contentWords = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9$.\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !MONEY_STOP.has(w));

/**
 * Could this question be pasted, unchanged, under an unrelated market? If yes it
 * is generic and is not shipped. The test is concrete: the question has to carry
 * wording that came from THIS proposition — a content word from the title, or
 * the stake the title names.
 */
export function isPropositionSpecific(question: string, title: string): boolean {
  const stake = stakeInTitle(title);
  if (stake && question.includes(stake)) return true;
  const q = new Set(contentWords(question));
  return contentWords(title).some((w) => q.has(w));
}

/* ── THE SHAPES ──────────────────────────────────────────────────────────── */

const other = (side: "YES" | "NO" | null): string =>
  side === "YES" ? "NO" : side === "NO" ? "YES" : "the other side";

const money = (v: number): string =>
  v >= 1000 ? `$${Math.round(v).toLocaleString("en-US")}` : `$${v < 10 ? v.toFixed(2) : Math.round(v)}`;

/** Minimum proven one-sidedness before "still nobody" is a factual word. */
export const ONE_SIDED_MIN_DAYS = 7;
/** Minimum silence before "woke up" is factual. */
export const REAWAKEN_MIN_QUIET_DAYS = 5;
/** A book is only lopsided when the light side is rounding error against the heavy one. */
export const LOPSIDED_RATIO = 0.05;
export const LOPSIDED_MIN_LEAD_USD = 25;

function variantsFor(i: SemanticInput, title: string, short: string | null): string[] {
  const stake = stakeInTitle(title);
  /* THE PROPOSITION IS QUOTED, NOT PARAPHRASED, AND ONLY WHEN IT IS SHORT.
     Dropping a title fragment bare into a sentence produces "Did selling your
     data worth a $20 airdrop stop being a question?" — the PI mangling the
     thing it is quoting. Quotation marks make the fragment a noun and keep the
     grammar the reader's. When there is no short handle, the topic-shaped
     variants are simply not offered; the row keeps its headline and says less. */
  const topic = short ? `“${short}”` : null;
  const s = i.side ?? "that side";
  const f = i.facts ?? {};

  switch (i.state) {
    /* CHALLENGE THE PROPOSITION. A side emptying against a title that names a
       price is the single cleanest case in the product: the market literally
       asked whether an amount was enough, and one answer has no takers left. */
    case "side_emptied":
      if (stake)
        return [
          `Nobody is backing ${s} anymore. Is ${stake} really enough to make that trade-off feel worth it?`,
          `${s} is empty. Does ${stake} change the calculation for anyone here?`,
        ];
      return topic
        ? [
            `Nobody is backing ${s} anymore. Is ${topic} still a real question?`,
            `${s} has no one left. Is there still an argument on ${topic}?`,
          ]
        : [];

    /* ASK WHAT WOULD HAVE TO CHANGE, NOT WHETHER THE CONSENSUS IS "REAL".
       "Is the consensus holding up, or going unchallenged?" is an analyst
       commenting on a market: nothing in that sentence is a thing the reader can
       look for. The interesting fact is already sitting in the first clause —
       weeks of one-sidedness and no takers — so the question points forward at
       the missing evidence instead of relabelling the fact. */
    case "one_sided_persistence": {
      const d = Math.floor(f.days ?? 0);
      const o = other(i.side);
      return [
        `${d} days and nobody has taken ${o}. What would it take for someone to disagree?`,
        `${d} days without a single ${o}. Who would have to show up to make this a market?`,
      ];
    }

    /* QUESTION WHETHER THE MARKET IS ACTUALLY SPLIT. */
    case "lopsided_book": {
      if (!topic) return [];
      const lead = f.leadUsd ?? 0;
      const light = f.laggardUsd ?? 0;
      return [
        `${money(lead)} on one side, ${money(light)} on the other. Is ${topic} really a two-sided market?`,
        `Real money on one side of ${topic}, pocket change on the other. Split market, or one-sided conviction?`,
      ];
    }

    /* THE ARRIVAL IS ONLY INTERESTING AGAINST THE PROPOSITION. "Does this expose
       a real split, or only test the consensus?" is abstraction — expose, real
       split and consensus are not things in the evidence. What is genuinely
       unresolved is WHO is willing to argue the thing the market asks, now that
       somebody has put money there. Without a usable handle on the proposition
       the arrival speaks for itself and this shape stays silent. */
    case "side_got_company":
      if (!topic) return [];
      return [
        `Somebody finally put money behind ${s}. Who is willing to argue ${topic}?`,
        `${s} finally has money behind it. What did they see in ${topic}?`,
      ];


    /* QUESTION WHETHER ATTENTION CHANGED — attention, never outcome.
       AND WITHOUT QUOTING THE PROPOSITION BACK. The row already prints the
       question the market asks, immediately above this line; repeating it
       inside the question ("Did something change about “if you suddenly became
       rich, would you still work”, or just the attention on it?") is the tape
       talking to itself at double length. Less semantic, more human: name the
       silence, name the return, and ask why now. */
    case "back_from_dead": {
      const q = Math.floor(f.quietDays ?? 0);
      const t = Math.max(1, Math.floor(f.trades ?? 1));
      return [
        `${q} quiet days, then ${t} ${t === 1 ? "trade" : "trades"}. Why did this come back now?`,
        `Nobody touched this for ${q} days. What changed today?`,
      ];
    }
  }
}


/** A question longer than this is the headline read back at the reader. */
export const MAX_QUESTION_CHARS = 130;


/**
 * The semantic question this state and this proposition have earned, or null —
 * which is the answer for almost every row, by design.
 */
export function semanticQuestion(i: SemanticInput): string | null {
  const title = (i.title ?? "").trim();
  if (title.length === 0) return null;
  if (looksLikeAJoke(title)) return null;

  const frag = proposition(title);
  if (!frag) return null;

  // STATE GATES. Each shape names the fact that makes its wording literally
  // true; without that fact the shape is not offered rather than softened.
  const f = i.facts ?? {};
  if (i.state === "one_sided_persistence" && (f.days ?? 0) < ONE_SIDED_MIN_DAYS) return null;
  if (i.state === "back_from_dead" && (f.quietDays ?? 0) < REAWAKEN_MIN_QUIET_DAYS) return null;
  if (i.state === "lopsided_book") {
    const lead = f.leadUsd ?? 0;
    const light = f.laggardUsd ?? 0;
    if (lead < LOPSIDED_MIN_LEAD_USD || light > lead * LOPSIDED_RATIO) return null;
  }
  if (i.state === "side_got_company" && (f.days ?? 0) < 3) return null;

  /* SPECIFICITY IS A TEST FOR SENTENCES THAT FLOAT FREE OF THEIR ROW. Dormancy
     and persistent one-sidedness do not float: their measured tenure and state
     are only sayable under this market, whose proposition is printed directly
     above. Requiring either to quote the title is how the question layer ends
     up repeating the headline. Every other shape still has to earn it. */
  const grounded =
    i.state === "back_from_dead" ||
    i.state === "one_sided_persistence" ||
    i.state === "side_got_company";
  const variants = variantsFor(i, title, shortTopic(frag)).filter(
    (v) =>
      v.length <= MAX_QUESTION_CHARS &&
      !containsBannedLanguage(v) &&
      (grounded || isPropositionSpecific(v, title)),
  );
  if (variants.length === 0) return null;
  return pickVariant(`${i.key}:semantic:${i.state}`, variants);
}

