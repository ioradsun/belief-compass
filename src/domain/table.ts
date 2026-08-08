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
  const showed = `${p.showedUp} of ${p.reached} showed up`;
  return p.passed > 0 ? `${showed} · ${p.passed} passed` : showed;
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
