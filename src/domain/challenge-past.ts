/**
 * PAST CHALLENGES — what happened with the questions I put on the table.
 *
 * THE PRODUCT DISTINCTION THIS MODULE EXISTS TO HOLD:
 *
 *   CURRENT   the live social loop — a question waiting on me, one of mine still
 *             gathering answers, a chain still moving. It lives on the rail,
 *             where a reader ACTS. See `isLiveCard`.
 *   PAST      the record of what already happened, reached on purpose. This is
 *             that record, and it answers ONE question: "what happened with the
 *             challenges I made?" — never "what should I do now".
 *
 * ONE EVENT, ONE ITEM — THE ANTI-INBOX RULE, and the whole reason this is grouped
 * by Challenge rather than by recipient. Putting a question in front of thirty
 * people is ONE thing I did, not thirty. A row per recipient turned a single act
 * into "WAITING ON A · WAITING ON B · WAITING ON C …" — thirty near-identical
 * lines that destroyed every scent of hierarchy and made a busy week read as
 * noise. A Challenge is the event; the recipients are participants in it, and the
 * meaningful number is six challenges, never a hundred and two call rows.
 *
 * SHOWING UP IS THE HEADLINE, AND IT IS SIDE-BLIND — the same invariant the rest
 * of the Challenge system is built on (`domain/dependability`, `domain/table`).
 * The fact this page celebrates is that people TURNED UP because I asked; whether
 * they agreed is a second, quieter thing. So `showedUpLine` counts answers and
 * says nothing about sides, and a Rival who answers every call reads as somebody
 * who showed up — not as a loss.
 *
 * AGREEMENT IS THE REVEAL, NOT THE SCORE. Once the headline has been stated, the
 * interesting thing a Challenge surfaced is what people's answers revealed — and
 * that is where the side comes in, in the product's own warm register: "backed
 * YES with you" for agreement, "went NO" for the other way. Never "against you"
 * (`CARD_BANNED_WORDS`), never a winner and a loser. Disagreement is somebody
 * showing up and holding their own conviction, which on this platform is the most
 * interesting relationship there is.
 *
 * NO NEGATIVE EVIDENCE, AND NOBODY IS NAMED FOR NOT SHOWING UP. A responder took a
 * public, on-chain position, so they are named and shown. Somebody who passed, or
 * who simply never answered, is COUNTED and never named — a timeline of who did
 * not turn up is the ledger of rejection this product refuses to keep, and the
 * silence of a call that aged out is not a decision anybody made. This is the one
 * place the storytelling brief is deliberately overruled: "Didn't respond · 12
 * [faces]" would name the absent, so the count stands alone with no faces behind
 * it.
 *
 * NOT A FEED. No scoring, no ranking, no admission rule, no "interesting enough".
 * The order is time and the contents are everything I did. The moment something
 * here decided what was worth showing, this would be the Insider tape with a
 * different heading, and Insider already answers "what is happening" one tab
 * across, for everybody.
 *
 * ZERO IO, pure, fully testable.
 */
import type { Side } from "@/domain/post-action";
import type { AudienceGroup } from "@/domain/audience";

/** The other side of a call. YES↔NO, and nothing else exists. */
export const otherSide = (s: Side): Side => (s === "YES" ? "NO" : "YES");

/**
 * ONE PERSON WHO SHOWED UP — named, because they took a public position.
 *
 * `side` is what they took AT ANSWER TIME (null on rows stamped before the side
 * was kept), and `group` is how they related to me WHEN I ASKED — frozen at the
 * call, so a relationship that changed later cannot rewrite what a Challenge
 * revealed. Passers and non-responders never become one of these: they are
 * counted on the event and never carried as a person.
 */
export interface PastResponder {
  wallet: string;
  name: string;
  avatarUrl: string | null;
  side: Side | null;
  group: AudienceGroup;
}

/**
 * THE RAW SHAPE THE SERVER ASSEMBLES — one per Challenge I put up, already past.
 *
 * "Past" means the loop is over: I took it down, or everyone answered. A Challenge
 * still gathering answers is CURRENT and belongs on the rail, so the server never
 * hands one here — the two surfaces read the same boundary so a card cannot land
 * in both.
 */
