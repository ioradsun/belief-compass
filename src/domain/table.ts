/**
 * THREE ON THE TABLE — the outbound Challenge lifecycle.
 *
 * A Challenge used to be something the system inferred: a qualified person traded
 * in a market you had not answered, and a card appeared. Nobody chose it, which is
 * why "Sarah wants you at the table" was not a sentence the data could support.
 *
 * Now it is an act. Somebody looks at a conviction they hold and decides THIS ONE
 * is worth putting in front of their people. That single change is what makes the
 * rest of the model work:
 *
 *     I put a conviction on the table
 *     → my people get the chance to weigh in
 *     → some show up, some pass
 *     → everyone answers, and it closes
 *     → the relationship remembers who showed up
 *
 * ONE CHALLENGE, MANY CALLS, and keeping these apart is the whole architecture.
 * Putting Bitcoin on the table is ONE Challenge. If it reaches Mike, Rasoul, Priya
 * and John, that is four recipient Calls underneath one Challenge — not four
 * slots. The market-level thing is what you choose and what you close; the
 * recipient-level thing is what the relationship remembers.
 *
 * WHY THREE, and it is not rate limiting. A cap of three does two jobs, and the
 * second matters more:
 *
 *   ATTENTION   an active trader cannot flood everyone's rail with every position.
 *   MEANING     choosing one of three is editorial. "This one is worth asking my
 *               people about" is a decision, and a decision is what makes the
 *               thing on the table worth looking at.
 *
 * So the scarce resource is not a credit, a token or a daily allowance. It is HOW
 * MANY THINGS YOU CAN REASONABLY ASK YOUR PEOPLE TO CARE ABOUT AT ONCE. There is
 * no timer, no reset, no minimum, no streak: a slot frees when a Challenge ends,
 * and it ends when everyone has answered or when you take it down.
 *
 * ZERO IO, pure, fully testable. The cap is enforced for real by a partial unique
 * index — see the migration — because counting rows before inserting is a race two
 * browser tabs win. This module owns the MEANING; the database owns the guarantee.
 */

/**
 * THE CAP. One number, one place, and the database mirrors it in a CHECK.
 *
 * Scattering `3` across a component, a server function and a migration is how a
 * cap becomes four different caps. Anything that needs to know reads this.
 */
export const TABLE_SLOTS = 3;

/** Why a Challenge ended. Both are ordinary; neither is a failure. */
export type CloseReason = "creator" | "all_responded";

/**
 * What became of one person's opportunity to weigh in.
 *
 * OPEN and VIEWED are waiting states; SHOWED_UP and PASSED are terminal. Viewing
 * is deliberately NOT terminal — opening a question is not answering it, and a
 * Challenge that closed because everyone glanced at it would be closing on the
 * absence of the only thing it asked for.
 */
export type RecipientState = "open" | "viewed" | "showed_up" | "passed";

/** The two states that end a recipient's part in a Challenge. */
export const TERMINAL_STATES: ReadonlySet<RecipientState> = new Set(["showed_up", "passed"]);

/** One recipient's row, reduced to the two timestamps that decide their state. */
export interface RecipientFact {
  /** They took a side. YES and NO are identical here, and that is the invariant. */
  respondedAtMs: number | null;
  /** They waved it off. Lifecycle only — never relationship evidence. */
  passedAtMs: number | null;
}

/**
 * The state of one recipient.
 *
 * SHOWING UP IS SIDE-BLIND, and the input shape is what guarantees it: there is no
 * `side` on `RecipientFact`, so no future edit can make agreement matter. Somebody
 * who answered NO to a caller's YES showed up exactly as much as somebody who
 * agreed — they answered the same question, which is the only thing that was asked.
 *
 * Responding wins over passing when both are set, which can happen if somebody
 * waves a card off and later finds the market anyway. Taking a side is the larger
 * fact, and the one worth remembering.
 */
export function recipientState(f: RecipientFact): RecipientState {
  if (f.respondedAtMs != null) return "showed_up";
  if (f.passedAtMs != null) return "passed";
  return "open";
}

/** What a creator can be told about their Challenge, and nothing more. */
export interface TableProgress {
  /** People it reached. Frozen at creation, so the denominator cannot drift. */
  reached: number;
  showedUp: number;
  passed: number;
  /** Still deciding — reached minus the terminal ones. */
  waiting: number;
  /** Every recipient has answered one way or the other. */
  allResponded: boolean;
}

export function tableProgress(recipients: readonly RecipientFact[]): TableProgress {
  let showedUp = 0;
  let passed = 0;
  for (const r of recipients) {
    const s = recipientState(r);
    if (s === "showed_up") showedUp += 1;
    else if (s === "passed") passed += 1;
  }
  const reached = recipients.length;
  return {
    reached,
    showedUp,
    passed,
    waiting: reached - showedUp - passed,
    // An audience of nobody is NOT "everyone responded". A Challenge that reached
    // no one has not run its course — it never started, and auto-closing it would
    // free the slot for a reason the creator would not recognise.
    allResponded: reached > 0 && showedUp + passed === reached,
  };
}

