/**
 * Person story — a stranger becoming someone you should meet.
 *
 * The Network screen isn't a contact list; it's where The House discovers your
 * Tribe, your Opps, and eventually your Conviction Twin. This module turns the raw
 * relationship signals into the two things a person card actually needs:
 *
 *   • a DISCOVERY STAGE that reads as a journey, not a label — Still forming →
 *     Recognizable → Possible Tribe → Tribe (and the Opp / Twin tracks) — so
 *     "Neutral" never appears again.
 *   • exactly ONE human sentence about the relationship ("You agree most on AI."),
 *     never a wall of statistics. Percentages support the story; they never lead.
 *
 * Plus a curiosity rank so the most interesting person is always first. ZERO IO,
 * pure, fully testable. It never invents a tie the evidence can't back — a thin
 * pattern honestly reads "too early to know".
 */

export type PersonRelationship = "twin" | "tribe" | "neutral" | "opp" | "inverse" | "insufficient";
export type PersonEvidence = "insufficient" | "early" | "growing" | "established";

export type DiscoveryStage =
  | "searching"
  | "recognizable"
  | "possible_tribe"
  | "tribe"
  | "possible_opp"
  | "opp"
  | "inverse"
  | "possible_twin"
  | "twin";

export const DISCOVERY_LABEL: Record<DiscoveryStage, string> = {
  searching: "Still forming",
  recognizable: "Recognizable",
  possible_tribe: "Possible Tribe",
  tribe: "Tribe",
  possible_opp: "Possible Opp",
  opp: "Opp",
  inverse: "Inverse",
  possible_twin: "Possible Twin",
  twin: "Conviction Twin",
};

export type StoryTone = "aligned" | "opposed" | "forming";

const STAGE_TONE: Record<DiscoveryStage, StoryTone> = {
  searching: "forming",
  recognizable: "forming",
  possible_tribe: "aligned",
  tribe: "aligned",
  possible_twin: "aligned",
  twin: "aligned",
  possible_opp: "opposed",
  opp: "opposed",
  inverse: "opposed",
};

/** Curiosity, not percentage — the first card should always make you wonder. */
const STAGE_RANK: Record<DiscoveryStage, number> = {
  twin: 100,
  possible_twin: 90,
  tribe: 80,
  possible_tribe: 70,
  opp: 60,
  possible_opp: 50,
  inverse: 45,
  recognizable: 30,
  searching: 10,
};

/** Shared decisions before a neutral pairing is even "recognizable". */
export const RECOGNIZABLE_SHARED = 3;

export interface PersonStoryInput {
  relationship: PersonRelationship;
  evidence: PersonEvidence;
  agreement: number;
  sharedBeliefs: number;
  /** Strongest domain you agree on, when known ("AI"). */
  alignedDomain?: string | null;
  /** Strongest domain you clash on, when known ("Politics"). */
  opposedDomain?: string | null;
}

/**
 * The stage this relationship has EARNED. Strong relationships need real evidence
 * to graduate from "possible" to named; a neutral pairing only becomes
 * "recognizable" once you've genuinely crossed paths.
 */
export function discoveryStage(input: PersonStoryInput): DiscoveryStage {
  const { relationship, evidence, sharedBeliefs } = input;
  const established = evidence === "established";
  const some = evidence === "growing" || evidence === "established";
  switch (relationship) {
    case "twin":
      return established ? "twin" : "possible_twin";
    case "tribe":
      return some ? "tribe" : "possible_tribe";
    case "opp":
      return some ? "opp" : "possible_opp";
    case "inverse":
      return "inverse";
    case "neutral":
      return some && sharedBeliefs >= RECOGNIZABLE_SHARED ? "recognizable" : "searching";
    default:
      return "searching";
  }
}

/** The one sentence — a relationship, never math. */
function sentenceFor(stage: DiscoveryStage, input: PersonStoryInput): string {
  const shared = Math.max(0, input.sharedBeliefs);
  const aligned = input.alignedDomain?.trim() || null;
  const opposed = input.opposedDomain?.trim() || null;
  const sharedPhrase = `${shared} shared conviction${shared === 1 ? "" : "s"}`;
  switch (stage) {
    case "twin":
      return "You think alike — your convictions keep matching.";
    case "possible_twin":
      return "You're a few decisions away from being Twins.";
    case "tribe":
      return aligned ? `You agree most on ${aligned}.` : `You've agreed on ${sharedPhrase}.`;
    case "possible_tribe":
      return `You're starting to align — ${sharedPhrase} so far.`;
    case "opp":
      return aligned && opposed
        ? `You agree on ${aligned}, but clash on ${opposed}.`
        : opposed
          ? `You clash most on ${opposed}.`
          : "You disagree more than you agree.";
    case "possible_opp":
      return opposed
        ? `You're beginning to diverge on ${opposed}.`
        : "You're starting to disagree.";
    case "inverse":
      return "You mirror each other — opposite calls, again and again.";
    case "recognizable":
      return `You've crossed paths on ${sharedPhrase}.`;
    default:
      return shared > 0 ? `Only ${sharedPhrase} — too early to know.` : "Too new to read yet.";
  }
}

export interface PersonStory {
  stage: DiscoveryStage;
  stageLabel: string;
  tone: StoryTone;
  /** The single meaningful sentence for this person. */
  sentence: string;
  /** Higher = more curious; drives the list order. */
  rank: number;
}

export function personStory(input: PersonStoryInput): PersonStory {
  const stage = discoveryStage(input);
  return {
    stage,
    stageLabel: DISCOVERY_LABEL[stage],
    tone: STAGE_TONE[stage],
    sentence: sentenceFor(stage, input),
    rank: STAGE_RANK[stage],
  };
}
