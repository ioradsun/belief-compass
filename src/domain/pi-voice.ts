/**
 * THE PI VOICE — how the Now feed speaks, and nothing else.
 *
 * The event layer (src/domain/conviction-event, src/domain/story-event) decides
 * WHAT IS TRUE. This module decides WHAT IS WORTH SAYING ABOUT IT and how to say
 * it. The two must not blur, so the pipeline has three separated stages and this
 * file owns the last two:
 *
 *     FACT            → PIObservation → PICopy
 *     (trusted event)   (this file)     (this file)
 *
 * The product idea: Now should read like a sharp private investigator watched
 * the room while you were away. They notice, they compare, they occasionally
 * point at a genuine gap. They never invent motive, never imply hidden
 * knowledge, never manufacture urgency, and never tell you what to do.
 *
 * THE PI IS NOT A QUESTION GENERATOR. That is the failure mode this module is
 * built to prevent. A feed of "Why now?" / "What do they know?" is manipulative
 * noise, so a question may only be asked when the FACTS THEMSELVES leave
 * something unresolved (`questionEligible`), and even then only on a minority of
 * rows (`QUESTION_SHARE`). Five editorial responses, in intended proportion:
 *
 *   RECEIPT   ~40%  the event is enough; say it and stop
 *   INSIGHT   ~30%  the facts already reveal something; name it
 *   CONTEXT   ~20%  the fact means more next to a baseline we actually have
 *   CURIOSITY ~10%  two facts genuinely disagree; ask the open question
 *   SUPPRESS        nothing useful to add and too weak to spend a slot on
 *
 * DETERMINISM. Variety must never come from randomness — the same row must read
 * identically on every refresh, on server and client, forever. Every choice here
 * is a hash of a stable key (source key / row id / fingerprint), so the copy is
 * varied across the feed and frozen per row.
 *
 * VARIANTS MAY CHANGE PHRASING, NEVER MEANING. Fact, side, amount, count,
 * relationship and intensity are identical across every variant of a state. The
 * corpus test in pi-voice.test.ts holds that line, along with the banned
 * vocabularies below.
 */
import type { LiveCategory, LiveStory, NetworkLabel, Side, BeatTone } from "./story";
import type { TensionKind, ConcentrationKind, ClueStage } from "./signal-vector";
import {
  classifyConvictionEvent,
  formatStoryMoney,
  heldFor,
  tellConvictionStory,
  EVENT_CATEGORY,
  EVENT_KICKER,
  REL_KICKER,
  REL_WHO,
  type ConvictionEvent,
  type ConvictionEventType,
} from "./conviction-event";

// ── determinism ──────────────────────────────────────────────────────────────

