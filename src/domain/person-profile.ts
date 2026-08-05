/**
 * PERSON PROFILE — a person told through their convictions, not their numbers.
 *
 * The old page answered "what has this person done": a relationship percentage,
 * a Together/Apart pair, a per-topic bar chart, then every shared market as a
 * flat list. All of it true, none of it an introduction. A visitor left knowing
 * a score and no more about the person than when they arrived.
 *
 * The question this module answers instead is "why should this person matter to
 * me", and the answer is built from the convictions that most reveal them —
 * where they put the most, where they have stayed longest, where they stood
 * against the room, where they changed their mind.
 *
 * THREE RULES, and they are the reason most of this file is refusals.
 *
 *   NEVER INVENT A PERSON. Everything said here is derived from a position
 *   someone actually holds or a side they actually took. No motive, no feeling,
 *   no personality. "Their positions are concentrated in crypto" is observable;
 *   "they are a crypto believer" is a claim about a human being.
 *
 *   NEVER CLAIM A PATTERN FROM ONE DATA POINT. A contrarian position needs a
 *   crowd big enough to be a crowd. A "holds longer than most" needs more than
 *   one long hold. Below the thresholds the sentence is not softened — it is
 *   not said.
 *
 *   SILENCE IS AN HONEST ANSWER. A person with two markets gets "their
 *   conviction story is still taking shape" and those two markets, not a
 *   confident summary of nothing. Empty sections are omitted, never rendered
 *   empty.
 *
 * ZERO IO, pure, fully testable.
 */

export type Side = "YES" | "NO";

/** One held position, as the profile needs to judge it. */
export interface PersonPosition {
  marketId: number;
  title: string;
  side: Side;
  /** Marked value of the held side in USD, or null when unpriced. */
  valueUsd: number | null;
  /** Days they have held this side. */
  daysHeld: number;
  /**
   * True when `daysHeld` is a LOWER BOUND — the belief predates the index, so
   * its real start is unknown and the sentence must say "512+ days".
   */
  tenureIsFloor: boolean;
  /** Share of this market's participants on YES, 0..100, or null when unknown. */
  crowdYesPct: number | null;
  /** Directional believers here — how much the crowd comparison is worth. */
  participants: number;
  category: string | null;
}

/** A side they moved away from, established from the events log, not inferred. */
export interface SideChange {
  marketId: number;
  title: string;
  from: Side;
  to: Side;
  occurredAt: string;
}

export const PROFILE = {
  /** Below this a "story" is a coincidence. Two markets is not a pattern. */
  minMarketsForPattern: 4,
  /** A crowd smaller than this cannot make anyone contrarian. */
  minParticipantsForCrowd: 8,
  /** How lopsided the room must be before standing apart from it is notable. */
  contrarianMajorityPct: 70,
  /** A hold shorter than this is not yet an endurance story. */
  minDaysForLongest: 14,
  /** Positions this far above the median read as concentration, not spread. */
  concentrationShare: 0.4,
  /** Featured convictions shown at once. More is a list, not a portrait. */
  maxDefining: 4,
} as const;

export type DefiningKind = "largest" | "longest" | "contrarian" | "changed_mind";

