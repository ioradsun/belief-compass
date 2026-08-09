/**
 * A NEW MARKET IS NOT NEWS BY ITSELF.
 *
 * "ON THE TABLE / <question>" is inventory: it names a thing that now exists
 * and answers none of the questions a reader actually has — who put it there,
 * did anyone take a side, did money follow, is anyone I know involved. This
 * module is the admission gate and the copy for market creation, and it obeys
 * four rules:
 *
 * 1. NAME THE CREATOR WHEN WE HAVE THEM. The creator wallet rides on the
 *    market_created event; if it resolves to a person, the person leads.
 * 2. NEVER INVENT AN ACTOR OR A REACTION. No "someone opened it", no implied
 *    interest. If the fact is missing, the sentence does not make one up.
 * 3. A BARE CREATION IS RECEIPT-GRADE AND DOES NOT BELONG ON THE PRIMARY
 *    SURFACE. Creator identity alone lifts it to Observation only when the
 *    creator is personally relevant to the reader.
 * 4. CREATION + A PROVABLE REACTION (a side taken, people in, capital behind
 *    it, someone the reader knows) or a MEANINGFUL NONRESPONSE after a defined
 *    window is Intelligence — that is the only grade that may ask a question,
 *    and only when the reaction is genuinely unusual.
 */
import { formatStoryMoney } from "./conviction-event";
import { countWord } from "./pi-voice";
import type { LiveStory } from "./story";

/** How loud a new-market row is allowed to be. */
export type NewMarketLevel = "receipt" | "observation" | "intelligence";

export type NewMarketSide = "YES" | "NO" | null;

export type NewMarketInput = {
  /** Resolved display name of the creator, or null when we genuinely have none. */
  creatorName?: string | null;
  /** The reader's relationship to the creator, when there is one. */
  creatorRelationship?: string | null;
  /** Hours since the market opened. Null when the creation time is unknown. */
  ageHours?: number | null;
  believersYes?: number | null;
  believersNo?: number | null;
  /** Capital standing behind the question now, in USD. */
  capitalUsd?: number | null;
  /** Someone the reader knows who is already in, when one exists. */
  personal?: { name: string; relationship: string; side?: NewMarketSide } | null;
};

export type NewMarketVerdict = {
  /** Null when the row does not deserve to be printed at all. */
  story: LiveStory | null;
  /** The loudest this row may ever be. */
  level: NewMarketLevel;
  /** True when the row is inventory and must be dropped from the feed. */
  suppress: boolean;
};

/** Below this, "capital behind it" is rounding noise, not money. */
const CAPITAL_DUST = 1;
/** Silence only becomes a clue once this much time has passed with nobody in. */
export const NONRESPONSE_MIN_HOURS = 5;
/** Past this, an empty market is just an old empty market. */
export const NONRESPONSE_MAX_HOURS = 72;
/** People in this fast is the reaction that earns a question. */
const FAST_HOURS = 3;
const FAST_PEOPLE = 3;
const FAST_CAPITAL = 50;

const n = (v: number | null | undefined): number =>
  v == null || !Number.isFinite(Number(v)) ? 0 : Number(v);

const hours = (h: number): string => {
  const k = Math.round(h);
  if (k <= 1) return "an hour ago";
  if (k < 24) return `${k} hours ago`;
  const d = Math.round(h / 24);
  return d <= 1 ? "yesterday" : `${d} days ago`;
};

/**
 * The story a new market has earned. `null` story + `suppress` means the feed
 * should not carry the row at all.
 */
