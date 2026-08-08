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
 * TWO CLAUSES, COMBINED. Rather than one long list of sentences, a line is an
 * ACT ("what they did") plus a PULL ("why that involves you"):
 *
 *     Sarah is already in on YES.  ·  You've landed together 9 of 11 times.
 *     Mike asked this.             ·  You two rarely land the same way.
 *
 * Four acts against four or five pulls per segment gives roughly forty distinct
 * lines from a dozen fragments, and every pairing is grammatical because the act
 * always names the caller and the pull never does — it addresses the reader or
 * describes the pair. No pronouns anywhere either: a name does not tell you
 * somebody's pronouns, and "they" reads oddly beside a single named person.
 *
 * WHERE THE PULL COMES FROM, and this is the part that could not exist before.
 * Conviction Match is now on the Challenge payload, so the line can say the one
 * thing that actually makes a call urgent — what is at stake between these two
 * people specifically. "This could be the one you split on" is only sayable to
 * someone who agrees with the caller almost always. "And still wants your read"
 * is only sayable to someone who almost never does.
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
import type { CallerRelation } from "@/domain/challenge";

export interface CallLineInput {
  /** Display name. Empty means no line at all — the row does not exist. */
  name: string;
  relation: CallerRelation;
  act: "trade" | "market_created";
  /** The side they took. Null for a creation. */
  side: "YES" | "NO" | null;
  /** Same-side count and shared total, when the pair has enough history. */
  together?: number | null;
  shared?: number | null;
  /** Stable seed — the market and caller this call is about. */
  marketId: number;
  callerWallet: string;
}

/** Twin and Tribe land with you; Rival and Opp land apart. */
const ALIGNED: ReadonlySet<CallerRelation> = new Set(["twin", "tribe"]);

/**
 * The evidence bar for a pull clause that quotes the record.
 *
 * Deliberately the same five that gates every other earned statement in this
 * product. Below it the pull clauses fall back to the ones that need no history,
 * rather than quoting "1 of 1" as though it meant something.
 */
const MIN_SHARED_FOR_RECORD = 5;

/** What they did. Always literally true, never softened. */
const ACTS = {
  trade: [
    (n: string, s: string) => `${n} took ${s}.`,
    (n: string, s: string) => `${n} is already in on ${s}.`,
    (n: string, s: string) => `${n} backed ${s}.`,
    (n: string, s: string) => `${n} went ${s}.`,
  ],
  created: [
    (n: string) => `${n} asked this.`,
    (n: string) => `${n} opened this question.`,
    (n: string) => `${n} put this one up.`,
    (n: string) => `${n} wrote this question.`,
  ],
} as const;

/**
 * Why it involves you. Four pools, and which one applies is a fact about the
 * pair rather than a tone the copy chose.
 */
const PULLS = {
  /** You usually land together, and there is a record to quote. */
  alignedRecord: [
    (t: number, s: number) => `You've landed together ${t} of ${s} times.`,
    () => `This could be the one you split on.`,
    () => `You two usually land the same way.`,
    (t: number, s: number) => `${t} of ${s} together so far — your call.`,
    () => `Waiting on your read.`,
  ],
  /** You usually land together, but the record is too thin to quote. */
  alignedThin: [
    () => `Your call.`,
    () => `Waiting on your read.`,
    () => `What do you think?`,
    () => `Where do you land?`,
  ],
  /** You usually land apart, and there is a record to quote. */
  opposedRecord: [
    () => `Your read is the one being asked for.`,
    () => `You two rarely land the same way.`,
    () => `Agreeing here would be new.`,
    (t: number, s: number) => `You've landed together ${t} of ${s} times — and here you are.`,
    () => `Different conclusions, same question.`,
  ],
  /** You usually land apart, thin record. */
  opposedThin: [
    () => `Your read is the one being asked for.`,
    () => `Your call.`,
    () => `What do you think?`,
    () => `Different conclusions, same question.`,
  ],
} as const;

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

  const together = Number.isFinite(e.together as number) ? (e.together as number) : null;
  const shared = Number.isFinite(e.shared as number) ? (e.shared as number) : null;
  // A record is quotable only when both counts are present, reconcilable and
  // deep enough. `together > shared` would be a broken payload, not a fact.
  const hasRecord =
    together != null &&
    shared != null &&
    shared >= MIN_SHARED_FOR_RECORD &&
    together >= 0 &&
    together <= shared;

  const aligned = ALIGNED.has(e.relation);
  const pool = hasRecord
    ? aligned
      ? PULLS.alignedRecord
      : PULLS.opposedRecord
    : aligned
      ? PULLS.alignedThin
      : PULLS.opposedThin;

  // The pull NEVER re-names the caller: the act clause just did, and "Sarah took
  // YES. Sarah is waiting on your read." reads like a bug. Every pull addresses
  // the reader or describes the pair instead.
  const pull = pool[hPull % pool.length](together ?? 0, shared ?? 0);
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
