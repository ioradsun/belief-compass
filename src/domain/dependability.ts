/**
 * DO WE SHOW UP FOR EACH OTHER?
 *
 * The one question this module answers, and the reason the whole Challenge system
 * exists: make someone feel they are not alone in what they believe.
 *
 * THE LADDER. Five rungs, each earned by evidence and never granted. The rung IS
 * the user-facing score — there is no separate number competing with it, because a
 * percentage beside "you can count on Sarah" says the same thing twice and says it
 * worse.
 *
 *     Call                        someone's conviction reaches you
 *     Showed up                   they answered
 *     Shows up for you            a pattern is forming
 *     You can count on Sarah      strong evidence
 *     You show up for each other  reciprocal — the highest state in the product
 *
 * That last rung is the payoff. DNA says we are similar; Tribe says we are
 * connected; Challenge creates the opportunity; this proves the behaviour. It is
 * where the software stops describing people and starts describing a relationship,
 * and the whole vocabulary exists to make one sentence become true.
 *
 * "DEPENDABILITY" IS THE FILE NAME AND NOTHING ELSE. It is accurate and clinical —
 * it sounds like a field in HR software — so it names the module, the type and the
 * arithmetic, and never reaches a screen. `BANNED_UI_WORDS` is enforced by test.
 *
 * WHY THE PERCENTAGE IS EARNED RATHER THAN SHOWN. Measured before this was written:
 * of 6,727 possible caller→responder pairs, the MEDIAN PAIR SHARES ONE MARKET and
 * only 5% share five or more. So `100% · 1 call` would have been the most common
 * thing on the platform. A rate on a sample of one is not a fact about a person, it
 * is a fact about the sample — so below `minForScore` the ladder simply does not
 * reach its higher rungs. There is no degraded fallback, only a shorter sentence.
 *
 * WHAT IS DELIBERATELY NOT HERE. No composite with Shared DNA: `92% DNA, one-way`
 * and `28% DNA, counts on you` are the two most interesting relationships on the
 * platform, and averaging them to "61% compatible" erases exactly what makes them
 * interesting. The two calculations never touch. Also no streaks, no currency, no
 * XP, no reciprocity penalty — the relationship is the reward.
 *
 * NO NEGATIVE EVIDENCE, EVER. Not answering is the absence of a positive, never the
 * presence of a negative. Nothing here can produce "unreliable", "ignored" or a red
 * state, and a call that aged out of reach leaves the denominator entirely rather
 * than counting against someone who was never shown it again.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SHOWING UP IS PARTICIPATION. IT IS NEVER AGREEMENT.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The invariant this module exists to protect, and the one most likely to be
 * eroded by a well-meaning future change. Sarah answering your call means SHE TOOK
 * A SIDE — nothing more. Whether it was your side is not merely irrelevant here,
 * it is the property of a different question entirely:
 *
 *     Conviction Match / Shared DNA   do we reach the same conclusions?
 *     Showing up                      are you there when I call?
 *
 * A Rival who answers every call is the single most valuable relationship this
 * product can surface: someone who disagrees with you about everything and turns
 * up anyway. If YES/NO ever leaked into this calculation, that person would score
 * as unreliable and the most interesting relationship on the platform would be
 * rendered as a failure.
 *
 * IT IS ENFORCED STRUCTURALLY, not by discipline. `CallFact` carries two
 * timestamps and no side; `market_calls` has no side column; nothing in this
 * module's inputs can express one. A future change that wanted to weight by
 * agreement would have to add a field to get there, and the tests assert the shape
 * as well as the behaviour so that addition cannot pass quietly.
 *
 * ZERO IO, pure, fully testable.
 */
import { CHALLENGE } from "@/domain/challenge";

/**
 * A call, reduced to only what the ladder needs.
 *
 * TWO TIMESTAMPS AND DELIBERATELY NO SIDE. Answering is participation; which side
 * they took is Conviction Match's question and never this one. The absence is the
 * enforcement — see the invariant at the top of this file.
 */