export interface DefiningConviction {
  kind: DefiningKind;
  marketId: number;
  title: string;
  /** Null for a side they have left — a change of mind has no current side. */
  side: Side | null;
  /** The heading: "Largest conviction". */
  label: string;
  /** The single line of evidence beneath it. Never an interpretation. */
  detail: string;
}

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** "$4,820" / "$62" — a figure someone might act on, so never abbreviated. */
function usd(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/** "642 days" / "512+ days" — the floor marker is never dropped. */
export function tenureText(days: number, isFloor: boolean): string {
  const d = Math.max(0, Math.floor(days));
  return `${d.toLocaleString("en-US")}${isFloor ? "+" : ""} day${d === 1 ? "" : "s"}`;
}

/** How much of the room disagrees with them, 0..100, or null when unknowable. */
function againstThem(p: PersonPosition): number | null {
  if (p.crowdYesPct == null || !Number.isFinite(p.crowdYesPct)) return null;
  if (p.participants < PROFILE.minParticipantsForCrowd) return null;
  const other = p.side === "YES" ? 100 - p.crowdYesPct : p.crowdYesPct;
  return Math.round(Math.max(0, Math.min(100, other)));
}

/**
 * The convictions that most reveal this person.
 *
 * Deduped by market: when one position is both the largest and the longest, it
 * is shown once, under the first heading that claims it. Four descriptions of
 * one market is a portrait of a market, not of a person.
 */
export function definingConvictions(
  positions: readonly PersonPosition[],
  changes: readonly SideChange[] = [],
): DefiningConviction[] {
  const out: DefiningConviction[] = [];
  const used = new Set<number>();
  const held = positions.filter((p) => p.marketId != null);

  const largest = held
    .filter((p) => n(p.valueUsd) > 0)
    .sort((a, b) => n(b.valueUsd) - n(a.valueUsd))[0];
  if (largest) {
    used.add(largest.marketId);
    out.push({
      kind: "largest",
      marketId: largest.marketId,
      title: largest.title,
      side: largest.side,
      label: "Largest conviction",
      detail: `Backing ${largest.side} · ${usd(n(largest.valueUsd))} committed`,
    });
  }

  const longest = held
    .filter((p) => !used.has(p.marketId) && p.daysHeld >= PROFILE.minDaysForLongest)
    .sort((a, b) => b.daysHeld - a.daysHeld)[0];
  if (longest) {
    used.add(longest.marketId);
    out.push({
      kind: "longest",
      marketId: longest.marketId,
      title: longest.title,
      side: longest.side,
      label: "Longest held",
      detail: `Backing ${longest.side} for ${tenureText(longest.daysHeld, longest.tenureIsFloor)}`,
    });
  }

  // Against the crowd — only where there IS a crowd, and only where it is
  // genuinely lopsided. Two people disagreeing is not standing apart.
  const contrarian = held
    .filter((p) => {
      if (used.has(p.marketId)) return false;
      const against = againstThem(p);
      return against != null && against >= PROFILE.contrarianMajorityPct;
    })
    .sort((a, b) => (againstThem(b) ?? 0) - (againstThem(a) ?? 0))[0];
  if (contrarian) {
    used.add(contrarian.marketId);
    const against = againstThem(contrarian)!;
    out.push({
      kind: "contrarian",
      marketId: contrarian.marketId,
      title: contrarian.title,
      side: contrarian.side,
      label: "Against the crowd",
      detail: `Backing ${contrarian.side} while ${against}% of participants back ${
        contrarian.side === "YES" ? "NO" : "YES"
      }`,
    });
  }

  // Changed their mind — a recorded side change, never an inference from a
  // position that merely closed. WHY they changed is not ours to say.
  const change = changes.filter((c) => !used.has(c.marketId))[0];
  if (change) {
    used.add(change.marketId);
    out.push({
      kind: "changed_mind",
      marketId: change.marketId,
      title: change.title,
      side: change.to,
      label: "Changed their mind",
      detail: `Previously backed ${change.from}. Now backs ${change.to}`,
    });
  }

  return out.slice(0, PROFILE.maxDefining);
}

export interface Introduction {
  /** One or two grounded sentences, or the honest "still taking shape" line. */
  lines: string[];
  /** True when there is not enough activity to claim any pattern. */
  provisional: boolean;
}

/** The most-represented categories, strongest first. */
function topCategories(positions: readonly PersonPosition[]): { name: string; share: number }[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const p of positions) {
    if (!p.category) continue;
    counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([name, c]) => ({ name, share: c / total }))
    .sort((a, b) => b.share - a.share);
}

/** "crypto and politics" / "crypto, politics and sports" */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A human introduction, built only from what can be observed.
 *
 * Two sentences at most: WHERE they participate, and ONE behavioural trait when
 * the evidence carries it. No third sentence — a paragraph about a stranger
 * starts sounding like a claim to know them.
 */
export function introduction(
  positions: readonly PersonPosition[],
  opts: { marketsParticipated?: number } = {},
): Introduction {
  const total = opts.marketsParticipated ?? positions.length;
  if (positions.length < PROFILE.minMarketsForPattern) {
    return {
      provisional: true,
      lines: [
        "Their conviction story is still taking shape.",
        total > 0
          ? `They have taken a side in ${total} market${total === 1 ? "" : "s"} so far.`
          : "They have not taken a side in a market yet.",
      ],
    };
  }

  const lines: string[] = [];
  const cats = topCategories(positions);
  if (cats.length > 0) {
    // Concentrated or spread — the difference is itself the observation.
    const lead = cats.filter((c) => c.share >= PROFILE.concentrationShare);
    if (lead.length > 0) {
      lines.push(`Most of their convictions sit in ${joinNames(lead.map((c) => c.name))}.`);
    } else {
      lines.push(
        `They take sides across ${joinNames(cats.slice(0, 3).map((c) => c.name))}, without concentrating in one.`,
      );
    }
  }

  // ONE trait, the strongest that the evidence supports. Ordered by how much it
  // says about the person rather than about the market.
  const withCrowd = positions.filter((p) => againstThem(p) != null);
  const against = withCrowd.filter((p) => (againstThem(p) ?? 0) >= PROFILE.contrarianMajorityPct);
  const longHolds = positions.filter((p) => p.daysHeld >= 90);

  if (withCrowd.length >= PROFILE.minMarketsForPattern && against.length >= 2) {
    lines.push(
      `They have taken the less popular side in ${against.length} of ${withCrowd.length} markets where the room had clearly picked one.`,
    );
  } else if (longHolds.length >= 2) {
    lines.push(`${longHolds.length} of their positions have been held for more than three months.`);
  }

  return { provisional: false, lines };
}