export interface PastChallengeInput {
  marketId: number;
  title: string;
  /**
   * WHAT I BACKED — the belief the Challenge was a test of. Null when I hold no
   * directional side in my own market (a question I put up without answering it),
   * in which case there is no "your side" for agreement to be measured against.
   */
  yourSide: Side | null;
  /** When this last had life: the most recent answer, else when I put it up. */
  atMs: number;
  closedAtMs: number | null;
  closeReason: "creator" | "all_responded" | null;
  /** Recipient OPPORTUNITIES the Challenge reached. The denominator, frozen. */
  reached: number;
  /** Waved off. Counted here, never named anywhere. */
  passed: number;
  /** Everyone who took a side. Named, with what they took and how they related. */
  responders: PastResponder[];
}

export type PastStatus = "completed" | "closed";

/**
 * THE RESOLVED EVENT — every derived count a card needs, computed once.
 *
 * `agreed` / `wentOtherWay` are null when I hold no side: with nothing to compare
 * against, agreement is not a fact this event can carry, and a zero there would
 * invent one. They count only responders whose side is known — a row stamped
 * before the side was kept is present in `showedUp` and absent from both, because
 * it is a real answer with an unknown direction.
 */
export interface PastChallenge extends PastChallengeInput {
  showedUp: number;
  /** Reached, still out — neither answered nor passed. Counted, never named. */
  waiting: number;
  agreed: number | null;
  wentOtherWay: number | null;
  /** Responders who were Tribe when I asked. The crowd a Tribe line needs. */
  tribeShowedUp: number;
  /** Of those Tribe responders, how many matched my side. Null with no side. */
  tribeAgreed: number | null;
  status: PastStatus;
}

const isSide = (v: Side | null): v is Side => v === "YES" || v === "NO";

/** Everything derived from one raw event, in one place, so no surface recounts. */
export function buildPastChallenge(input: PastChallengeInput): PastChallenge {
  const showedUp = input.responders.length;
  const waiting = Math.max(0, input.reached - showedUp - Math.max(0, input.passed));

  const withSide = input.responders.filter((r) => isSide(r.side));
  const agreed = isSide(input.yourSide)
    ? withSide.filter((r) => r.side === input.yourSide).length
    : null;
  const wentOtherWay = isSide(input.yourSide)
    ? withSide.filter((r) => r.side !== input.yourSide).length
    : null;

  const tribe = input.responders.filter((r) => r.group === "tribe");
  const tribeShowedUp = tribe.length;
  const tribeAgreed = isSide(input.yourSide)
    ? tribe.filter((r) => r.side === input.yourSide).length
    : null;

  /**
   * COMPLETED vs CLOSED, AND THE OUTCOME MATTERS MORE THAN EITHER. Everyone
   * answered → completed. Otherwise the Challenge was taken down with people
   * still out → closed. Deliberately NOT "expired" (a banned word, and untrue —
   * a window did not end, I ended it), and deliberately quiet: the brief's whole
   * point is that "12 of 18 showed up" is the story, and the system state is a
   * footnote.
   */
  const status: PastStatus =
    input.closeReason === "all_responded" || (input.reached > 0 && waiting === 0)
      ? "completed"
      : "closed";

  return {
    ...input,
    showedUp,
    waiting,
    agreed,
    wentOtherWay,
    tribeShowedUp,
    tribeAgreed,
    status,
  };
}

/* ── The lines a card says ────────────────────────────────────────────────── */

/**
 * THE HEADLINE FACT — side-blind, always. "18 of 30 showed up."
 *
 * "Showed up" rather than "responded" because it is the word the whole product
 * uses for this (`domain/table`, `domain/challenge-card`), and one interaction
 * must not be described two ways. Null when the Challenge reached nobody — there
 * is no denominator to state, and the completion voice handles that case.
 */
export function showedUpLine(pc: Pick<PastChallenge, "reached" | "showedUp">): string | null {
  if (pc.reached <= 0) return null;
  return `${pc.showedUp} of ${pc.reached} showed up`;
}

/**
 * THE REVEAL — what their answers surfaced, once, and only when there is one.
 *
 * The order of preference is the editorial: the rarer and more human the finding,
 * the higher it ranks. Everyone agreeing is a strong signal; a split is the
 * ordinary interesting case; with no side of my own the honest thing is the raw
 * split of what people took. Never "against you", never a tone that makes a
 * disagreer a loser — "went NO" is the same neutral clause a single card uses.
 */