export interface CallFact {
  /** Null while nobody has answered. Not "answered in agreement" — answered. */
  respondedAtMs: number | null;
  /** When the call was surfaced — what decides whether it is still reachable. */
  calledAtMs: number;
}

/**
 * One direction of a relationship, already counted.
 *
 * `waiting` is calls still inside the window. `outOfReach` is calls that left it —
 * held separately because they are shown to nobody and counted in nothing, and
 * folding them into `waiting` would quietly turn "the moment passed" into "they
 * ignored you".
 */
export interface Tally {
  answered: number;
  waiting: number;
  outOfReach: number;
}

export const EMPTY_TALLY: Tally = { answered: 0, waiting: 0, outOfReach: 0 };

export const DEPENDABILITY = {
  /**
   * Eligible calls before a rate means anything. Five, matching the decision count
   * that unlocks the social system and the believer count that makes a market a
   * conversation — one number, three places, rather than a third threshold to
   * calibrate. Roughly 5% of pairs clear it today, which is the point: the higher
   * rungs are rare because showing up five times is rare.
   */
  minForScore: 5,
  /** The rate at which one-way evidence becomes "you can count on them". */
  countOnRate: 0.7,
  /**
   * Calls stay reachable for exactly as long as they stay derivable — the SAME
   * constant the rail derives against, not a copy of it. A second 30 here would
   * drift, and the day it did, a profile would show someone waiting on a call
   * their caller can no longer see.
   */
  windowDays: CHALLENGE.windowDays,
} as const;

/**
 * The five rungs, plus the silence below them.
 *
 * `none` is a real state and the most common one. It renders nothing — not "no
 * history yet", not "0%". Quietness beats manufactured information.
 */
export type Rung = "none" | "showed_up" | "shows_up" | "count_on" | "each_other";

export interface Bond {
  rung: Rung;
  /** The sentence. Null at `none` — the caller renders nothing at all. */
  sentence: string | null;
  /** Answered / eligible, them → you. Null below `minForScore`. */
  rate: number | null;
  /** "Sarah has shown up 13 of 17 times." Null with no history. */
  evidence: string | null;
  /** They answered you at least once. */
  theyShowed: boolean;
  /** You answered them at least once. */
  youShowed: boolean;
}

/** Calls that can still be acted on, plus the ones that were. Never the rest. */
export function eligible(t: Tally): number {
  return Math.max(0, t.answered) + Math.max(0, t.waiting);
}

/**
 * Answered over eligible, or null when the sample cannot support a number.
 *
 * Deliberately raw — no Bayesian smoothing, no prior. A rate that has been adjusted
 * is a rate nobody can check against the list of calls sitting underneath it, and
 * that list is the whole reason this is auditable rather than magical.
 */
export function rateFor(t: Tally): number | null {
  const n = eligible(t);
  if (n < DEPENDABILITY.minForScore) return null;
  return Math.max(0, t.answered) / n;
}

/**
 * Which rung this relationship has reached.
 *
 * Reciprocity outranks everything, including a perfect one-way record, because a
 * relationship in one direction is a pattern and a relationship in both is a bond.
 * Below that the rungs need a rate, and without one the honest statement is the
 * smallest one: they showed up.
 */
export function rungFor(theirs: Tally, yours: Tally): Rung {
  const theyShowed = theirs.answered > 0;
  const youShowed = yours.answered > 0;
  if (theyShowed && youShowed) return "each_other";
  if (!theyShowed) return "none";
  const rate = rateFor(theirs);
  if (rate == null) return "showed_up";
  return rate >= DEPENDABILITY.countOnRate ? "count_on" : "shows_up";
}

/**
 * The whole user-facing relationship, from two counted directions.
 *
 * `name` is required and never defaulted: every sentence here puts a person's name
 * in front of a reader, and "someone shows up for you" is worse than silence. A
 * caller with no name passes the wallet alias, exactly as the Challenge rail does.
 */
export function bondFor(name: string, theirs: Tally, yours: Tally): Bond {
  const who = name.trim();
  const theyShowed = theirs.answered > 0;
  const youShowed = yours.answered > 0;
  const rung = who ? rungFor(theirs, yours) : "none";
  return {
    rung,
    sentence: sentenceFor(rung, who),
    rate: rateFor(theirs),
    evidence: evidenceFor(who, theirs),
    theyShowed,
    youShowed,
  };
}

