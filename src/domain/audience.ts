/**
 * WHO A CHALLENGE MAY REACH — the shape, the grouping, and the precedence.
 *
 * TWO CONCEPTS THAT WERE ONE, SEPARATED HERE. `relation_at_call` is what the DNA
 * engine believed at the moment somebody was asked; it is frozen forever and it
 * is relationship TRUTH. "Still Forming" is a heading on a screen. Storing the
 * heading would make presentation copy permanent — and the day the grouping was
 * renamed, every historical row would be lying about what the engine actually
 * knew. So a call remembers `neutral` or `insufficient`, and the group is
 * derived from it every time it is rendered.
 *
 * STILL FORMING MEANS THERE IS REAL EVIDENCE OF A CONNECTION AND NOT ENOUGH TO
 * NAME IT. It must never come to mean "we needed more recipients, so we found
 * some wallets." Exactly three provenances qualify, and each one is a fact the
 * canonical graph can already explain:
 *
 *   neutral_dna        the engine evaluated this pair and found no strong
 *                      alignment either way. It looked, and it has an answer.
 *   closest_match      at least one shared directional belief — the graceful
 *                      fallback the DNA system already defines for a thin
 *                      network, bounded and canonical. Zero shared beliefs is
 *                      not a thin relationship, it is no relationship.
 *   answered_challenge one of them asked and the other actually answered. This
 *                      is the case DNA cannot see: a Market Maker who never
 *                      held a side shares no directional belief with anybody
 *                      who answered them, yet something unmistakably happened.
 *
 * AND FOLLOWS ARE NOT ONE OF THEM. `setFollow` accepts the claimed follower
 * wallet without proving control of it, which is survivable for a lightweight
 * public preference and is NOT survivable when a row would place a social
 * obligation on somebody else's screen. A forged follow would manufacture an
 * audience seat. When follow writes prove authorship, a verified mutual follow
 * becomes arguable — "the challenger follows them" never will, because it
 * proves the challenger is interested rather than that the recipient expects
 * to be called.
 *
 * ZERO IO, pure, fully testable.
 */

/**
 * What the DNA engine believed when the call was made. Frozen, never updated,
 * and now six values rather than four — see the 20260907 migration for why the
 * database had to learn the two new ones before this could exist at all.
 */
export type CallRelationAtTime = "twin" | "tribe" | "neutral" | "opp" | "inverse" | "insufficient";

/** What a reader sees. Three headings, derived — never stored. */
export type AudienceGroup = "tribe" | "rivals" | "forming";

/** Why this person is in the audience at all. Every one is checkable. */
export type AudienceProvenance =
  | "strong_dna"
  | "neutral_dna"
  | "closest_match"
  | "answered_challenge";

export function audienceGroupFor(relation: CallRelationAtTime): AudienceGroup {
  switch (relation) {
    case "twin":
    case "tribe":
      return "tribe";
    case "opp":
    case "inverse":
      return "rivals";
    case "neutral":
    case "insufficient":
      return "forming";
    default: {
      const never: never = relation;
      throw new Error(`unhandled relation: ${String(never)}`);
    }
  }
}