/**
 * Should this Challenge close itself?
 *
 * Everyone answered, so there is nothing left for it to do. The slot frees without
 * anybody tidying up, which is the behaviour a person would assume.
 */
export function shouldAutoClose(recipients: readonly RecipientFact[]): boolean {
  return tableProgress(recipients).allResponded;
}

/** How many more things this person can put up right now. */
export function spotsOpen(activeCount: number): number {
  return Math.max(0, TABLE_SLOTS - Math.max(0, Math.floor(activeCount)));
}

export function canPutOnTable(activeCount: number): boolean {
  return spotsOpen(activeCount) > 0;
}

/**
 * THE CAPACITY LINE. "2 on the table · 1 spot open".
 *
 * Deliberately NOT "2 / 3 USED". A fraction with a denominator reads as currency —
 * something being spent, something running out — and turns an editorial choice into
 * a balance. Capacity is the honest framing: this is what you have room for.
 *
 * At capacity it simply stops mentioning room, because there is nothing to say
 * about a spot that does not exist. Nothing warns until somebody actually tries.
 */
export function tableLine(activeCount: number): string | null {
  const n = Math.max(0, Math.floor(activeCount));
  if (n === 0) return null;
  const open = spotsOpen(n);
  const on = `${n} on the table`;
  if (open === 0) return on;
  return `${on} · ${open} spot${open === 1 ? "" : "s"} open`;
}

/**
 * WHAT HAPPENED BECAUSE YOU PUT IT UP — the one line the outbound card leads with.
 *
 * Showing up is first because it is the only outcome that means anything: people
 * moved because somebody asked. Passing follows quietly and only when it happened,
 * because a nought there would invent a problem.
 *
 * WHAT IS ABSENT, AND WHY. No "viewed": the only view signal this product has is
 * client-reported and unverifiable, and "5 viewed" is exactly the claim a creator
 * would believe and the system cannot prove. No capital, no believer count: those
 * are market totals, not Challenge effects, and printing "+$42" beside a Challenge
 * implies a causal link the data cannot support. The moment this line carries four
 * numbers it stops being a social object and becomes an ad-tech panel.
 */
export function progressLine(p: TableProgress): string | null {
  if (p.reached === 0) return null;
  /**
   * ONE LINE, ALWAYS. The card used to print "0 of 7 showed up" AND, underneath,
   * "7 of your people can weigh in. No smoke yet." — the same fact three times,
   * one of them a row of noughts. Before anybody has answered there is exactly
   * one thing to say, so say it and stop.
   */
  if (p.showedUp === 0 && p.passed === 0) return `Waiting on ${p.reached}`;
  const showed = `${p.showedUp} of ${p.reached} showed up`;
  return p.passed > 0 ? `${showed} · ${p.passed} passed` : showed;
}

/* ── The chain ───────────────────────────────────────────────────────────── */

/**
 * SOMEBODY SHOWED UP FOR YOU — said on the card, with their name.
 *
 * THE AGGREGATE RULE STILL HOLDS WHERE IT WAS WRITTEN. "1 passed" stays a count
 * forever: a pass is a choice about a question, and a ledger of who would not is
 * a ledger of rejection with a friendlier label. Naming a RESPONDER is the
 * opposite kind of fact — they took a public position, on-chain, visible to
 * anyone who opens the market — and the product already names them in the tape
 * ("Sarah and Mike showed up for you"). This is that sentence arriving on the
 * card the asking happened from.
 *
 * SIDE-BLIND HEADLINE, SIDED DETAIL, AND THE SPLIT IS THE POINT. "Casey showed
 * up" reads identically whether Casey agreed or not, because whether she agreed
 * has nothing to do with whether she turned up. The side is a separate clause a
 * caller may render in its own colour — never a reason to celebrate harder.
 */
export interface Responder {
  name: string;
  /** What they took WHEN THEY ANSWERED. Null on rows written before it was kept. */
  side: "YES" | "NO" | null;
}

