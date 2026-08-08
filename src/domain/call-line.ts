/**
 * THE LINE THAT MAKES A CALL FEEL LIKE A CALL.
 *
 * Every Challenge used to read one of two sentences:
 *
 *     Sarah, your Tribe, took YES. What's your call?
 *     Mike, your Rival, asked this. What's your call?
 *
 * Six open Challenges meant six near-identical rows, and identical rows are
 * scannable in the worst sense — the eye stops reading them. A call from a Twin
 * you agree with nine times out of eleven and a call from a Rival you almost
 * never agree with are completely different social events, and they were being
 * narrated in the same words.
 *
 * TWO CLAUSES, COMBINED. Rather than one long list of sentences, a line is a
 * BELIEF ("what they hold") plus a PULL ("why that involves you"):
 *
 *     Sarah believes YES.      ·  This could be the one you split on.
 *     Mike's read is NO.       ·  You two rarely land the same way.
 *
 * Four beliefs against five or six pulls per segment gives roughly forty distinct
 * lines from a dozen fragments, and every pairing is grammatical because the
 * belief always names the caller and the pull never does — it addresses the
 * reader or describes the pair. No pronouns anywhere either: a name does not tell
 * you somebody's pronouns, and "they" reads oddly beside a single named person.
 *
 * BELIEF, NOT TRANSACTION. The first clause used to read "Sarah took YES", and
 * `took` describes what happened at the contract. Challenge is not a receipt —
 * it is one person's conviction arriving at another — so the clause names what
 * Sarah HOLDS, which is the thing the reader is being asked to answer.
 *
 * WHERE THE PULL COMES FROM, and this is the part that could not exist before.
 * Conviction Match is now on the Challenge payload, so the line can say the one
 * thing that actually makes a call urgent — what is at stake between these two
 * people specifically. "This could be the one you split on" is only sayable to
 * someone who agrees with the caller almost always. "Agreeing here would be new"
 * is only sayable to someone who almost never does.
 *
 * THE PULL NEVER QUOTES THE COUNT. The card prints "82% Conviction Match · 9 of
 * 11 together" on its own line directly beneath, so a pull that also said "You've
 * landed together 9 of 11 times" printed the same numbers twice, one line apart.
 * The evidence line owns the arithmetic; this clause owns what it means.
 *
 * EVERY FRAGMENT IS A FACT. Nothing here claims a market is closing, that anyone
 * is running out of time, that others have answered, or that the reader is
 * missing out on a result. The pull is real social weight — a specific person
 * moved, and the shared record between the two of you is on the table — because
 * manufactured urgency is the one thing that would make this surface worth
 * ignoring within a week.
 *
 * AND IT NEVER TAUNTS. A Rival is somebody who reaches different conclusions,
 * not an opponent to defeat. Nothing here says beat, prove, wrong, or win —
 * asserted by test, because that register is easy to drift into and impossible
 * to walk back once shipped.
 *
 * DETERMINISTIC. The line is chosen by hashing the market and the caller, so a
 * given call always reads the same. A sentence that reshuffled on every poll
 * would look broken, and worse, would make the surface feel generated.
 *
 * ZERO IO, pure, fully testable.
 */

/**
 * WHAT THE LINE IS ALLOWED TO KNOW — and the omissions are the design.
 *
 * `relation`, `together` and `shared` were all inputs here and are all gone. Not
 * because they were unused after the pull pools collapsed, but because a sentence
 * that CANNOT SEE the relationship cannot accidentally start arguing about it.
 * Side-blindness stops being a rule somebody has to remember and becomes a fact
 * about the type: there is no channel through which Tribe-ness or Rival-ness
 * could reach this copy.
 *
 * The relationship still reaches the reader — as the badge and the Conviction
 * Match line on the card, where it is a measured fact rather than a nudge.
 */
export interface CallLineInput {
  /** Display name. Empty means no line at all — the row does not exist. */
  name: string;
  act: "trade" | "market_created";
  /** The side they took. Null for a creation. Stated, never argued with. */
  side: "YES" | "NO" | null;
  /** Stable seed — the market and caller this call is about. */
  marketId: number;
  callerWallet: string;
}

/**
 * WHAT THEY BELIEVE — not what they transacted.
 *
 * These verbs used to be `took`, `backed`, `went`, `is already in on`: all four
 * describe a trade. But a Challenge is not a notification that somebody spent
 * money, it is one person's conviction reaching another, and "Sarah believes YES"
 * describes the PERSON where "Sarah took YES" describes the transaction. The card
 * reads person → belief → relationship evidence, and this clause is the belief.
 *
 * Every variant here is belief-framed for that reason; `believes` is the plain
 * form and the others are the same statement in this product's own vocabulary.
 */