export interface AudienceMember {
  wallet: string;
  relationAtCall: CallRelationAtTime;
  group: AudienceGroup;
  provenance: AudienceProvenance;
  sharedBeliefs: number | null;
  sameSideBeliefs: number | null;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * WHICH FACT SURVIVES WHEN SEVERAL DESCRIBE THE SAME PERSON.
 *
 * NOT A RANKING OF HUMAN VALUE. A Rival is not worth less than a Twin — the
 * whole product argues the opposite. This decides only which canonical fact is
 * the STRONGEST DESCRIPTION when a wallet arrives through more than one door,
 * so `relation_at_call` freezes the most specific thing the engine knew rather
 * than whichever source happened to be read last.
 */
const PRECEDENCE: Record<CallRelationAtTime, number> = {
  twin: 6,
  tribe: 5,
  inverse: 4,
  opp: 3,
  neutral: 2,
  insufficient: 1,
};

/**
 * Within `insufficient`, a closest match outranks history alone: a shared
 * directional belief is a stronger statement about two people than the fact
 * that one of them once answered the other.
 */
const PROVENANCE_RANK: Record<AudienceProvenance, number> = {
  strong_dna: 4,
  neutral_dna: 3,
  closest_match: 2,
  answered_challenge: 1,
};

/**
 * One wallet, once — keeping the strongest canonical fact about them.
 *
 * Order of arrival is deliberately irrelevant. A dedupe that kept whichever
 * source was read first would make `relation_at_call` depend on query ordering,
 * which is exactly the kind of thing that is correct until somebody
 * parallelises the reads.
 */
export function dedupeAudience(members: readonly AudienceMember[]): AudienceMember[] {
  const best = new Map<string, AudienceMember>();
  for (const m of members) {
    const key = m.wallet.toLowerCase();
    const prev = best.get(key);
    if (
      !prev ||
      PRECEDENCE[m.relationAtCall] > PRECEDENCE[prev.relationAtCall] ||
      (PRECEDENCE[m.relationAtCall] === PRECEDENCE[prev.relationAtCall] &&
        PROVENANCE_RANK[m.provenance] > PROVENANCE_RANK[prev.provenance])
    ) {
      best.set(key, { ...m, wallet: key });
    }
  }
  return [...best.values()];
}

/** How many faces a group shows before it starts counting. */
export const FACES_PER_GROUP = 5;

export interface AudienceGroupView {
  key: AudienceGroup;
  label: string;
  /** One short line. Never a promise about where the relationship will land. */
  note: string;
  count: number;
  visiblePeople: AudienceMember[];
  overflow: number;
}

/**
 * THE TRIBE HEADING NAMES A TWIN WHEN THERE IS ONE.
 *
 * "Your Twin + Tribe" is not decoration: a Twin is the rarest thing the engine
 * produces, and folding them into a plural erases the one person the reader is
 * most likely to care about.
 */
function tribeLabel(people: readonly AudienceMember[]): string {
  const hasTwin = people.some((p) => p.relationAtCall === "twin");
  const others = people.some((p) => p.relationAtCall === "tribe");
  if (hasTwin && others) return "Your Twin + Tribe";
  if (hasTwin) return "Your Twin";
  return "Your Tribe";
}

const NOTE: Record<AudienceGroup, string> = {
  tribe: "Do your people see it too?",
  rivals: "Will the divide hold?",
  /**
   * NOT "close to your Tribe", and not "two answers away". The canonical model
   * exposes no boundary distance, so any sentence implying one is a
   * counterfactual nothing can compute. This says what is true: an answer would
   * tell us more than we currently know.
   */
  forming: "This answer could reveal the pattern.",
};

/**
 * Groups, in a fixed order, with empty ones absent entirely.
 *
 * A heading over nothing is the software pointing at a category the reader does
 * not have, which on a cold-start network is most of them.
 */
export function groupAudience(members: readonly AudienceMember[]): AudienceGroupView[] {
  const order: AudienceGroup[] = ["tribe", "rivals", "forming"];
  const out: AudienceGroupView[] = [];
  for (const key of order) {
    const people = members.filter((m) => m.group === key);
    if (people.length === 0) continue;
    out.push({
      key,
      label:
        key === "tribe" ? tribeLabel(people) : key === "rivals" ? "Your Rivals" : "Still Forming",
      note: NOTE[key],
      count: people.length,
      visiblePeople: people.slice(0, FACES_PER_GROUP),
      overflow: Math.max(0, people.length - FACES_PER_GROUP),
    });
  }
  return out;
}

/**
 * THE ONE NAME A CTA MAY USE, and only when there is exactly one person.
 *
 * Returned from the AUDIENCE rather than assembled by a caller, because the
 * label used to read the person who challenged the VIEWER — a different human,
 * printed on a button that then contacts somebody else. An untrustworthy name
 * (blank, or an unresolved profile) yields null and the button says "them".
 */
export function singleRecipientName(members: readonly AudienceMember[]): string | null {
  if (members.length !== 1) return null;
  const only = members[0]?.displayName?.trim();
  return only ? only : null;
}

/**
 * WHAT THE AUDIENCE READ CAME BACK AS.
 *
 * FAILURE IS NOT AN EMPTY AUDIENCE AND IT IS NOT PERMISSION. The rule the
 * foundation states — unknown is not zero — cuts both ways, and the second
 * direction was got wrong once already: an INCLUSION read that fails must not
 * become "nobody qualifies", and an EXCLUSION read that fails must not become
 * "everybody is fair game". A failed participant query does not lose one
 * exclusion, it loses ALL of them, which would put a Challenge in front of every
 * person who had already answered the market.
 *
 * So a failed exclusion is a failed AUDIENCE. The preview hides the module, the
 * write refuses, no slot is spent, and nobody receives a call the server could
 * not verify they were owed.
 */
export type AudienceFailure =
  | "dna_unavailable"
  | "participants_unavailable"
  | "calls_unavailable"
  | "market_unavailable";

export interface AvailableAudience {
  status: "available";
  total: number;
  singleRecipientName: string | null;
  members: AudienceMember[];
  groups: AudienceGroupView[];
}

export type AudienceResult =
  | AvailableAudience
  | { status: "none" }
  | { status: "loading" }
  | { status: "failed"; reason: AudienceFailure };

/** Assemble the payload once membership is settled. Presentation only. */
export function presentAudience(members: readonly AudienceMember[]): AudienceResult {
  const unique = dedupeAudience(members);
  if (unique.length === 0) return { status: "none" };
  return {
    status: "available",
    total: unique.length,
    singleRecipientName: singleRecipientName(unique),
    members: unique,
    groups: groupAudience(unique),
  };
}

/**
 * A COLD START HAS NO AUDIENCE, AND THAT IS THE HONEST STATE.
 *
 * The temptation this sentence exists to refuse: filling Still Forming with
 * active strangers, market participants, other people's followers or
 * category-adjacent wallets so the screen looks populated. That would make a
 * stranger appear socially connected, which is the one thing an audience must
 * never do — the whole surface is worth nothing the moment somebody suspects
 * the faces are filler. Cold start is fixed by answering questions, not by
 * redefining who counts as known.
 */
export const COLD_START_HEADLINE = "The map is still forming";
export const COLD_START_SUPPORT =
  "These people have started crossing paths with you. Another real answer can make the pattern clearer.";
