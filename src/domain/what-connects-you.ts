/**
 * WHAT CONNECTS YOU — the first thing on a profile, before anything about them.
 *
 * THE REORDERING THIS EXISTS FOR. Every version of this page so far opened by
 * explaining a stranger: here is who they are, here is what they back, here is
 * why they might matter. That order asks a visitor to become interested in
 * somebody they have no reason to care about yet, and then hands them
 * statistics as the argument.
 *
 * People do not become curious about strangers through statistics. They become
 * curious the moment they recognise a point of contact — which is why two
 * people who discover a shared birthday feel something, despite the fact
 * carrying no information at all. The feeling is not "this is significant", it
 * is "we have something in common", and everything afterwards is warmer for it.
 *
 * So: CONNECTION BEFORE EXPLANATION. The page now opens with the bridge, and
 * only then describes the person standing on the other side of it. The
 * recommendations, the convictions and the markets that follow all land
 * differently once a reader has had one moment of recognition.
 *
 * FIND THE BEST CONNECTION, NOT A COUNT. "Shared markets: 2" is the birthday
 * fact stripped of everything that made it feel like anything. "You both care
 * about technology, and they commit earlier than you do" is the same data
 * saying something a person would actually say.
 *
 * NEVER REPORT AN ABSENCE. "No shared markets" is technically true and
 * emotionally the worst sentence the page could open with. A reader with no
 * overlap is EARLY, not incompatible, and the copy says so — hopefully, and
 * without inventing a bond that is not there.
 *
 * WHAT IS NEVER CLAIMED. No compatibility score, no "you'd get along", no
 * personality. Every bond below is a fact about behaviour that both people can
 * check, and when there is no fact the section says the honest hopeful thing
 * rather than a flattering invented one.
 *
 * ZERO IO, pure, fully testable.
 */

export const CONNECT = {
  /** Shared markets before the overlap is a pattern rather than a coincidence. */
  minSharedForStrong: 4,
  /** Share of shared markets on opposite sides before the pair reads as opposed. */
  opposedShare: 0.5,
  /** Median holding times within this ratio of each other read as "about the same". */
  tenureSimilar: 1.35,
  /** Bonds shown. Three is a recognition; six is a report. */
  maxBonds: 3,
} as const;

export interface ConnectionInput {
  /** Markets both have taken a side in. */
  sharedMarkets: number;
  /** Of those, how many on the same side / on opposite sides. */
  together: number;
  apart: number;
  /** Topics the two most agree / disagree on, strongest first. */
  alignedTopics: readonly string[];
  opposedTopics: readonly string[];
  /** Topics each of them backs most, strongest first. Overlap is a bond by itself. */
  viewerTopics: readonly string[];
  personTopics: readonly string[];
  /** Median days each holds a position. Null when unknown. */
  viewerMedianDays: number | null;
  personMedianDays: number | null;
}

/**
 * The shape of the relationship. Drives the opening line and nothing else —
 * it is never rendered as a label, because "OPPOSED" over somebody's face is a
 * verdict and this section exists to do the opposite of that.
 */
export type ConnectionStrength = "strong" | "opposed" | "medium" | "new";

export interface WhatConnectsYou {
  strength: ConnectionStrength;
  /** The introduction a thoughtful friend would make. Always present. */
  opening: string;
  /** Specific, checkable bonds. Empty only when genuinely nothing is known. */
  bonds: string[];
  /** True when the two have not overlapped at all and the copy is forward-looking. */
  early: boolean;
}

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

/**
 * Topics are stored lowercase, which reads correctly mid-sentence for most of
 * them ("you both care about technology") and wrong for the acronyms — "you
 * both care about ai" looks like a typo in the first line a visitor reads.
 */
const TOPIC_LABEL: Record<string, string> = { ai: "AI", defi: "DeFi" };
const topicLabel = (t: string): string => TOPIC_LABEL[t.toLowerCase()] ?? t;

/** "technology" / "technology and culture" */
function joinNames(names: readonly string[]): string {
  const labelled = names.map(topicLabel);
  if (labelled.length <= 1) return labelled[0] ?? "";
  return `${labelled.slice(0, -1).join(", ")} and ${labelled[labelled.length - 1]}`;
}

/** "in both markets" / "in all 7 of the markets" — never "in all 2 of". */
function neverDisagreed(shared: number): string {
  if (shared === 1) return "You have taken the same side in the one market you have both entered.";
  if (shared === 2) return "You have taken the same side in both markets you have entered.";
  return `You have taken the same side in all ${shared} of the markets you have both entered.`;
}