/** FNV-1a. Stable across runtimes; the whole variation system rests on it. */
export function piHash(key: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** One of `xs`, chosen by `key`. Never random, never time-dependent. */
export function pickVariant<T>(key: string, xs: readonly T[]): T {
  if (xs.length === 0) throw new Error("pickVariant: no variants");
  return xs[piHash(key) % xs.length]!;
}

/**
 * How often a question-eligible observation actually asks its question. Even a
 * real curiosity gap is usually better left as an observation; asking every time
 * turns a voice into a tic.
 */
export const QUESTION_SHARE = 0.35;

const asksQuestion = (key: string): boolean => (piHash(`q:${key}`) % 100) / 100 < QUESTION_SHARE;

// ── the observation model ────────────────────────────────────────────────────

export type PIResponse = "receipt" | "insight" | "context" | "curiosity" | "suppress";

export interface PIObservation {
  /** The human story family this belongs to — the angle, not the event name. */
  angle:
    | "arrival"
    | "scale"
    | "first_mover"
    | "side_filled"
    | "commitment"
    | "turn"
    | "departure"
    | "holdout"
    | "emptied"
    | "rush"
    | "contradiction"
    | "reawakening"
    | "new_question"
    | "milestone"
    | "relationship";
  response: PIResponse;
  /**
   * `fact` — every claim is arithmetic on trusted numbers.
   * `bounded` — a number the index can only lower-bound (tenure before indexing).
   * A bounded observation may never make an exact contextual claim.
   */
  certainty: "fact" | "bounded";
  /** True only when the facts themselves leave something unresolved. */
  questionEligible: boolean;
  /** The numbers the copy is allowed to use. Nothing else may be spoken. */
  facts: Record<string, number | string | null>;
}

/** Words the PI never uses — system language and fake-insider language. */
export const PI_BANNED = [
  // system / telemetry
  "increased",
  "decreased",
  "participation",
  "metric",
  "signal detected",
  "material move",
  "threshold",
  "aggregate",
  "delta",
  "observed",
  // fake insider / hype
  "smart money",
  "insider",
  "alpha",
  "someone knows something",
  "guaranteed",
  "easy money",
  "can't miss",
  "moon",
  "whale",
  "pouring",
  "exploding",
  // directive
  "you should",
  "buy now",
  "don't miss",
  "act fast",
] as const;

// ── conviction events → observation ──────────────────────────────────────────

const n = (v: number | null | undefined): number =>
  v == null || !Number.isFinite(Number(v)) ? 0 : Number(v);

/**
 * "Two people" reads like a person talking; "2 people" reads like a row count.
 * Small crowds get words, larger ones keep the digit because "seventeen people"
 * is harder to scan than the number itself.
 */
const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"] as const;
export const countWord = (k: number, noun = "people"): string =>
  k >= 1 && k <= 9 ? `${WORDS[k]} ${k === 1 ? noun.replace(/s$/, "") : noun}` : `${k} ${noun}`;

const ANGLE: Record<ConvictionEventType, PIObservation["angle"]> = {
  swept_out: "departure",
  swept_in: "rush",
  first_believer: "first_mover",
  side_opened: "side_filled",
  doubled_down: "commitment",
  big_backing: "scale",
  joined: "arrival",
  trimmed: "departure",
  long_held_exit: "turn",
  biggest_believer_left: "departure",
  last_believer_left: "emptied",
  big_exit: "departure",
  left: "departure",
  round_trip: "turn",
  changed_mind: "turn",
  surging: "rush",
  milestone: "milestone",
  new_market: "new_question",
};

/**
 * What the PI makes of one trusted conviction event.
 *
 * Nothing here reads copy and nothing here writes copy — it decides only whether
 * the facts speak for themselves, reveal something, deserve comparison, or leave
 * a real gap. `tellPiStory` renders the decision.
 */
export function observeConviction(e: ConvictionEvent): PIObservation {
  const type = classifyConvictionEvent(e);
  const c = e.context ?? {};
  const rel = e.actor?.relationship ?? null;
  const amount = n(c.amountUsd);
  const days = n(c.daysHeld);
  const remaining = c.sideBelieversAfter == null ? null : n(c.sideBelieversAfter);
  const people = Math.max(1, n(c.peopleCount) || 1);

  const facts: PIObservation["facts"] = {
    type,
    side: e.side,
    amountUsd: c.amountUsd ?? null,
    daysHeld: c.daysHeld ?? null,
    believersAfter: remaining,
    peopleCount: people,
    marketCount: c.marketCount ?? null,
    relationship: rel,
  };

  // A relationship makes an otherwise ordinary act about the reader. That is
  // context, not a claim about what the person knows.
  const relational = rel != null;

  let response: PIResponse;
  switch (type) {
    case "first_believer":
    case "side_opened":
    case "last_believer_left":
    case "biggest_believer_left":
    case "changed_mind":
    case "swept_out":
    case "swept_in":
      response = "insight";
      break;
    case "big_backing":
    case "long_held_exit":
      response = relational ? "context" : "insight";
      break;
    case "doubled_down":
    case "round_trip":
    case "milestone":
      response = relational ? "context" : "receipt";
      break;
    case "joined":
    case "left":
    case "trimmed":
      // An ordinary arrival or exit with nothing attached is exactly the row the
      // PI should stay quiet about. It still renders as a receipt if admitted.
      response = relational
        ? "context"
        : amount < 0.005 && remaining == null
          ? "suppress"
          : "receipt";
      break;
    default:
      response = "receipt";
  }

  /**
   * QUESTIONS, AND WHY THERE ARE SO FEW HERE. A single act by a single person
   * almost never leaves a factual gap — "Parzival doubled down. What does he
   * know?" invents one. The exceptions are turns by someone whose history with
   * the reader makes the divergence itself the unresolved thing, and a person
   * abandoning a book of markets at once.
   */
  const questionEligible =
    (type === "changed_mind" && relational) || (type === "swept_out" && n(c.marketCount) >= 3);

  return {
    angle: relational && (type === "joined" || type === "left") ? "relationship" : ANGLE[type],
    response,
    certainty: c.tenureIsFloor === true && days > 0 ? "bounded" : "fact",
    questionEligible,
    facts,
  };
}

// ── conviction events → copy ─────────────────────────────────────────────────

interface Draft {
  headline: string;
  body: string;
  /** The third line. An angle, a scale receipt, or nothing — never two. */
  angle?: string | null;
}

const toneFor = (side: Side | null, negative: boolean): BeatTone =>
  side == null ? "neutral" : side === "YES" ? (negative ? "no" : "yes") : negative ? "yes" : "no";

const NEGATIVE: ReadonlySet<ConvictionEventType> = new Set<ConvictionEventType>([
  "trimmed",
  "left",
  "big_exit",
  "long_held_exit",
  "biggest_believer_left",
  "last_believer_left",
  "swept_out",
]);

/**
 * Render one trusted conviction event in the PI's voice.
 *
 * `key` must be stable for the row (source key, row id) — it is the only source
 * of variation, so the same event always reads the same way.
 *
 * Anything this module has no better angle on falls through to the plain fact
 * grammar in conviction-event. Silence beats a synonym.
 */
export function tellPiStory(e: ConvictionEvent, key: string): LiveStory {
  const type = classifyConvictionEvent(e);
  const obs = observeConviction(e);
  const c = e.context ?? {};
  const side = e.side;
  const s = side ?? "";
  const rel = e.actor?.relationship ?? null;
  const name = e.actor?.name ?? null;
  const people = Math.max(1, n(c.peopleCount) || 1);
  const amount = n(c.amountUsd);
  const money = formatStoryMoney(amount);
  const days = n(c.daysHeld);
  const floor = c.tenureIsFloor === true;
  const held = days >= 1 ? heldFor(days, floor) : null;
  const remaining = c.sideBelieversAfter == null ? null : n(c.sideBelieversAfter);
  const who = name ?? (rel ? REL_WHO[rel] : people > 1 ? `${people} people` : "Someone");
/* SUBJECT-VERB AGREEMENT. `who` is sometimes a GROUP — "2 people" — and the
   templates below were written for a single actor, which is how the feed
   shipped "2 people is out." A reader forgives a dull sentence; they do not
   forgive a broken one, because broken grammar reads as a broken system and
   every number next to it stops being trustworthy. These carry the plurality
   of the subject into the handful of templates that inflect. */
  const many = !name && !rel && people > 1;
  const IS = many ? "are" : "is";
  const WAS = many ? "were" : "was";
  const ONLY_ONE = many ? "the only ones" : "the only one";
  const FIRST_ONE = many ? "the first ones" : "the first one";
  const LAST_ONE = many ? "the last ones" : "the last one";
  const question = obs.questionEligible && asksQuestion(key);

  /** The company/room line — the one thing a behaviour sentence can't carry. */
  const scale = (() => {
    if (remaining == null || remaining <= 0) return null;
    if (NEGATIVE.has(type))
      return remaining === 1 ? "One believer left." : `Only ${remaining} left.`;
    const others = remaining - 1;
    if (others <= 0) return null;
    return others === 1 ? "One other is with them." : `${others} others are with them.`;
  })();

  const drafts = ((): Draft[] | null => {
    switch (type) {
      // FIRST MOVER — an empty room, then somebody in it.
      case "first_believer":
        return side
          ? [
              {
                headline: "Went first",
                body: `${who} went first.`,
                angle: `${s} was empty until they put ${amount > 0 ? money : "money"} behind it.`,
              },
              { headline: "Went first", body: `Nobody wanted ${s}. ${who} did.` },
              { headline: "Went first", body: `${s} had no one. Then ${who} stepped in.` },
              {
                headline: "First one in",
                body: `${who} ${IS} ${ONLY_ONE} on ${s}${amount > 0 ? `, with ${money}` : ""}.`,
              },
            ]
          : [{ headline: "Went first", body: `${who} ${IS} ${FIRST_ONE} here.` }];

      // SIDE FILLED — not a person going first; a side becoming an argument.
      /* KICKERS NAME WHAT CHANGED SOCIALLY, NOT WHAT CHANGED IN THE TABLE.
         "SIDE OPENED" is a state name — the kind of phrase a backend would
         choose. What actually happened is that a side nobody would stand on has
         people standing on it, so the kicker says that. */
      case "side_opened":
        return [
          {
            headline: side ? `${s} just got company` : "Just got company",
            body: `Nobody was on ${s || "that side"}. Now ${people > 1 ? `${people} people are` : "somebody is"}.`,
          },
          {
            headline: "Empty no more",
            body: `${people > 1 ? `${people} people` : "Somebody"} stepped into an empty ${s || "side"}.`,
            angle: remaining ? `${remaining} on ${s || "it"} now.` : null,
          },
          {
            headline: side ? `${s} just got company` : "Just got company",
            body: `${s || "That side"} had nobody on it an hour ago.`,
            angle: people > 1 ? `${people} people stepped in at once.` : null,
          },
        ];

      // RUSH / SCALE — several people, or one unusually large arrival.
      case "big_backing":
        /* HEADLINE = WHAT CHANGED, BODY = WHAT PROVES IT. "Got heavier / YES
           just got heavier." says one thought twice and wastes the only two
           lines the card has. The kicker names the change; the sentence under
           it carries the evidence and nothing else. */
        if (people > 1)
          return [
            {
              headline: side ? `${s} got company` : "Got company",
              body: `${countWord(people)} piled into ${s || "one side"}${amount > 0 ? ` with ${money}` : ""}.`,
              angle: remaining ? `${remaining} believers now.` : null,
            },
            {
              headline: side ? `${s} just got heavier` : "Got heavier",
              body:
                amount > 0
                  ? `${countWord(people)} brought in ${money}.`
                  : `${countWord(people)} stepped in at once.`,
              angle: remaining ? `${remaining} believers now.` : null,
            },
            ...(amount > 0
              ? [
                  {
                    headline: `${money} just landed`,
                    body: `${countWord(people)} stepped into ${s || "one side"}.`,
                    angle: remaining ? `${remaining} believers now.` : null,
                  },
                ]
              : []),
          ];


        return [
          {
            headline: `${money} just landed`,
            body: `${who} put it behind ${s || "their side"}.`,
            angle: scale,
          },
          { headline: "Backed", body: `${who} put ${money} behind ${s || "their side"}.` },
          {
            headline: side ? `${s} just got heavier` : "Got heavier",
            body: `${who} added ${money}.`,
            angle: scale,
          },
        ];


      case "joined":
        /* A GROUPED ARRIVAL IS A SOCIAL FACT, NOT A COUNT. "2 came in" recites
           the number and stops; what actually changed is that somebody on that
           side is no longer standing there alone. The count still appears — in
           the sentence, where it belongs — and the amount is said ONCE. */
        if (people > 1)
          return [
            {
              headline: side ? `${s} got company` : "Got company",
              body: `${countWord(people)} stepped into ${s || "this one"}${amount >= 0.005 ? ` with ${money}` : ""}.`,
              angle: remaining ? `${remaining} believers now.` : null,
            },
            {
              headline: `${countWord(people)} just stepped in`,
              body:
                amount >= 0.005
                  ? `${money} landed on ${s || "one side"}.`
                  : `${s || "This one"} got company.`,
              angle: remaining ? `${remaining} believers now.` : null,
            },
          ];

        return [
          {
            headline: "New believer",
            body: side
              ? `${who} backed ${s}${amount >= 0.005 ? ` with ${money}` : ""}.`
              : `${who} took a side.`,
            angle: scale,
          },
          {
            headline: "Stepped in",
            body: side ? `${who} stepped into ${s}.` : `${who} stepped in.`,
            angle: amount >= 0.005 ? `${money} behind it.` : scale,
          },
        ];

      // COMMITMENT — they were already here and they are not done.
      case "doubled_down":
        return [
          {
            headline: "Not done",
            body: `${who} ${WAS}n't done.`,
            angle: amount > 0 ? `Another ${money} on ${s || "the same side"}.` : null,
          },
          {
            headline: "Doubled down",
            body: side
              ? `Still on ${s}. More money behind it.`
              : `Still there. More money behind it.`,
            angle: amount > 0 ? `${who} added ${money}.` : null,
          },
          {
            headline: "Added again",
            body: `${who} added${amount > 0 ? ` ${money}` : ""} to ${s || "their side"}.`,
          },
        ];

      /**
       * TURN — the highest-value human story in the feed, and it was getting
       * the least storytelling: "kodak.base.eth changed their mind." said less
       * than a $1.80 add. A flip is a binary market, so the side they LEFT is
       * known the moment the side they arrived on is — no new data, a much
       * better sentence. Tenure, where the index has it, is the whole drama.
       */
      case "changed_mind": {
        const from = side === "YES" ? "NO" : side === "NO" ? "YES" : null;
        // "kodak.base.eth" is an address in a headline; "kodak" is a person.
        const shortName = name ? name.split(".")[0]! : null;
        const kicker = shortName ? `${shortName} flipped` : "Flipped";
        const base: Draft[] = held
          ? [
              {
                headline: kicker,
                body: from
                  ? `Held ${from} for ${held}. Now they're on ${s}.`
                  : `${who} held on for ${held}. Then changed their mind.`,
                angle: null,
              },
              {
                headline: kicker,
                body: from
                  ? `${from} for ${held}. Then ${s}.`
                  : `${held} of holding, then the turn.`,
                angle: `${who} changed their mind.`,
              },
            ]
          : [
              {
                headline: kicker,
                body: from ? `${from} before. ${s} now.` : `${who} changed their mind.`,
                angle: from && name ? null : side ? `${who} flipped to ${s}.` : null,
              },
              {
                headline: "Changed sides",
                body: side ? `${who} flipped to ${s}.` : `${who} changed their mind.`,
              },
            ];
        if (rel)
          base.push({
            headline: REL_KICKER[rel],
            body: from ? `${who} ${WAS} on ${from}. Now ${s}.` : `${who} just changed sides.`,
            angle: question
              ? "What do they see differently here?"
              : held
                ? `${held} of holding, then the turn.`
                : null,
          });
        return base;
      }

      case "round_trip":
        return [
          {
            headline: "In and out",
            body: side
              ? `${who} backed ${s} and left the same day.`
              : `${who} came and went the same day.`,
          },
          { headline: "Blinked", body: `${who} ${WAS} in and out inside a day.` },
        ];

      // DEPARTURE — kept quieter than arrivals unless the state changed.
      case "left":
        return [
          {
            headline: "Believer left",
            body: side ? `${who} walked away from ${s}.` : `${who} walked.`,
            angle: amount >= 0.005 ? `${money} left with them.` : scale,
          },
          {
            /* HEADLINE = CONSEQUENCE, BODY = EVIDENCE. "One less / One less
               believer on YES." is the same sentence twice; the body's job is
               to name who, and how much walked with them. */
            headline: "One less",
            body:
              amount >= 0.005
                ? `${who} pulled ${money} from ${s || "it"}.`
                : side
                  ? `${who} left ${s}.`
                  : `${who} left.`,
            angle: scale,
          },

          { headline: "Out", body: `${who} ${IS} out.`, angle: scale },
        ];

      case "trimmed":
        return [
          {
            headline: "Sold some",
            body:
              amount >= 0.005
                ? `${who} took ${money} off ${s || "the table"}.`
                : `${who} sold some of ${s || "it"}.`,
            angle: scale,
          },
          {
            headline: "Lightened up",
            body: `${who} ${IS} still in ${s || "this"}, just lighter${amount >= 0.005 ? ` by ${money}` : ""}.`,
          },
        ];

      case "big_exit":
        return [
          {
            headline: "Big exit",
            body: `${who} pulled ${amount > 0 ? money : "out"} out of ${s || "this one"}.`,
            angle: scale,
          },
          {
            headline: "Money walked",
            body: `${amount > 0 ? `${money} walked off ${s || "the table"}` : `${who} walked`}.`,
            angle: `${who} ${IS} out.`,
          },
        ];

      case "long_held_exit":
        return [
          {
            headline: "Lost conviction",
            body: `${who} gave up on ${s || "it"}${held ? ` after ${held}` : ""}.`,
            angle: scale,
          },
          {
            headline: "Gave up",
            body: held ? `${held} of belief. ${who} let it go.` : `${who} let it go.`,
            angle: scale,
          },
        ];

      case "biggest_believer_left":
        return [
          {
            headline: "Biggest believer left",
            body: `The biggest believer in ${s || "this"} walked${amount > 0 ? ` with ${money}` : ""}.`,
            angle: scale,
          },
          {
            headline: "The heaviest one left",
            body: `${who} held more of ${s || "this"} than anyone. Not anymore.`,
            angle: scale,
          },
        ];

      // HOLDOUT / EMPTIED — a qualitative state change, so it may hit harder.
      case "last_believer_left":
        return [
          {
            headline: side ? `${s} just emptied out` : "Emptied out",
            body: amount >= 0.005 ? `${who} took the last ${money} off it.` : `${who} ${WAS} ${LAST_ONE} on ${s || "it"}.`,
          },
          {
            headline: "Last one left",
            body: `${who} ${WAS} ${LAST_ONE} backing ${s || "it"}.`,
            angle: side ? `Nobody is on ${s} now.` : null,
          },
        ];


      case "swept_out": {
        const markets = n(c.marketCount);
        const base: Draft[] = [
          {
            headline: "Clearing out",
            body: `${who} pulled out of ${markets} markets${amount > 0 ? `, ${money} in all` : ""}.`,
            angle: question ? "All on the same day. Why now?" : null,
          },
          {
            headline: "Cleared the book",
            body: `${who} walked away from ${markets} questions at once.`,
            angle: amount > 0 ? `${money} came off the table.` : null,
          },
        ];
        return base;
      }

      case "swept_in": {
        const markets = n(c.marketCount);
        return [
          {
            headline: "Going broad",
            body: `${who} backed ${markets} markets at once.`,
            angle: amount > 0 ? `${money} spread across them.` : null,
          },
          {
            headline: "Spread out",
            body: `${who} took a side in ${markets} questions today.`,
          },
        ];
      }

      default:
        return null;
    }
  })();

  if (!drafts || obs.response === "suppress") {
    // No angle worth the words — the plain fact grammar already says it well.
    return tellConvictionStory(e);
  }

  const d = pickVariant(key, drafts);
  return {
    category: (rel ?? EVENT_CATEGORY[type]) as LiveCategory,
    headline: rel && type !== "changed_mind" ? REL_KICKER[rel] : d.headline || EVENT_KICKER[type],
    body: d.body,
    attribution: d.angle ?? null,
    tone: toneFor(side, NEGATIVE.has(type)),
    personal: rel != null,
  };
}

// ── derived market reads: intensity + variants ───────────────────────────────

/**
 * MONEY LEAVING, SCALED TO HOW MUCH LEFT.
 *
 * −20%, −65% and −100% are three different events and must never share a
 * sentence. Intensity is derived from the number, never chosen for drama.
 */
export function capitalDrainLine(side: string, pct: number, key: string): Draft {
  const m = Math.abs(pct);
  if (m >= 99)
    return pickVariant(key, [
      { headline: `${side} just emptied out`, body: `Every dollar that was there is gone.` },
      { headline: "Emptied out", body: `${side} has nothing behind it now.` },
    ]);
  if (m >= 60)
    return pickVariant(key, [
      { headline: `${side} is getting thin`, body: `Most of the money behind it left.` },
      { headline: "Money walked", body: `${side} lost the bulk of what was behind it.` },
    ]);
  return pickVariant(key, [
    { headline: `${side} is getting lighter`, body: `Some of what was behind it walked.` },
    { headline: `Money is drifting out of ${side}`, body: `Not all of it. Enough to notice.` },
  ]);
}

/** Money arriving, same discipline in the other direction. */
export function capitalArrivalLine(side: string, pct: number, key: string): Draft {
  const m = Math.abs(pct);
  if (m >= 90)
    return pickVariant(key, [
      { headline: `${side} nearly doubled`, body: `The money behind ${side} almost doubled.` },
      { headline: "Piling in", body: `${side} is carrying close to twice what it was.` },
    ]);
  return pickVariant(key, [
    { headline: `Money is piling into ${side}`, body: `It is carrying more than it was.` },
    { headline: `${side} got heavier`, body: `More money is standing behind it.` },
  ]);
}

/**
 * BACK FROM THE DEAD, in proportion. A weak return is somebody touching the
 * question again; a strong one is the room filling. Same fact, honest volume.
 */
export function reawakenLine(trades: number, strong: boolean, key: string): Draft {
  const t = `${trades} ${trades === 1 ? "trade" : "trades"}`;
  if (!strong)
    return pickVariant(key, [
      { headline: "Somebody woke this up", body: `Quiet for a week. Then ${t} landed.` },
      { headline: "A pulse", body: `Nothing for seven days, and now ${t}.` },
    ]);
  return pickVariant(key, [
    { headline: "This one's back", body: `Nothing for seven days. Then ${t} landed.` },
    {
      headline: "Back from the dead",
      body: `A week of silence. Now people are piling back in — ${t} today.`,
    },
  ]);
}

/**
 * THE SIGNATURE PI STORY: the crowd moved one way and the money moved the other.
 * The only conviction-free place a question genuinely belongs, and even here it
 * is the minority reading.
 */
export function crowdMoneyDivergenceLine(
  people: number,
  moneyOut: string,
  key: string,
): Draft & { questionEligible: true } {
  const q = asksQuestion(key);
  const v = pickVariant(key, [
    {
      headline: "More believers. Less money.",
      body: `${people} ${people === 1 ? "person" : "people"} came in while ${moneyOut} walked out.`,
    },
    {
      headline: "The crowd grew. The pot shrank.",
      body: `${people} new ${people === 1 ? "believer" : "believers"}, ${moneyOut} gone.`,
    },
  ]);
  return {
    ...v,
    angle: q ? "Who's leaving bigger than they're arriving?" : "That's an odd combination.",
    questionEligible: true,
  };
}

/** Price re-rated with nobody new behind it. Insight, not a question. */
export function priceWithoutCrowdLine(side: string, pctText: string, key: string): Draft {
  return pickVariant(key, [
    {
      headline: "The price moved. The crowd didn't.",
      body: `${side} moved ${pctText} with no new believers behind it.`,
    },
    {
      headline: "Same believers. Different price.",
      body: `${side} re-rated ${pctText} and nobody new joined.`,
    },
  ]);
}

export type { Draft as PIDraft };
export type { NetworkLabel };

// ── voice levels: how loud the PI is allowed to be about one row ─────────────

/**
 * THREE VOLUMES, AND THE SIGNAL DECIDES WHICH — never the writer.
 *
 *   receipt      the event is the whole story. "Alex pulled $15 from YES."
 *   observation  one real, single-signal change. "YES is thinning out."
 *   intelligence two facts that disagree, or a silence worth timing.
 *
 * The point of naming these is the cost attached downstream (feed-cadence): a
 * feed of unbroken Intelligence reads as manufactured, so repetition is charged
 * for. The level itself is pure classification of the viewer-blind vector, so a
 * row's volume cannot drift with who is reading or how busy the window is.
 *
 * A row only reaches Intelligence when the signal is BOTH of the right kind and
 * actually earned BY THIS ROW: `informationGain` already carries the carrier
 * discount, so a trade inheriting a share of its market's anomaly speaks at
 * observation volume while the row holding the evidence speaks at full volume.
 * That is the §6 rule "style is not insight" expressed as arithmetic.
 */
export type VoiceLevel = "receipt" | "observation" | "intelligence";

/** Unusualness on its own has to be pronounced before it counts as a clue. */
export const INTELLIGENCE_UNUSUAL_MIN = 0.6;
/** Below this the row has no earned claim on the market's story at all. */
export const OBSERVATION_GAIN_MIN = 0.05;
/** Intelligence needs enough gain that the contradiction is worth the volume. */
export const INTELLIGENCE_GAIN_MIN = 0.12;

export type VoiceInput = {
  signals: {
    tension: number;
    beforePrice: number;
    unusual: number;
    concentration: number;
    reversing: number;
    building: number;
    nonresponse: number;
    confirmation: number;
  };
  informationGain: number;
  /** Which contradiction / which concentration — the angle layer needs the kind. */
  tensionKind?: TensionKind;
  concentrationKind?: ConcentrationKind;
  /** Clue lifecycle (plan §9). Only ever past `new` when ordering was proven. */
  clue?: ClueStage;
  /** Signed relative move since the input, ONLY when proven from observations. */
  provenMoveSinceInput?: number;
};

/**
 * The volume this row has earned. Social rows carry an all-zero vector and a
 * missing vector means "we know nothing" — both are receipts, which is the
 * honest default.
 */
export function voiceLevel(v: VoiceInput | null | undefined): VoiceLevel {
  if (!v) return "receipt";
  const s = v.signals;
  const gain = v.informationGain;
  if (gain < OBSERVATION_GAIN_MIN) return "receipt";

  const contradicts = s.tension > 0 || s.nonresponse > 0 || s.unusual >= INTELLIGENCE_UNUSUAL_MIN;
  if (contradicts && gain >= INTELLIGENCE_GAIN_MIN) return "intelligence";

  // `building` alone is the default state of a growing market — accumulation is
  // not an observation, it is the weather.
  const real =
    s.beforePrice > 0 ||
    s.unusual > 0 ||
    s.concentration > 0 ||
    s.reversing > 0 ||
    s.tension > 0 ||
    // A proven before/after is an observation, never just a receipt.
    s.confirmation > 0;
  return real ? "observation" : "receipt";
}

// ── viewer-relative angle selection (plan §7) ────────────────────────────────

/**
 * THE ANGLE IS VIEWER-RELATIVE. THE SIGNAL IS NOT.
 *
 * Admission and ranking are viewer-blind: the SignalVector never sees who is
 * reading. Once a row is admitted, though, the editorial choice of WHICH FACT TO
 * FOREGROUND may see the relationship — "Three wallets entered NO" becomes "Your
 * Rival was one of them".
 *
 * The invariant that makes this safe: **personal context augments, it never
 * replaces a market clue.** Throwing away "price didn't move" to say "your rival
 * did it" discards the most valuable thing in the row. So a row with a non-zero
 * market signal keeps the observation; only an all-zero social row may be
 * personal-only.
 */
export type ViewerAngleInput = {
  relationship: NetworkLabel | null | undefined;
  signal: VoiceInput | null | undefined;
};

/**
 * The market clue, in one sentence, from the vector alone.
 *
 * Every line here restates exactly what the signal encodes and stops. No motive,
 * no causation (plan §8 keeps before/after phrasing gated), no expectation the
 * model did not compute. Returns null when the vector has nothing to say —
 * `building` is the weather, not a clue.
 */
export function clueLine(v: VoiceInput | null | undefined): string | null {
  if (!v) return null;
  if (voiceLevel(v) === "receipt") return null;
  const s = v.signals;

  /* THE CLUE'S OWN LIFE COMES FIRST (plan §9).
     "Since then" is only ever said when `signal-vector` proved the ordering from
     price observations either side of the input. A `new` clue never gets this
     phrasing, so nothing here can imply a sequence we did not observe. */
  const move = v.provenMoveSinceInput;
  if (v.clue === "resolved" && typeof move === "number") {
    const pct = Math.abs(move * 100);
    return `Now it's moving. Price is ${move > 0 ? "up" : "down"} ${pct.toFixed(0)}% since then.`;
  }
  if (v.clue === "developing") {
    return "Still quiet. Same money in, price basically unchanged since then.";
  }

  if (s.tension > 0) {
    switch (v.tensionKind) {
      case "people_up_capital_down":
        return "More people are here. Less money is.";
      case "capital_up_price_flat":
        return "Money keeps arriving. The price is where it was.";
      case "price_up_believers_flat":
        return "The price moved. The number of believers didn't.";
      case "believers_left_price_rose":
        return "Believers left while the price went up.";
      case "whales_out_newcomers_in":
        return "The biggest positions left. Smaller ones took their place.";
      default:
        return "The people and the money are pointing different ways.";
    }
  }

  if (s.nonresponse > 0) return "Real money landed here and the price still hasn't moved.";

  if (s.concentration > 0) {
    switch (v.concentrationKind) {
      case "largest_holder_left":
        return "The largest position on this side is gone.";
      case "newcomers_replaced_a_whale":
        return "One large holder left. Several small ones arrived.";
      case "concentrating":
        return "This side is held by fewer, larger positions than it was.";
      case "distributing":
        return "This side is spread across more hands than it was.";
      default:
        return null;
    }
  }

  if (s.beforePrice > 0) return "Money moved. The price hasn't.";
  if (s.reversing > 0) return "This market just turned the other way.";
  if (s.unusual >= INTELLIGENCE_UNUSUAL_MIN) return "This market is busier than its own normal.";
  if (s.unusual > 0) return "Busier here than usual.";
  return null;
}

/**
 * Foreground the relationship without losing the clue.
 *
 * - No relationship → unchanged. The angle is viewer-relative or it is nothing.
 * - Relationship + zero-signal row → unchanged: the social story already owns
 *   the row, and there is no market observation to preserve.
 * - Relationship + real signal → the kicker names the reader's person, the body
 *   keeps the behaviour, and the market observation is carried in the third line
 *   so both survive.
 */
export function applyViewerAngle(story: LiveStory, input: ViewerAngleInput): LiveStory {
  const rel = input.relationship ?? null;
  if (!rel) return story;
  const clue = clueLine(input.signal);
  if (!clue) return story;
  return {
    ...story,
    headline: REL_KICKER[rel],
    attribution: clue,
    personal: true,
  };
}