export function discoveryLine(pc: PastChallenge): string | null {
  if (pc.showedUp === 0) return null;

  // No side of my own: I cannot claim agreement, so state the split I can see.
  if (!isSide(pc.yourSide)) {
    const yes = pc.responders.filter((r) => r.side === "YES").length;
    const no = pc.responders.filter((r) => r.side === "NO").length;
    if (yes + no === 0) return null;
    if (yes > 0 && no > 0) return `${yes} backed YES · ${no} backed NO`;
    return yes > 0 ? `${yes} backed YES` : `${no} backed NO`;
  }

  const agreed = pc.agreed ?? 0;
  const other = pc.wentOtherWay ?? 0;
  const away = otherSide(pc.yourSide);

  // Everyone who showed up landed on my side — the strongest reveal, and it needs
  // a crowd to mean anything, so a lone agreer is left to the plain split below.
  // `agreed === showedUp` guards against claiming "everyone" when a responder's
  // side was never recorded: they showed up, but not knowably with me.
  if (agreed >= 2 && agreed === pc.showedUp)
    return `Everyone who showed up backed ${pc.yourSide} with you`;
  if (agreed === 0 && other === 0) return null;

  const parts: string[] = [];
  if (agreed > 0) parts.push(`${agreed} backed ${pc.yourSide} with you`);
  if (other > 0) parts.push(`${other} went ${away}`);
  return parts.join(" · ");
}

/**
 * YOUR TRIBE, WHEN THERE WAS A TRIBE THERE — "Your Tribe: 8 of 9 with you".
 *
 * Held back below two Tribe responders and below a side of my own: one Tribe
 * answer is not a finding about a group, and "with you" cannot be said without a
 * side to be with. This is the line that makes the page feel like it is about the
 * reader's PEOPLE and not a spreadsheet.
 */
export function tribeLine(pc: PastChallenge): string | null {
  if (pc.tribeShowedUp < 2 || pc.tribeAgreed == null) return null;
  return `Your Tribe: ${pc.tribeAgreed} of ${pc.tribeShowedUp} with you`;
}

/**
 * THE ENDING, STATED ONCE AND WITHOUT SHAME — the past-tense support line.
 *
 * A quiet one carries no blame: a creator who asked and heard nothing is the most
 * likely person to walk away, and a card that reads as a scoreboard they lost is
 * how that happens. The question did not land, which is a fact about a question.
 * Mirrors `domain/table`'s finished voice so the two never disagree.
 */
export function completionSupport(pc: Pick<PastChallenge, "reached" | "showedUp">): string | null {
  if (pc.reached <= 0) return "Off the table.";
  if (pc.showedUp === 0) return "Quiet one. Not every question finds its people.";
  return null;
}

/** "Completed" / "Closed" — a small, subordinate chip. The outcome leads, not this. */
export function statusLabel(pc: Pick<PastChallenge, "status">): string {
  return pc.status === "completed" ? "Completed" : "Closed";
}

/* ── The orientation summary at the top of the page ───────────────────────── */

/**
 * A COMPACT PERSONAL SUMMARY — orientation and identity, never a dashboard.
 *
 * Four numbers, each of which helps a reader understand their own history: how
 * many questions they put up, how many answers those drew, the share that showed
 * up, and the share that landed on their side. Counted over CHALLENGES, so "6"
 * is the number of things I did — never the hundred-plus call rows underneath
 * them, which is an implementation artifact and not a fact about me.
 *
 * The two rates are null until the denominator exists: a percentage on nothing is
 * not a smaller fact, it is a fabricated one, and this page has spent enough of
 * this codebase's ink refusing the confident zero to start printing them now.
 */
export interface PastOverview {
  challenges: number;
  responses: number;
  /** Answers over opportunities, across every past Challenge. Null with none. */
  showedUpPct: number | null;
  /** Of answers with a known side, the share on my side. Null when unmeasurable. */
  agreedPct: number | null;
}