export function tellNewMarketStory(input: NewMarketInput): NewMarketVerdict {
  const name = input.creatorName?.trim() || null;
  const rel = input.creatorRelationship ?? null;
  const yes = Math.max(0, Math.round(n(input.believersYes)));
  const no = Math.max(0, Math.round(n(input.believersNo)));
  const backers = yes + no;
  const capital = n(input.capitalUsd);
  const age = input.ageHours == null ? null : Math.max(0, n(input.ageHours));
  const personal = input.personal ?? null;

  const money = capital >= CAPITAL_DUST ? formatStoryMoney(capital) : null;
  const side: NewMarketSide = yes > 0 && no === 0 ? "YES" : no > 0 && yes === 0 ? "NO" : null;
  const reacted = backers > 0 || capital >= CAPITAL_DUST;
  const quiet =
    !reacted &&
    age != null &&
    age >= NONRESPONSE_MIN_HOURS &&
    age <= NONRESPONSE_MAX_HOURS;

  const opener = name ?? null;
  const OPENER = opener ? opener.toUpperCase() : null;

  // ── INTELLIGENCE: a reaction we can prove ────────────────────────────────
  if (reacted) {
    const fast = age != null && age <= FAST_HOURS;
    const taken = side ? `taken ${side}` : "taken a side";
    const crowd = backers > 0 ? countWord(backers) : null;

    // Someone the reader knows was early. That is the lead, and it is a fact.
    if (personal) {
      const where = personal.side ? `into ${personal.side}` : "in";
      return {
        story: {
          category: "fresh_market",
          headline: OPENER ? `${OPENER} PUT THIS ON THE TABLE` : "SOMEONE YOU KNOW IS IN",
          body: `${personal.name} was one of the first people ${where}.`,
          attribution: crowd && backers > 1 ? `${crowd} in so far${money ? `, ${money} behind it` : ""}.` : null,
          tone: personal.side === "YES" ? "yes" : personal.side === "NO" ? "no" : "neutral",
          personal: true,
        },
        level: "intelligence",
        suppress: false,
      };
    }

    const unusual =
      age != null && age <= FAST_HOURS && (backers >= FAST_PEOPLE || capital >= FAST_CAPITAL);

    const body = crowd
      ? fast
        ? `${crowd} ${side ? `took ${side}` : "took a side"} within the first hours.`
        : `${crowd} ${backers === 1 ? "has" : "have"} already ${taken}.`
      : `${money} is already behind it.`;

    return {
      story: {
        category: "fresh_market",
        headline: OPENER
          ? `${OPENER} PUT THIS ON THE TABLE`
          : fast
            ? "THIS DIDN'T SIT EMPTY LONG"
            : "SOMEBODY TOOK A SIDE",
        body,
        attribution: crowd && money ? `${money} behind it.` : null,
        tone: side === "YES" ? "yes" : side === "NO" ? "no" : "neutral",
        personal: false,
        question: unusual ? "Why did this one catch so quickly?" : null,
      },
      level: "intelligence",
      suppress: false,
    };
  }

  // ── INTELLIGENCE: the silence, once it has lasted long enough ────────────
  if (quiet && age != null) {
    return {
      story: {
        category: "fresh_market",
        headline: "STILL WAITING FOR A SIDE",
        body: opener
          ? `${opener} opened this ${hours(age)}. Nobody has backed it yet.`
          : `Opened ${hours(age)}. Nobody has backed it yet.`,
        attribution: null,
        tone: "neutral",
        personal: false,
      },
      level: "intelligence",
      suppress: false,
    };
  }

  // ── OBSERVATION: the creator is someone the reader knows ─────────────────
  if (opener && rel) {
    return {
      story: {
        category: "fresh_market",
        headline: `${OPENER} PUT THIS ON THE TABLE`,
        body: `Your ${rel.toLowerCase()} opened a new question.`,
        attribution: null,
        tone: "neutral",
        personal: true,
      },
      level: "observation",
      suppress: false,
    };
  }

  // ── RECEIPT: inventory. Named or not, it is not a story yet. ─────────────
  return {
    story: opener
      ? {
          category: "fresh_market",
          headline: `${OPENER} PUT THIS ON THE TABLE`,
          body: "No one has taken a side yet.",
          attribution: null,
          tone: "neutral",
          personal: false,
        }
      : null,
    level: "receipt",
    suppress: true,
  };
}