const ACTS = {
  trade: [
    (n: string, s: string) => `${n} believes ${s}.`,
    (n: string, s: string) => `${n}'s read is ${s}.`,
    (n: string, s: string) => `${n} stands on ${s}.`,
    (n: string, s: string) => `${n} is convinced it's ${s}.`,
  ],
  created: [
    (n: string) => `${n} asked this.`,
    (n: string) => `${n} wants to know.`,
    (n: string) => `${n} opened this question.`,
    (n: string) => `${n} put this one up.`,
  ],
} as const;

/**
 * WHY IT INVOLVES YOU — and it is never about agreeing.
 *
 * These clauses used to argue agreement in both directions: "This could be the
 * one you split on" to a Tribe member, "Agreeing here would be new" to a Rival.
 * Both framed a Challenge as a question about whether two people match, and that
 * is the wrong question — it made the caller sound like they wanted a particular
 * answer, and it quietly implied that the same answer was the good outcome.
 *
 * A Challenge means one thing: I SAW THIS, AND I WANT TO KNOW WHERE YOU LAND.
 * Answering YES and answering NO satisfy it identically, so nothing here may hint
 * otherwise. Disagreement is not a failure of the mechanism — it is one of the two
 * results that make the relationship legible, and the more interesting one.
 *
 * WHAT CHALLENGE IS ACTUALLY FOR: creating another shared market. Conviction Match
 * reads how the two of you answered it afterwards; Tribe and Rival describe the
 * pattern across all of them. Three separate jobs, and this clause only has the
 * first one — which is why the pools no longer split on relation at all. The
 * caller's relationship shows in the badge and the match line, where it is a
 * measured fact rather than a nudge.
 */
const PULLS: readonly (() => string)[] = [
  () => `Take this one.`,
  () => `Where do you land?`,
  () => `Waiting on your read.`,
  () => `Your call.`,
  () => `What do you think?`,
  () => `Your read is the one missing.`,
  () => `Take it and we will both know.`,
  () => `Say where you land.`,
] as const;

/**
 * FNV-1a over the pair. Small, stable, and dependency-free — the only property
 * that matters is that the same call picks the same fragments forever.
 */
function seed(marketId: number, wallet: string, salt: string): number {
  let h = 0x811c9dc5;
  const s = `${salt}:${marketId}:${wallet.toLowerCase()}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // FNV-1a's LOW bits are its weakest, and `h % 4` reads exactly those — which
  // is why one person's calls all opened with the same verb across four
  // different markets. A final avalanche step mixes the high bits down.
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * The call, in one or two sentences — or null when it cannot be stated.
 *
 * The refusal is inherited from `reasonFor` and is the rule the whole surface
 * rests on: a row may exist only if the system can say why THIS person. No
 * fallback string anywhere, so an unnameable caller produces no card at all
 * rather than "someone took a side".
 */
export function callLine(e: CallLineInput): string | null {
  const name = e.name.trim();
  if (!name) return null;

  const created = e.act === "market_created";
  // A trade whose side we cannot name is not answerable — we would be quoting
  // somebody as having done something we cannot describe.
  if (!created && e.side !== "YES" && e.side !== "NO") return null;

  // Two SEPARATE hashes rather than two slices of one, so the act and the pull
  // are genuinely independent — sharing a draw locks them together and two
  // calls from the same person start to rhyme.
  const hAct = seed(e.marketId, e.callerWallet, "act");
  const hPull = seed(e.marketId, e.callerWallet, "pull");
  const acts = created ? ACTS.created : ACTS.trade;
  const act = acts[hAct % acts.length](name, e.side ?? "");

  // The pull NEVER re-names the caller: the belief clause just did, and "Sarah
  // believes YES. Sarah is waiting on your read." reads like a bug. Every pull
  // addresses the reader or describes the pair instead.
  const pull = PULLS[hPull % PULLS.length]();
  return `${act} ${pull}`;
}

/**
 * Words this surface must never use.
 *
 * A Rival reaches different conclusions; they are not an opponent to defeat, and
 * a call is an opportunity to show up rather than a contest. The urgency words
 * are here for a different reason: this product has no closing bell, no streak
 * and no expiry a reader can see, so any of them would be inventing pressure
 * that does not exist.
 */
export const CALL_LINE_BANNED: readonly string[] = [
  "beat",
  "defeat",
  "prove",
  "wrong",
  "win",
  "lose",
  "against you",
  "challenge accepted",
  "hurry",
  "last chance",
  "running out",
  "don't miss",
  "expires",
  "act now",
];