/** The hero line. One sentence, or nothing. */
function sentenceFor(rung: Rung, who: string): string | null {
  switch (rung) {
    case "each_other":
      return "You show up for each other.";
    case "count_on":
      return `You can count on ${who}.`;
    case "shows_up":
      return `${who} shows up for you.`;
    case "showed_up":
      return `${who} showed up.`;
    default:
      return null;
  }
}

/**
 * The receipt under the sentence — what makes the claim checkable.
 *
 * Says "of N times" rather than a percentage on purpose: the reader can count the
 * rows below it and get the same answer, which a rounded rate does not allow.
 */
function evidenceFor(who: string, t: Tally): string | null {
  const n = eligible(t);
  if (!who || n === 0 || t.answered === 0) return null;
  if (t.answered === n) {
    return n === 1
      ? `${who} has shown up every time you called.`
      : `${who} has shown up all ${n} times you called.`;
  }
  return `${who} has shown up ${t.answered} of ${n} times.`;
}

/* ── The moment someone shows up ─────────────────────────────────────────── */

/**
 * What the post-order panel says, and it is the emotional peak of the product.
 *
 * Two sentences, one looking back and one forward — every conviction answers calls
 * behind you and creates calls ahead of you, and this is the only surface that can
 * say both at once.
 *
 * NEVER "you took a side": the trade confirmation two inches away already said it,
 * and repeating it spends the one moment that could have said something that
 * matters. When nobody called, the backward line is absent rather than zeroed.
 */
export function showedUpFor(names: readonly string[]): string | null {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return `You showed up for ${clean[0]}.`;
  if (clean.length === 2) return `You showed up for ${clean[0]} and ${clean[1]}.`;
  return `You showed up for ${clean.length} people.`;
}

/* ── Somebody showed up, in Now ──────────────────────────────────────────── */

/**
 * ONE MARKET, ONE ROW — the anti-spam rule, and the reason this is aggregated
 * rather than emitted per answer.
 *
 * Three people answering your call in the same market is ONE thing that happened
 * to you, not three. Emitting a row each would be a notification inbox wearing a
 * tape's clothes: the surface would get louder exactly when a reader was having
 * their best day, and the third row would say nothing the first did not.
 *
 * NAMED WHILE NAMING IS MEANINGFUL. Up to two people get their names, because
 * "Sarah and Mike showed up for you" is a fact about two people you know. Past
 * that the names stop carrying and the count starts: "4 people showed up for
 * you" is both shorter and truer than a list nobody reads to the end.
 */