function sharedCount(shared: number): string {
  return `You have both taken a side in ${shared} of the same market${shared === 1 ? "" : "s"}.`;
}

function strengthOf(i: ConnectionInput, sharedTopics: readonly string[]): ConnectionStrength {
  const shared = Math.max(0, Math.floor(i.sharedMarkets));
  if (shared === 0) return sharedTopics.length > 0 ? "medium" : "new";
  const apartShare = shared > 0 ? i.apart / shared : 0;
  if (shared >= CONNECT.minSharedForStrong && apartShare >= CONNECT.opposedShare) return "opposed";
  if (shared >= CONNECT.minSharedForStrong) return "strong";
  return "medium";
}

/**
 * The opening line, by shape of relationship.
 *
 * Written as introductions rather than summaries — the difference between "18
 * shared markets, 72% agreement" and "you have been asking many of the same
 * questions" is the difference between a readout and a person talking.
 */
function openingFor(strength: ConnectionStrength, name: string): string {
  switch (strength) {
    case "strong":
      return `You and ${name} have been asking many of the same questions.`;
    case "opposed":
      return "You often reach different conclusions — but on many of the same questions.";
    case "medium":
      return "You seem to be exploring similar ideas from different directions.";
    default:
      // NOT "no shared markets". A reader with no overlap is early, and the
      // sentence that greets them decides whether they keep reading.
      return "You have not crossed paths yet — every connection starts with one shared question.";
  }
}

/**
 * What connects the two of you, best bond first.
 *
 * Ordered by how much recognition each one carries, not by how much data sits
 * behind it: a shared topic lands harder than a market count, and how someone
 * holds their beliefs lands harder than how many they have.
 */
export function whatConnectsYou(i: ConnectionInput, personName = "they"): WhatConnectsYou {
  const shared = Math.max(0, Math.floor(i.sharedMarkets));
  const together = Math.max(0, Math.floor(i.together));

  // Topics they BOTH back, whether or not they have met in a market. This is
  // what lets someone with zero overlap still be handed something true.
  const theirs = new Set(i.personTopics.map((t) => t.toLowerCase()));
  const sharedTopics = i.viewerTopics.filter((t) => theirs.has(t.toLowerCase()));

  const strength = strengthOf(i, sharedTopics);
  const bonds: string[] = [];

  // 1 · AGREEMENT ON A TOPIC — the strongest recognition available, because it
  // is about what someone cares about rather than what they clicked.
  const aligned = i.alignedTopics.slice(0, 2);
  if (aligned.length > 0) {
    bonds.push(`You both care about ${joinNames(aligned)}.`);
  } else if (sharedTopics.length > 0) {
    bonds.push(`You are both drawn to ${joinNames(sharedTopics.slice(0, 2))}.`);
  }

  // 2 · THE MARKETS THEMSELVES. A count, but now it is evidence for a sentence
  // the reader has already felt rather than the opening claim.
  if (shared > 0) {
    bonds.push(together > 0 && together === shared ? neverDisagreed(shared) : sharedCount(shared));
  }

  // 3 · HOW THEY HOLD. A real difference between two people that no agreement
  // count can show, and the one bond that works with no overlap at all.
  const vm = n(i.viewerMedianDays);
  const pm = n(i.personMedianDays);
  if (vm > 0 && pm > 0) {
    const ratio = pm / vm;
    if (ratio >= CONNECT.tenureSimilar) {
      bonds.push(
        `${personName} tend${personName === "they" ? "" : "s"} to hold on longer than you.`,
      );
    } else if (ratio <= 1 / CONNECT.tenureSimilar) {
      bonds.push("You tend to stay with a position longer than they do.");
    } else {
      bonds.push("You hold your convictions for about the same length of time.");
    }
  }

  // 4 · WHERE YOU DIFFER. Included as a BOND, not a warning: knowing where two
  // people diverge is part of knowing them, and hiding it would make this
  // section flattery.
  const opposed = i.opposedTopics.slice(0, 1);
  if (opposed.length > 0 && bonds.length < CONNECT.maxBonds) {
    bonds.push(`You reach different conclusions on ${topicLabel(opposed[0])}.`);
  }

  // 5 · THE HONEST FLOOR. Nothing measurable in common — so say the true thing
  // that is still an invitation, never "no shared markets".
  if (bonds.length === 0) {
    bonds.push("You are both here looking for ideas worth backing.");
  }

  return {
    strength,
    opening: openingFor(strength, personName),
    bonds: bonds.slice(0, CONNECT.maxBonds),
    early: shared === 0,
  };
}