/** Everything the viewer↔person comparison needs to be described in words. */
export interface ConnectionInput {
  sharedMarkets: number;
  together: number;
  apart: number;
  alignedTopics: readonly string[];
  opposedTopics: readonly string[];
  /** Median days held, each side of the comparison. Null when unknown. */
  viewerMedianDays?: number | null;
  personMedianDays?: number | null;
}

export interface Connection {
  lines: string[];
  /** True when there is not enough overlap to describe a pattern. */
  provisional: boolean;
}

/**
 * What connects the two of you, as sentences rather than a percentage.
 *
 * A single similarity number is the one thing this deliberately does not
 * produce. "68% aligned" tells a reader they are compatible with someone
 * without telling them one thing they would disagree about.
 */
export function connection(i: ConnectionInput): Connection {
  const shared = Math.max(0, Math.floor(i.sharedMarkets));
  if (shared < PROFILE.minMarketsForPattern) {
    return {
      provisional: true,
      lines: [
        shared === 0
          ? "You have not taken a side in any of the same markets yet."
          : `You have taken a side in ${shared} of the same market${shared === 1 ? "" : "s"} — not enough yet to see a pattern.`,
      ],
    };
  }

  const lines: string[] = [`You have taken a side in ${shared} of the same markets.`];

  const aligned = i.alignedTopics.slice(0, 2);
  const opposed = i.opposedTopics.slice(0, 2);
  if (aligned.length > 0 && opposed.length > 0) {
    lines.push(
      `You often agree on ${joinNames([...aligned])}, and reach different conclusions on ${joinNames([...opposed])}.`,
    );
  } else if (aligned.length > 0) {
    lines.push(`You most often agree on ${joinNames([...aligned])}.`);
  } else if (opposed.length > 0) {
    lines.push(`Where you differ most is ${joinNames([...opposed])}.`);
  }

  // Holding behaviour — a real difference between two people that a side-by-side
  // agreement count cannot show.
  const vm = i.viewerMedianDays;
  const pm = i.personMedianDays;
  if (vm != null && pm != null && vm > 0 && pm > 0) {
    const ratio = pm / vm;
    if (ratio >= 1.5) lines.push("They tend to hold their positions longer than you do.");
    else if (ratio <= 0.67) lines.push("You tend to hold your positions longer than they do.");
  }

  return { provisional: false, lines };
}

/** Why a market is worth exploring because of THIS person. */
export type DiscoveryReason =
  | "largest"
  | "longest"
  | "contrarian"
  | "changed_mind"
  | "you_differ"
  | "you_agree";

export interface DiscoverySuggestion {
  marketId: number;
  title: string;
  reason: DiscoveryReason;
  /** The sentence saying why it is here. Never "recommended for you". */
  why: string;
}

/**
 * Markets to explore because of this person.
 *
 * Every entry states its reason in the person's terms. A suggestion that cannot
 * explain itself is not offered — which is why this returns fewer rows than it
 * could rather than padding with "similar market".
 */
export function exploreThrough(
  defining: readonly DefiningConviction[],
  shared: {
    agreed: readonly { marketId: number; title: string }[];
    opposed: readonly { marketId: number; title: string; personSide: Side; viewerSide: Side }[];
  },
  limit = 4,
): DiscoverySuggestion[] {
  const out: DiscoverySuggestion[] = [];
  const seen = new Set<number>();
  const push = (s: DiscoverySuggestion) => {
    if (seen.has(s.marketId) || out.length >= limit) return;
    seen.add(s.marketId);
    out.push(s);
  };

  // Disagreement leads. It is the most useful thing one person can offer
  // another, and the row a similarity score would have buried.
  for (const m of shared.opposed) {
    push({
      marketId: m.marketId,
      title: m.title,
      reason: "you_differ",
      why: `You back ${m.viewerSide} here, they back ${m.personSide}.`,
    });
  }
  const REASON: Record<DefiningKind, { reason: DiscoveryReason; why: string }> = {
    largest: { reason: "largest", why: "Their largest current position." },
    longest: { reason: "longest", why: "One of their longest-held convictions." },
    contrarian: { reason: "contrarian", why: "They took the side the room did not." },
    changed_mind: { reason: "changed_mind", why: "They changed their mind here." },
  };
  for (const d of defining) push({ marketId: d.marketId, title: d.title, ...REASON[d.kind] });
  for (const m of shared.agreed) {
    push({
      marketId: m.marketId,
      title: m.title,
      reason: "you_agree",
      why: "You have both taken the same side here.",
    });
  }
  return out;
}