export function showedUpInMarket(names: readonly string[]): string | null {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return `${clean[0]} showed up for you.`;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]} showed up for you.`;
  return `${clean.length} people showed up for you.`;
}

/**
 * WHAT BECAME OF A CALL ADDRESSED TO ME — the sentence on my own rail.
 *
 * WHOSE RAIL IT IS DECIDES THE SUBJECT, and getting that backwards is the easiest
 * mistake here. Maya challenged me and I took a side: on MY rail the true sentence
 * is "You showed up for Maya", because I am the one who turned up. "Maya showed up"
 * is the same row seen from HER side, and it is already said there by the outbound
 * card's own progress line. One fact, two rails, two subjects, no duplication.
 *
 * SIDE-BLIND, AND THIS IS THE SURFACE WHERE THAT MATTERS MOST. Answering NO to a
 * caller's YES produces this identical sentence. There is no branch on agreement to
 * write, because the input cannot carry one — which is the whole reason a Rival who
 * turns up reads as somebody who turned up.
 *
 * A PASS IS STATED BY THE PERSON WHO CHOSE IT, in the first person, and it names
 * nobody else. "You passed" is a reader describing their own decision on their own
 * screen; the caller is only ever told a count.
 */
export function outcomeLine(
  state: "waiting" | "showed_up" | "passed",
  callerName: string,
): string | null {
  const who = callerName.trim();
  if (state === "showed_up") return showedUpFor([who]);
  if (state === "passed") return "You passed.";
  return null;
}

/* ── Your history ────────────────────────────────────────────────────────── */

/**
 * Who answered whom. Both directions, because a relationship is not a record.
 *
 * TWO WERE ADDED FOR THE COMPLETE HISTORY, and what is NOT here is the decision.
 * `you_passed` exists: a reader looking at their own history is entitled to see a
 * choice they made, stated in the first person. There is deliberately no
 * `they_passed` — the creator of a Challenge is only ever told a COUNT of passes,
 * never a name, because a pass is a choice about a question rather than a verdict
 * on a person, and a timeline reading "Alex passed on you" is the ledger of
 * rejection this product decided not to keep. A row that cannot be shown without
 * naming a passer is simply not in the history.
 *
 * `waiting_on_you` is the honest counterpart to `waiting_on_them`. The pair view
 * on a profile withholds it on purpose — that page is about the relationship, not
 * a list of the reader's own obligations — but a history somebody opened by
 * pressing "See all" is asked to be complete, and silence there would hide the
 * one kind of row the reader can still do something about.
 */
export type CallDirection =
  | "they_answered"
  | "you_answered"
  | "waiting_on_them"
  | "waiting_on_you"
  | "you_passed";

export interface HistoryEntry {
  marketId: number;
  title: string;
  direction: CallDirection;
  /** Sorted on this: responded_at where it exists, else called_at. */
  atMs: number;
  /**
   * The other person, when the timeline spans more than one of them.
   *
   * A pair timeline passes the name once to `historyRows` and leaves this unset;
   * the complete history is about everybody, so each row carries its own. One
   * function, one label vocabulary, two shapes of caller.
   */
  who?: string;
}

export interface HistoryRow extends HistoryEntry {
  /** "Sarah showed up" / "You showed up" / "Waiting on Sarah". */
  label: string;
}

/**
 * The timeline, newest first.
 *
 * THREE STATES, NOT FOUR. A call that left the window is simply not here — it is
 * neither a success nor a failure, and giving it a name would teach the reader a
 * derivation window they should never have to know exists. The counting keeps it;
 * the story does not.
 */
export function historyRows(entries: readonly HistoryEntry[], who = ""): HistoryRow[] {
  const fallback = who.trim();
  return entries
    .filter((e) => e.title.trim() && Number.isFinite(e.atMs) && (e.who?.trim() || fallback))
    .map((e) => {
      const name = e.who?.trim() || fallback;
      return {
        ...e,
        label:
          e.direction === "they_answered"
            ? `${name} showed up`
            : e.direction === "you_answered"
              ? "You showed up"
              : e.direction === "you_passed"
                ? "You passed"
                : e.direction === "waiting_on_you"
                  ? `${name} is waiting`
                  : `Waiting on ${name}`,
      };
    })
    .sort((a, b) => b.atMs - a.atMs || a.marketId - b.marketId);
}

/* ── Back & forth ────────────────────────────────────────────────────────── */

/**
 * WHEN THIS PERSON ASKS WHERE I STAND, I SHOW UP — counted.
 *
 * THIS FILE PREVIOUSLY SAID "no streaks", AND THAT DECISION SURVIVES. What it
 * refused was a DAILY streak: a calendar counter that rewards opening the app,
 * gets loudest for the person with the most free time, and is broken by a
 * holiday. Nothing about that is a relationship.
 *
 * What this counts is different in every respect that made the other one bad.
 * It belongs to a PAIR rather than to a person. It advances only when somebody
 * who was asked actually took a side — a fact the server proved before stamping
 * it. It cannot be advanced by asking, by trading, or by turning up. It has no
 * relationship to dates at all: two challenges answered a year apart are two.
 *
 * AND IT IS STILL NOT CALLED A STREAK. `TABLE_BANNED` and `BANNED_UI_WORDS` both
 * reject the word, and they should keep rejecting it — "5 back & forth" describes
 * what happened between two people; "5 streak" describes a score. The fact is
 * worth having; the vocabulary that would turn it into points is not.
 *
 * SIDE-BLIND, LIKE EVERYTHING ELSE HERE. `PairCall` extends `CallFact`, which has
 * no side and cannot acquire one. A Rival who answers every time runs the longest
 * back & forth on the platform, which is exactly the right outcome.
 */
export interface PairCall extends CallFact {
  /** True when the VIEWER did the asking. The only thing `CallFact` cannot say. */
  fromViewer: boolean;
  /** They waved it off. Ends a run; never negative evidence anywhere else. */
  passedAtMs: number | null;
}

export interface Reciprocity {
  /**
   * The current unbroken run of answered challenges between these two, in either
   * direction. Zero once somebody passes, and zero before anybody answers.
   */
  run: number;
  /**
   * Both people have answered the other at least once. Below this a run is a
   * one-way pattern, which already has its own sentence on the ladder — calling
   * it "back & forth" would be the software flattering the relationship.
   *
   * Agrees with `rungFor(...) === "each_other"` by construction, and a test
   * holds the two together so they cannot drift into two answers.
   */
  bothWays: boolean;
  /**
   * The length of the run the most recent pass ended, or 0 when the last thing
   * that happened was not a pass. Exists so an ending can be stated once, quietly,
   * instead of a number silently becoming smaller.
   */
  endedRun: number;
}

export const NO_RECIPROCITY: Reciprocity = { run: 0, bothWays: false, endedRun: 0 };

export const RECIPROCITY = {
  /**
   * Below this there is nothing to describe. One answered challenge is somebody
   * showing up — the ladder already says so, better — and "1 back & forth" would
   * dress a single act as a pattern.
   */
  minRun: 2,
} as const;

/**
 * The run between two people, from their merged call history.
 *
 * A WAITING CALL PAUSES; IT DOES NOT BREAK. An unanswered question is not a
 * refusal — it may be answered tomorrow — and ending a run on silence would be
 * the negative evidence this module refuses to produce everywhere else. Only a
 * pass, which is somebody actually choosing, ends anything.
 */
export function reciprocity(calls: readonly PairCall[]): Reciprocity {
  const ordered = [...calls].sort((a, b) => a.calledAtMs - b.calledAtMs);
  let run = 0;
  let endedRun = 0;
  let theyAnswered = false;
  let youAnswered = false;
  for (const c of ordered) {
    if (c.respondedAtMs != null) {
      run += 1;
      endedRun = 0;
      // Who showed up is decided by who did the ASKING: a call I made that was
      // answered is them showing up for me, and the reverse is me for them.
      if (c.fromViewer) theyAnswered = true;
      else youAnswered = true;
    } else if (c.passedAtMs != null) {
      endedRun = run;
      run = 0;
    }
  }
  return { run, bothWays: theyAnswered && youAnswered, endedRun };
}

/**
 * THE SAME RUN, ONE PASS LATER — what the reader's own tap just did to it.
 *
 * It exists so the optimistic render and the eventual server truth are the same
 * sentence rather than two. Appending a passed call to the sequence and running
 * `reciprocity` again produces this exactly, and a test holds the two together so
 * the shortcut can never drift from the calculation it stands in for.
 *
 * `bothWays` survives, because it is a statement about history: passing today does
 * not un-answer the times either of you turned up.
 */
export function passedNow(r: Reciprocity): Reciprocity {
  return { run: 0, bothWays: r.bothWays, endedRun: r.run };
}

/**
 * "5 back & forth", or nothing.
 *
 * NO STREAK WORD, NO FLAME, NO BEST-EVER. A personal record beside a live number
 * turns a relationship into a high score to defend, and the moment the current
 * run is the smaller of the two the line is telling somebody they are losing at
 * friendship. One number, describing what has actually happened.
 */
export function backAndForthLine(r: Reciprocity): string | null {
  if (!r.bothWays || r.run < RECIPROCITY.minRun) return null;
  return `${r.run} back & forth`;
}

/**
 * The ending, said once and quietly — §10's whole point.
 *
 * Never "streak lost", never a broken heart, never an exclamation mark. A pass is
 * a choice about a question, and the run stopping is a consequence of that choice
 * rather than a punishment for it. Absent entirely when there was no run worth
 * mentioning, because inventing a loss is worse than saying nothing.
 */
export function runEndedLine(r: Reciprocity): string | null {
  if (r.endedRun < RECIPROCITY.minRun) return null;
  return `Your run of ${r.endedRun} ends here.`;
}

/**
 * THE COMPLETE HISTORY, IN THREE PILES.
 *
 * A HEADING IS ONLY WORTH ITS SPACE IF IT ANSWERS A QUESTION THE READER HAS. On a
 * chronological list the question is "how long ago was this", and a date on every
 * row answers it worse than three words answer it once — sixty rows of "14 Aug"
 * are sixty things to read and compare. Three piles are read once.
 *
 * AND AN EMPTY PILE IS NEVER SHOWN. A "Today" heading over nothing is the software
 * pointing at a day on which the reader did not matter to anybody, which is both
 * useless and unkind. Groups that have no rows do not exist.
 *
 * The boundaries are calendar-free on purpose: 24 hours and 7 days from now,
 * rather than "since midnight", so a row does not change pile because the clock
 * passed twelve.
 */
export type HistoryGroupKey = "today" | "week" | "earlier";

export interface HistoryGroup {
  key: HistoryGroupKey;
  label: string;
  rows: HistoryRow[];
}

const GROUP_LABEL: Record<HistoryGroupKey, string> = {
  today: "Today",
  week: "This week",
  earlier: "Earlier",
};

export function groupHistory(rows: readonly HistoryRow[], nowMs: number): HistoryGroup[] {
  const buckets: Record<HistoryGroupKey, HistoryRow[]> = { today: [], week: [], earlier: [] };
  for (const r of rows) {
    const age = nowMs - r.atMs;
    // A row stamped slightly in the future — clock skew between a browser and the
    // database — belongs in the newest pile, not in "Earlier" via a negative age.
    buckets[age < 86_400_000 ? "today" : age < 7 * 86_400_000 ? "week" : "earlier"].push(r);
  }
  return (["today", "week", "earlier"] as const)
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: GROUP_LABEL[k], rows: buckets[k] }));
}

/**
 * Sort a call into a bucket from its two timestamps.
 *
 * The one place the window is applied, so derivation, the denominator and the
 * timeline can never disagree about what "still reachable" means.
 */
export function bucketOf(call: CallFact, nowMs: number): keyof Tally {
  if (call.respondedAtMs != null) return "answered";
  const ageMs = nowMs - call.calledAtMs;
  return ageMs > DEPENDABILITY.windowDays * 86_400_000 ? "outOfReach" : "waiting";
}

/** Count a list of calls into a tally. */
export function tally(calls: readonly CallFact[], nowMs: number): Tally {
  const t: Tally = { ...EMPTY_TALLY };
  for (const c of calls) t[bucketOf(c, nowMs)] += 1;
  return t;
}

/**
 * Words that must never reach a screen.
 *
 * Two kinds, and both are failures of the same sort. The clinical ones name the
 * machinery — a reader should never learn that a `market_calls` row has a
 * lifecycle. The punitive ones invent negative evidence out of silence, which this
 * product does not have and must never appear to have.
 *
 * Asserted across every string this module can emit.
 */
export const BANNED_UI_WORDS: readonly string[] = [
  "dependab",
  "lapsed",
  "expired",
  "response rate",
  "reliability",
  "unreliable",
  "ignored",
  "missed",
  "overdue",
  "failed",
  "notification",
  "notified",
  "invitation",
  "obligation",
  /**
   * THE RECIPROCITY RUN IS A FACT; "STREAK" IS A SCORE.
   *
   * Added alongside `backAndForthLine`, and it is the reason that function can
   * exist without reopening the argument this file settled at the top. The thing
   * being counted is real — two people, answered challenges, no calendar — and
   * the word would import everything that made a daily streak worth refusing:
   * points, a flame, a thing to protect. `TABLE_BANNED` rejects it on the other
   * side of the same feature.
   */
  "streak",
];
