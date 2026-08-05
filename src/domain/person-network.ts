/**
 * PEOPLE AROUND A PERSON'S CONVICTIONS.
 *
 * This answers a question no other module in the codebase answers:
 *
 *     Who is structurally connected to THIS person?
 *
 * The viewer DNA cache answers something that sounds similar and is not — "how
 * is this person connected to ME". Those are different questions with different
 * subjects, and deriving the second from the first would have produced
 * confident, wrong recommendations: the viewer's own tribe rendered under
 * someone else's name. The profile was cleaner without the section than with
 * that logic, which is why it shipped without one.
 *
 * SEVERAL PATTERNS, NEVER ONE SCORE. "87% match" is the output this refuses to
 * produce. A relationship between two people has a shape — they agree, they
 * disagree, they simply keep turning up in the same rooms — and the shape is
 * the useful part. A single number flattens all three into the same claim and
 * explains none of them.
 *
 * WHAT IS DELIBERATELY NOT A SIGNAL: capital. Weighting overlap by position
 * size would rank "who has the most money in the same markets", which is a
 * leaderboard wearing a relationship's clothes, and the safeguard that actually
 * works is not collecting it. Presence is presence; a $20 believer and a
 * $20,000 believer are equally in the room.
 *
 * EVERY CLAIM CARRIES ITS EVIDENCE. A person is never listed without the count
 * behind them, and below `NETWORK.minShared` markets nobody is listed at all —
 * two coincidences are not a pattern, and a profile that invents connections is
 * worse than one that admits it has none yet.
 *
 * ZERO IO, pure, fully testable.
 */

export const NETWORK = {
  /** Below this an overlap is coincidence. Three is the first real repeat. */
  minShared: 3,
  /** Share of shared markets on the same side before "usually agrees" is true. */
  alignedShare: 0.6,
  /** Share on opposite sides before "often challenges" is true. */
  opposedShare: 0.6,
  /** People shown. Three is a doorway; ten is a directory. */
  maxPeople: 3,
  /**
   * At most this many of one pattern among those shown. Three "often aligned"
   * rows make the pattern vocabulary invisible and turn the section back into a
   * similarity list — the exact thing it exists instead of.
   */
  maxPerPattern: 2,
  /** Co-activity newer than this reads as "now" rather than "once". */
  recentDays: 14,
  /** Topic claims need this many shared markets inside the topic. */
  minSharedPerTopic: 2,
  /** How lopsided a topic must be before it is named as agreement or divide. */
  topicShare: 0.67,
  /** Entering after someone this often reads as following rather than chance. */
  followsShare: 0.7,
} as const;

/** One person's raw overlap with the profile owner. All counts, no judgement. */
export interface Overlap {
  wallet: string;
  name: string;
  avatarUrl: string | null;
  /** Markets where BOTH took a directional side, ever. */
  sharedMarkets: number;
  /** Of those, how many on the same side / on opposite sides. */
  sameSide: number;
  oppositeSide: number;
  /** Markets where both still hold a side right now. */
  currentlyTogether: number;
  /** Days since they were last both active in a shared market, or null. */
  daysSinceTogether: number | null;
  /** Same / opposite counts per topic, for the sentences that name one. */
  byTopic: readonly { topic: string; same: number; opposite: number }[];
  /** Shared markets this person entered AFTER the profile owner did. */
  enteredAfter: number;
}

/**
 * The shape of the connection. Mutually exclusive — a relationship leans one
 * way, and "recently active together" is a fact ON TOP of it rather than a
 * fourth kind of relationship.
 */
export type ConnectionPattern = "aligned" | "opposed" | "co_participant";

export interface ConnectedPerson {
  wallet: string;
  name: string;
  avatarUrl: string | null;
  pattern: ConnectionPattern;
  /**
   * What to show. The first line is always the overlap count — the evidence —
   * and the rest only appear when they are true.
   */
  lines: string[];
}

const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

/** "technology and economics" */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Topics where this pair lands the same way often enough to name. */
function leaningTopics(o: Overlap, direction: "same" | "opposite"): string[] {
  return o.byTopic
    .filter((t) => {
      const total = t.same + t.opposite;
      if (total < NETWORK.minSharedPerTopic) return false;
      return share(direction === "same" ? t.same : t.opposite, total) >= NETWORK.topicShare;
    })
    .sort((a, b) => b.same + b.opposite - (a.same + a.opposite))
    .slice(0, 2)
    .map((t) => t.topic);
}

