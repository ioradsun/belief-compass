/**
 * SHARED CONVICTION — who from your network is here, and which way they went.
 *
 * WHAT CHANGED. This line used to be deliberately side-blind: "Your Twin is in
 * this market", never which side. The stated reason was that the viewer had not
 * decided yet, so revealing a Twin's side might make them copy it instead of
 * forming their own belief.
 *
 * That reason does not survive contact with the rest of the product. Every
 * position is public on-chain and readable one tap away in the Case File, so
 * the line was not protecting information — it was making the ONE surface that
 * mentions your people the only one that would not tell you anything about
 * them. The believers query already carried each person's side; this component
 * loaded it and threw it away.
 *
 * WHAT IS STILL NOT SAID, and why it is not a privacy rule either:
 *
 *   AMOUNTS. "Your Twin is on YES with $12,000" makes the sentence about the
 *   size of a bet. Belonging is about presence and direction; the number lives
 *   in the Case File where a reader has gone looking for it.
 *
 *   AGREEMENT. Never "your Twin agrees with you" — the viewer may not have
 *   decided, and framing a stranger's belief as a verdict on the reader's is
 *   the one thing that really would invite copying.
 *
 * A SPLIT IS THE BETTER STORY. When the reader's own people disagree, saying so
 * is more useful than picking whichever side has more of them — and it is the
 * only version of this line that cannot be read as a nudge.
 *
 * ZERO IO, pure, fully testable.
 */

export type Side = "YES" | "NO";

/** One person from the viewer's network holding a side in this market. */
export interface PresentPerson {
  wallet: string;
  relationship: "twin" | "tribe" | "opp" | "inverse";
  /** Which side they hold. Null when the position is known but the side is not. */
  side: Side | null;
}

/**
 * The one line. Strongest relationship first — a Twin outranks a group, because
 * "the person who thinks most like you" is a stronger reason to look than three
 * people who merely lean your way.
 */
export function sharedConvictionLine(people: readonly PresentPerson[]): string | null {
  if (people.length === 0) return null;

  const twin = people.find((p) => p.relationship === "twin");
  const tribe = people.filter((p) => p.relationship === "tribe" || p.relationship === "twin");
  const rival = people.find((p) => p.relationship === "opp" || p.relationship === "inverse");

  if (twin) return twin.side ? `Your Twin is on ${twin.side}` : "Your Twin is in this market";
  if (tribe.length > 0) return groupLine(tribe, "your Tribe");
  if (rival)
    return rival.side ? `One of your Rivals is on ${rival.side}` : "One of your Rivals is here";
  return groupLine(people, "your circle");
}

/**
 * A group's line. One side when they agree, the split when they do not — and
 * bare presence when no side is known, which is the honest degradation rather
 * than a guess.
 */
function groupLine(group: readonly PresentPerson[], whose: string): string {
  const n = group.length;
  const person = n === 1 ? "person" : "people";
  const verb = n === 1 ? "is" : "are";
  const yes = group.filter((p) => p.side === "YES").length;
  const no = group.filter((p) => p.side === "NO").length;

  if (yes > 0 && no > 0) return `${n} ${person} from ${whose} ${verb} split here`;
  if (yes + no === n && yes + no > 0)
    return `${n} ${person} from ${whose} ${verb} on ${yes > 0 ? "YES" : "NO"}`;
  return `${n} ${person} from ${whose} ${verb} here`;
}
