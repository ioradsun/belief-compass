/**
 * VIEWER RELATIONSHIP — personalization as a read-time lens, never a stored fact.
 *
 * A relationship is not a property of an event. "Maya doubled down" happened
 * once, to everyone; "your Twin doubled down" is one reader's view of it. So the
 * cron keeps writing exactly ONE universal event, and this module applies the
 * viewer's own lens when that event is read:
 *
 *     universal event  →  listLiveEvents(viewer)  →  relationship join
 *                      →  viewer-relative significance  →  rendering
 *
 * The event's identity never moves. Same row, same fingerprint, same people, for
 * every reader — only which faces lead the stack, how much the row is worth to
 * this reader, and whether the copy may say "your Tribe".
 *
 * THE HONESTY RULE, which is the whole reason this module exists:
 *
 *   Two of fourteen holders being in your Tribe does NOT make it "your Tribe is
 *   holding". `describeCohort` will only make a whole-group claim when the whole
 *   group qualifies; otherwise it names the subset precisely —
 *   "Jon, Kate, and four people from your Tribe reached 30 days" — or says
 *   nothing personal at all. Overstating a relationship is the fastest way to
 *   make personalization feel like a trick.
 *
 * Anonymous readers are not a degraded case. With no relationship data every
 * function here returns the universal result unchanged, and the ordering stays
 * deterministic so the feed is identical for every signed-out visitor.
 *
 * ZERO IO, pure, fully testable.
 */
import type { NetworkLabel } from "@/domain/story";
import type { CohortHolder } from "@/domain/conviction-cohort";

/** The viewer's relationship map: wallet (lowercased) → label. */
export type RelationshipMap = ReadonlyMap<string, NetworkLabel>;

/**
 * How much each relationship is worth. Bounded on purpose: the maximum boost is
 * smaller than the gap between a routine event and a major one, so a Twin's
 * ordinary buy can never outrank the biggest believer walking away.
 */
export const RELATIONSHIP_WEIGHT: Record<NetworkLabel, number> = {
  twin: 1,
  tribe: 0.75,
  opp: 0.7,
  inverse: 0.5,
};

/** The most personalization can ever add to a score. */
export const MAX_RELATIONSHIP_BOOST = 0.15;

/** Attach the viewer's labels to a group. Returns a NEW array; input untouched. */
export function enrichPeople(people: CohortHolder[], rel: RelationshipMap | null): CohortHolder[] {
  if (!rel || rel.size === 0) return people;
  return people.map((p) => {
    const label = rel.get(p.wallet.toLowerCase());
    return label ? { ...p, relationship: label } : p;
  });
}

/**
 * The viewer-relative bump for an event. Bounded, and driven by the STRONGEST
 * relationship present rather than the count — five tribe members is not five
 * times more relevant than one, and treating it that way would turn the feed
 * into a list of whoever the viewer happens to follow.
 */
export function relationshipBoost(people: CohortHolder[]): number {
  let best = 0;
  for (const p of people) {
    if (!p.relationship) continue;
    best = Math.max(best, RELATIONSHIP_WEIGHT[p.relationship]);
  }
  return best * MAX_RELATIONSHIP_BOOST;
}

/**
 * Who leads the face stack for THIS viewer. People they know come first,
 * because recognition is the point of showing faces at all — then the
 * event-internal ordering the cohort already established.
 *
 * This changes which faces are visible, never who is in the group: the overflow
 * count is computed from the same array, so it stays correct for every viewer.
 */
export function orderForViewer(people: CohortHolder[]): CohortHolder[] {
  return [...people].sort((a, b) => {
    const w = (p: CohortHolder) => (p.relationship ? RELATIONSHIP_WEIGHT[p.relationship] : 0);
    return (
      w(b) - w(a) ||
      b.daysHeld - a.daysHeld ||
      b.positionUsd - a.positionUsd ||
      a.wallet.localeCompare(b.wallet)
    );
  });
}

export interface CohortDescription {
  /** True only when the group may honestly be described in relationship terms. */
  personal: boolean;
  /** How many of the group are people the viewer knows. */
  knownCount: number;
  /** The strongest relationship present, or null. */
  lead: NetworkLabel | null;
  /** Whether EVERY counted member qualifies — the bar for a whole-group claim. */
  whole: boolean;
}

/** Relationships that count as "your people" for group copy. Rivals are not. */
const KINSHIP: NetworkLabel[] = ["twin", "tribe"];

/**
 * Can this group honestly be called the viewer's people, and how much of it is?
 *
 * `whole` is what gates a sentence like "Your Tribe is holding". Anything less
 * and the caller must name the subset instead. `knownCount` is what makes that
 * precise phrasing possible.
 */
export function describeCohort(people: CohortHolder[]): CohortDescription {
  const known = people.filter((p) => p.relationship && KINSHIP.includes(p.relationship));
  if (known.length === 0) return { personal: false, knownCount: 0, lead: null, whole: false };
  const lead = known.reduce<NetworkLabel>(
    (best, p) =>
      RELATIONSHIP_WEIGHT[p.relationship as NetworkLabel] > RELATIONSHIP_WEIGHT[best]
        ? (p.relationship as NetworkLabel)
        : best,
    known[0].relationship as NetworkLabel,
  );
  return {
    personal: true,
    knownCount: known.length,
    lead,
    whole: known.length === people.length,
  };
}

/**
 * The relationship clause for a group sentence, or null when there is nothing
 * honest to say. Never claims more of the group than actually qualifies.
 *
 *   whole group    → "your Tribe"
 *   part of it     → "four people from your Tribe"
 *   none / anon    → null
 */
export function relationshipClause(desc: CohortDescription): string | null {
  if (!desc.personal || !desc.lead) return null;
  const noun = desc.lead === "twin" ? "your closest matches" : "your Tribe";
  if (desc.whole) return noun;
  const n = desc.knownCount;
  return `${n} ${n === 1 ? "person" : "people"} from ${desc.lead === "twin" ? "your closest matches" : "your Tribe"}`;
}
