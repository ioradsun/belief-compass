/**
 * PERSON MILESTONES — the second story one action tells.
 *
 * Every family in this feed reports what happened to a MARKET. Somebody backed
 * a question, a side doubled, capital crossed a rung. But one real action is
 * legitimately several stories, and the ones this platform never told are the
 * ones about the PERSON:
 *
 *     Sarah backed AI.                    ← the feed already says this
 *     AI welcomed a new believer.         ← and this
 *     Sarah now backs five questions.     ← nothing said this, ever
 *
 * The third is not a second reading of the first. It is a fact about a person
 * that only became true because of it, and it is the one that makes a reader
 * feel they are watching people rather than transactions.
 *
 * NO TABLE, NO EMITTER, NO LEDGER — the same decision standing facts made, for
 * the same reason. A person milestone is not an event that happened somewhere
 * and must be remembered; it is a shape the database is already holding, and
 * writing a row every time somebody's conviction count crossed a line would
 * mean managing the staleness of rows that never go stale.
 *
 * WHAT MAKES THAT POSSIBLE — and it is worth stating, because it is the whole
 * trick — is that the crossing has its own timestamp already. A belief knows
 * when it began. So "when did they reach five?" is not something we have to
 * have observed: it is the start date of the newest of their five convictions,
 * recoverable from state at any later moment, identically, forever.
 *
 * HONESTY ABOUT EXITS. A count is reported only when it is EXACTLY on a rung
 * and the newest conviction began inside the window. Somebody who once held
 * eight and is now down to five has an old newest-start, so nothing is said —
 * rather than announcing an arrival at a number they reached on the way down.
 * The rule costs a few true stories and cannot tell a false one.
 *
 * ZERO IO, pure, fully testable.
 */

/**
 * Counts a person would notice about themselves.
 *
 * Starts at three because one and two are not yet a pattern — "Sarah backed a
 * question" is already the live row, and saying "Sarah now backs one question"
 * beside it is the same fact twice.
 */
export const CONVICTION_RUNGS = [3, 5, 10, 25, 50, 100] as const;

/** One belief a person currently holds. */
export interface PersonConviction {
  marketId: number;
  title: string;
  /** When this belief began (ISO). Null is unusable — the crossing needs a when. */
  startedAt: string | null;
}

export interface Person {
  wallet: string;
  name: string;
  /** Only the beliefs they still hold. A closed position is not a conviction. */
  convictions: PersonConviction[];
}

export interface PersonMilestone {
  /**
   * Stable across every read, and distinct per crossing: the market that took
   * them there is part of the identity, so a person who falls to four and
   * returns to five in a DIFFERENT market is a new story rather than a repeat.
   */
  id: string;
  wallet: string;
  name: string;
  /** The count they are now on. Always one of CONVICTION_RUNGS. */
  rung: number;
  /** The newest conviction's own start — the instant the count became true. */
  occurredAt: string;
  /** The belief that took them there. */
  marketId: number;
  marketTitle: string;
}

const ms = (iso: string | null): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

/**
 * The milestone this person is standing on, if they crossed it recently.
 *
 * At most one per person: a reader meeting Sarah does not need to be told she
 * passed three and then five. The count she is on now is the whole story.
 */
export function convictionMilestone(
  person: Person,
  window: { sinceMs: number; nowMs: number },
): PersonMilestone | null {
  const dated = person.convictions
    .map((c) => ({ ...c, at: ms(c.startedAt) }))
    .filter((c) => Number.isFinite(c.at));
  // A conviction we cannot date cannot be counted: including it would inflate
  // the count while the crossing instant came from a different belief.
  if (dated.length !== person.convictions.length) return null;

  const rung = CONVICTION_RUNGS.find((r) => r === dated.length);
  if (rung == null) return null;

  // The newest belief is the one that made the count true.
  const newest = dated.reduce((a, b) => (b.at > a.at ? b : a));
  if (newest.at < window.sinceMs || newest.at > window.nowMs) return null;

  return {
    id: `person:${person.wallet.toLowerCase()}:convictions:${rung}:${newest.marketId}`,
    wallet: person.wallet.toLowerCase(),
    name: person.name,
    rung,
    occurredAt: new Date(newest.at).toISOString(),
    marketId: newest.marketId,
    marketTitle: newest.title,
  };
}

/** Every person's current milestone, newest first. */
export function convictionMilestones(
  people: readonly Person[],
  window: { sinceMs: number; nowMs: number },
): PersonMilestone[] {
  const out: PersonMilestone[] = [];
  for (const p of people) {
    const m = convictionMilestone(p, window);
    if (m) out.push(m);
  }
  return out.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}

/**
 * The sentence. Present tense and about the person, because that is the part
 * the market rows cannot say.
 */
export function tellConvictionMilestone(m: PersonMilestone): {
  headline: string;
  body: string;
  attribution: string;
} {
  return {
    headline: "CONVICTIONS",
    body: `${m.name} now backs ${m.rung} questions.`,
    attribution: `The ${ordinal(m.rung)} is “${m.marketTitle}”.`,
  };
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