/** "Casey showed up" / "Maya and John showed up" / "3 of your people showed up". */
export function showedUpHeadline(people: readonly Responder[]): string | null {
  const names = people.map((p) => p.name.trim()).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} showed up`;
  if (names.length === 2) return `${names[0]} and ${names[1]} showed up`;
  return `${names.length} of your people showed up`;
}

/**
 * The side clause, and only when one person is being reported.
 *
 * NEVER "she backed YES WITH YOU" unless the caller can prove the pair agreed —
 * and this module cannot: it holds the responder's side and not the creator's.
 * A caller that knows both may pass `creatorSide`; without it the sentence
 * states what the responder did and stops, which is always true.
 */
export function showedUpSide(
  people: readonly Responder[],
  creatorSide?: "YES" | "NO" | null,
): string | null {
  if (people.length !== 1) return null;
  const only = people[0];
  if (!only?.side || !only.name.trim()) return null;
  if (creatorSide && only.side === creatorSide) return `${only.name} backed ${only.side} with you.`;
  return `${only.name} backed ${only.side}.`;
}

/**
 * SOMEBODY CARRIED IT FURTHER — the second win, and the one that makes this a chain.
 *
 * Answering is a person doing something because you asked. Relaying is that
 * person spending one of their own three slots to ask their people, which is a
 * far scarcer act — so it gets its own sentence rather than being folded into
 * the count.
 *
 * IT SAYS TABLES, NOT PEOPLE, and the distinction is honest: a relay puts the
 * question in front of somebody's network, and how many of them answer is not
 * known yet. "On 8 more tables" is a fact about reach; "8 more people showed up"
 * would be a claim about behaviour that has not happened.
 */
export function keptItMovingLine(names: readonly string[], tables: number): string | null {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  const who =
    clean.length === 1
      ? `${clean[0]} kept it moving`
      : clean.length === 2
        ? `${clean[0]} and ${clean[1]} kept it moving`
        : `${clean.length} people kept it moving`;
  if (tables <= 0) return `${who}.`;
  return `${who}. The question is now on ${tables} more table${tables === 1 ? "" : "s"}.`;
}

/**
 * THE RELAY OFFER, at the emotional peak and nowhere else.
 *
 * NEVER "PASS IT ON". `Pass` already means "not for me" in this system, and
 * reusing it for the opposite act would make the one word mean both declining
 * and continuing. The vocabulary is "keep the chain moving".
 *
 * Absent when there is nobody left to ask — an offer that leads to an empty
 * audience is worse than silence, which is the rule `PutOnTable` already follows.
 */
export function keepMovingLine(reachable: number): string | null {
  if (reachable <= 0) return null;
  return `${reachable} of your people haven't answered.`;
}

/** "The question is now on 13 more tables." — after the relay lands. */
export function branchLiveLine(reached: number): string | null {
  if (reached <= 0) return null;
  return `The question is now on ${reached} more table${reached === 1 ? "" : "s"}.`;
}

/**
 * HOW LONG A FINISHED CHALLENGE STAYS ON YOUR TABLE.
 *
 * THE BUG THIS NUMBER EXISTS TO FIX. `tableFor` reads only open rows, and it
 * auto-closes anything everyone has answered — in the same pass that discovers it.
 * So the sequence for a creator was: put a question up, everyone answers, open
 * Yours, and the row is GONE. No count, no sentence, no trace. The single most
 * valuable event this product can produce — people showed up because you asked —
 * was the one event most likely to be deleted before its own author saw it.
 *
 * A week, and then it goes quiet on its own. No dismiss button, no "mark as read",
 * no badge: an outcome you have to file away is an inbox, and the durable record
 * was never here anyway — it is in the relationship, where somebody showing up for
 * you belongs permanently. This surface only has to make sure you FIND OUT.
 */
export const FINISHED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Is a closed Challenge still worth showing its author? */
export function finishedVisible(closedAtMs: number | null, nowMs: number): boolean {
  return closedAtMs != null && nowMs - closedAtMs < FINISHED_WINDOW_MS;
}

/**
 * WHAT BECAME OF IT — the past-tense line, once a Challenge has ended.
 *
 * `progressLine` is a live count of something still happening; this is the ending,
 * and endings read differently. "3 of 8 showed up" beside a finished thing invites
 * the question "and the other five?", which has an answer nobody needs: they ran
 * out of time. The finished voice states the outcome and stops.
 *
 * NOBODY IS BLAMED IN ANY BRANCH, and the empty one is where that is tested. A
 * Challenge everyone passed on is not a person being turned down — the product's
 * own rule is that a pass is a choice about a QUESTION — so the sentence puts it
 * on the question and keeps the asking worthwhile. No count of passes here either:
 * a tally of who would not is a ledger of rejection with a different label on it.
 */
export function finishedLine(p: TableProgress, reason: CloseReason): string {
  if (reason === "creator") {
    return p.showedUp > 0
      ? `You took it off the table. ${p.showedUp} of ${p.reached} showed up.`
      : "You took it off the table.";
  }
  if (p.showedUp === 0) return "Quiet one. Not every question finds its people.";
  if (p.showedUp === p.reached) {
    // "Everyone" needs a crowd to mean anything; at one person it is a flourish
    // about a single human being, which reads as the system trying too hard.
    return p.reached === 1 ? "They showed up." : "Everyone showed up.";
  }
  return `${p.showedUp} of ${p.reached} showed up.`;
}

/**
 * Words this surface must never use.
 *
 * A pass is a choice about a question, not a verdict on a person — so nothing here
 * may read as rejection. And the recipient never "accepted" anything: they were
 * asked where they land, and both answers are the same act, which is why
 * acceptance language would misdescribe the only thing that happens.
 */
export const TABLE_BANNED: readonly string[] = [
  "declined",
  "rejected",
  "ignored",
  "accepted",
  "accept",
  "invite",
  "invited",
  "credits",
  "tokens",
  "allowance",
  "streak",
  "expired",
  "used",
];