function patternOf(o: Overlap): ConnectionPattern {
  if (share(o.oppositeSide, o.sharedMarkets) >= NETWORK.opposedShare) return "opposed";
  if (share(o.sameSide, o.sharedMarkets) >= NETWORK.alignedShare) return "aligned";
  return "co_participant";
}

/**
 * How strong a connection this is. Used ONLY to order the list — it is never
 * shown, because the moment a relationship strength becomes visible it becomes
 * a score, and a score is what this module exists to avoid.
 */
function strength(o: Overlap): number {
  const overlap = Math.log1p(o.sharedMarkets);
  const live = Math.log1p(o.currentlyTogether);
  const recent =
    o.daysSinceTogether == null
      ? 0
      : Math.max(0, 1 - o.daysSinceTogether / (NETWORK.recentDays * 4));
  return 0.5 * overlap + 0.3 * live + 0.2 * recent;
}

function describe(o: Overlap, pattern: ConnectionPattern): string[] {
  const lines: string[] = [`Took a side in ${o.sharedMarkets} of the same markets.`];

  const agreed = leaningTopics(o, "same");
  const differed = leaningTopics(o, "opposite");

  if (pattern === "aligned") {
    lines.push(
      agreed.length > 0
        ? `Usually backs the same side on ${joinNames(agreed)}.`
        : "Usually backs the same side.",
    );
    // The exception is the interesting half of an agreement.
    if (differed.length > 0) lines.push(`Takes the other side on ${joinNames(differed)}.`);
  } else if (pattern === "opposed") {
    lines.push(
      differed.length > 0
        ? `Usually takes the other side on ${joinNames(differed)}.`
        : "Usually takes the other side.",
    );
    if (agreed.length > 0) lines.push(`They do agree on ${joinNames(agreed)}.`);
  } else {
    // No lean either way — the overlap itself is the whole observation, and
    // saying more would be inventing a tendency out of a coin flip.
    lines.push("They land on the same side about as often as not.");
  }

  if (
    o.sharedMarkets >= NETWORK.minShared &&
    share(o.enteredAfter, o.sharedMarkets) >= NETWORK.followsShare
  ) {
    // Sequence, not causation: "after" is a timestamp comparison and the copy
    // says only that. Why they arrived second is not knowable from here.
    lines.push("Usually takes a side after them.");
  }

  if (o.currentlyTogether > 0) {
    lines.push(
      `Active together in ${o.currentlyTogether} market${o.currentlyTogether === 1 ? "" : "s"} now.`,
    );
  }
  return lines;
}

/**
 * The people around this person's convictions, strongest connection first.
 *
 * Returns fewer than `maxPeople` rather than reaching below the evidence
 * threshold to fill the section — an empty result is the honest answer for
 * someone whose overlaps are all coincidences, and the caller renders nothing.
 */
export function peopleAround(overlaps: readonly Overlap[]): ConnectedPerson[] {
  const qualified = overlaps
    .filter((o) => o.sharedMarkets >= NETWORK.minShared)
    .map((o) => ({ o, pattern: patternOf(o), s: strength(o) }))
    .sort((a, b) => b.s - a.s || a.o.wallet.localeCompare(b.o.wallet));

  // TWO PASSES, because the per-pattern cap is a PREFERENCE for variety and not
  // a reason to withhold a real connection. The first pass spreads the slots
  // across patterns; the second fills whatever is left in strength order. A
  // person whose connections are genuinely all one shape still gets a full
  // section — the cap exists to avoid a monotone list, not to punish one.
  const taken = new Set<string>();
  const perPattern = new Map<ConnectionPattern, number>();
  const out: ConnectedPerson[] = [];
  const add = ({ o, pattern }: { o: Overlap; pattern: ConnectionPattern }) => {
    taken.add(o.wallet);
    perPattern.set(pattern, (perPattern.get(pattern) ?? 0) + 1);
    out.push({
      wallet: o.wallet,
      name: o.name,
      avatarUrl: o.avatarUrl,
      pattern,
      lines: describe(o, pattern),
    });
  };

  for (const c of qualified) {
    if (out.length >= NETWORK.maxPeople) break;
    if ((perPattern.get(c.pattern) ?? 0) >= NETWORK.maxPerPattern) continue;
    add(c);
  }
  for (const c of qualified) {
    if (out.length >= NETWORK.maxPeople) break;
    if (taken.has(c.o.wallet)) continue;
    add(c);
  }
  return out;
}