export function pastOverview(items: readonly PastChallenge[]): PastOverview {
  let reached = 0;
  let responses = 0;
  let decided = 0;
  let agreed = 0;
  for (const pc of items) {
    reached += Math.max(0, pc.reached);
    responses += pc.showedUp;
    // Agreement is only measurable where I held a side; elsewhere it is not a
    // missing number, it is a question that does not apply.
    if (pc.agreed != null && pc.wentOtherWay != null) {
      decided += pc.agreed + pc.wentOtherWay;
      agreed += pc.agreed;
    }
  }
  return {
    challenges: items.length,
    responses,
    showedUpPct: reached > 0 ? Math.round((responses / reached) * 100) : null,
    agreedPct: decided > 0 ? Math.round((agreed / decided) * 100) : null,
  };
}

/* ── Human chronological grouping ─────────────────────────────────────────── */

/**
 * THREE ERAS, NOT A DATE ON EVERY ROW. A chronological list's one question is
 * "how long ago" — and a heading answers it once for everything beneath it, where
 * a date per row is sixty things to read and compare. Empty eras are never shown:
 * a "This month" over nothing is the software pointing at a month in which the
 * reader mattered to nobody.
 *
 * The boundaries are rolling — 7 and 30 days from now, not "since the 1st" — so a
 * card does not jump eras because a calendar page turned.
 */
export type PastEraKey = "week" | "month" | "earlier";

export interface PastEra {
  key: PastEraKey;
  label: string;
  items: PastChallenge[];
}

const ERA_LABEL: Record<PastEraKey, string> = {
  week: "This week",
  month: "This month",
  earlier: "Earlier",
};

const DAY_MS = 86_400_000;

export function groupPast(items: readonly PastChallenge[], nowMs: number): PastEra[] {
  const buckets: Record<PastEraKey, PastChallenge[]> = { week: [], month: [], earlier: [] };
  for (const pc of items) {
    const age = nowMs - pc.atMs;
    // A row stamped slightly in the future (browser/db clock skew) belongs in the
    // newest era, not "Earlier" via a negative age.
    buckets[age < 7 * DAY_MS ? "week" : age < 30 * DAY_MS ? "month" : "earlier"].push(pc);
  }
  for (const key of Object.keys(buckets) as PastEraKey[])
    buckets[key].sort((a, b) => b.atMs - a.atMs || a.marketId - b.marketId);
  return (["week", "month", "earlier"] as const)
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: ERA_LABEL[k], items: buckets[k] }));
}

/* ── Where you showed up — the reciprocal, kept for completeness ───────────── */

/**
 * A CHALLENGE I ANSWERED — the other half of the record, and deliberately compact.
 *
 * This page's spine is the challenges I MADE; a question somebody else put up and
 * I answered is one line, "You showed up for Maya", not a story card. It is here
 * so the history stays complete — the reciprocal of "people show up for me" is
 * "people I show up for" — without competing with the events the summary counts.
 * Side-blind, like everything about showing up: I turned up, which is the fact.
 */
export interface ShowedUpEntry {
  marketId: number;
  title: string;
  /** The person who put the question up. Named — they asked in public. */
  who: string;
  wallet: string;
  atMs: number;
}

/** "You showed up for Maya" — the one sentence, matching the card vocabulary. */
export function showedUpForLine(entry: Pick<ShowedUpEntry, "who">): string {
  return `You showed up for ${entry.who}`;
}

/**
 * WORDS THIS PAGE MUST NEVER SAY — asserted across every string it can emit.
 *
 * Two families, both failures of the same kind. The adversarial ones would turn a
 * disagreer into an enemy, when a Rival who shows up is the best relationship here.
 * The administrative ones would make this an audit log or a game — the two things
 * the redesign exists to not be. "expired" is banned by `domain/table` too: a
 * window did not end, and saying so would misname a choice as a timeout.
 */
export const PAST_BANNED_WORDS: readonly string[] = [
  "against you",
  "declined",
  "rejected",
  "ignored",
  "expired",
  "lapsed",
  "streak",
  "score",
  "ranking",
  "leaderboard",
  "audit",
];

/** Every string a resolved event can say, for the banned-word gate to sweep. */
export function pastVocabulary(pc: PastChallenge): string {
  return [
    showedUpLine(pc),
    discoveryLine(pc),
    tribeLine(pc),
    completionSupport(pc),
    statusLabel(pc),
  ]
    .filter(Boolean)
    .join(" ");
}
