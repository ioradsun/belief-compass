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
  /**
   * Days between the market opening and them taking a side, or null when that
   * cannot be known — which includes every position whose `tenureIsFloor` is
   * true, since a belief predating the index has no knowable start.
   */
  daysAfterOpen?: number | null;
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
  /**
   * A crowd smaller than this cannot make anyone contrarian.
   *
   * Measured: of 789 markets with any participant, room sizes run p50 1 · p90 4
   * · p95 5 · max 37. At 8 this reached 2.5% of live markets and "Against the
   * crowd" was effectively dead copy. Four is p90 — rare enough to mean
   * something, common enough to ever fire. Revisit as the platform grows.
   */
  minParticipantsForCrowd: 4,
  /** How lopsided the room must be before standing apart from it is notable. */
  contrarianMajorityPct: 70,
  /** A hold shorter than this is not yet an endurance story. */
  minDaysForLongest: 14,
  /** Positions this far above the median read as concentration, not spread. */
  concentrationShare: 0.4,
  /** Featured convictions shown at once. More is a list, not a portrait. */
  maxDefining: 4,
  /** Taking a side within this many days of the open counts as arriving early. */
  earlyDays: 7,
  /** Reasons to follow shown at once. Three claims is a person; six is a pitch. */
  maxFollowReasons: 3,
  /** A theme needs this many convictions before it is a theme. */
  minPerTheme: 2,
  /** Markets listed inside one theme before the rest collapse to a count. */
  maxPerTheme: 6,
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
export function topCategories(
  positions: readonly PersonPosition[],
): { name: string; share: number }[] {
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

/**
 * WHY FOLLOW THEM — what a reader gets by following, not why the person is good.
 *
 * The distinction is the whole design. "Ranked #4 this month" is an achievement;
 * "usually surfaces technology markets early" is a description of what will
 * arrive in your feed. Only the second one helps anybody decide.
 *
 * So every line here is a claim about their BEHAVIOUR that a follower would
 * experience, each carrying the count it was derived from. Nothing about
 * returns, profit, rank or followers — those describe outcomes, and an outcome
 * is not a reason to listen to someone.
 */
export interface FollowReason {
  /** Which observation this is, for keys and ordering. Never rendered. */
  kind: "topic" | "early" | "contrarian" | "patient" | "broad" | "author";
  /**
   * THE MEANING, in one short line. What a reader would actually say about this
   * person — "Often finds markets early", not "Participated early in 7 markets".
   */
  headline: string;
  /** THE EVIDENCE, underneath, carrying the count the headline is drawn from. */
  evidence: string;
}

/**
 * TWO PARTS, ALWAYS, and in this order.
 *
 * A bare count is accurate and sterile: "Participated early in 7 markets" reads
 * like a row from a database, and a reader has to do the interpreting the page
 * should have done. A bare claim is the opposite failure — "Often finds markets
 * early" with nothing under it is the kind of sentence any profile could print
 * about anybody.
 *
 * So the headline says what it means and the evidence proves it, and neither
 * ships without the other.
 */
export function whyFollow(
  positions: readonly PersonPosition[],
  opts: { marketsCreated?: number } = {},
): FollowReason[] {
  const out: FollowReason[] = [];
  const created = Math.max(0, Math.floor(opts.marketsCreated ?? 0));
  const total = positions.length;

  // Nothing is claimed from a handful of positions. A person with three markets
  // has not demonstrated a tendency, and inventing one here is exactly the
  // "generic recommendation" the whole page exists to avoid.
  if (total < PROFILE.minMarketsForPattern) {
    return created > 0
      ? [
          {
            kind: "author",
            headline: "They write questions, not just answer them.",
            evidence: `${created} of the markets here are theirs.`,
          },
        ]
      : [];
  }

  const cats = topCategories(positions);
  const lead = cats.filter((c) => c.share >= PROFILE.concentrationShare);
  if (lead.length > 0) {
    const names = joinNames(lead.map((c) => c.name));
    const inLead = positions.filter(
      (p) => p.category && lead.some((l) => l.name === p.category),
    ).length;
    out.push({
      kind: "topic",
      headline: `Follow them for ${names}.`,
      evidence: `${inLead} of their ${total} current convictions sit there.`,
    });
  } else if (cats.length >= 3) {
    out.push({
      kind: "broad",
      headline: "Their curiosity ranges widely.",
      evidence: `They hold convictions across ${cats.length} different topics.`,
    });
  }

  // EARLY. Only over positions whose entry timing is knowable — a belief that
  // predates the index has no start date, and counting it would quietly turn
  // "we cannot tell" into evidence.
  const timed = positions.filter((p) => p.daysAfterOpen != null && p.daysAfterOpen >= 0);
  const early = timed.filter((p) => (p.daysAfterOpen ?? Infinity) <= PROFILE.earlyDays);
  if (timed.length >= PROFILE.minMarketsForPattern && early.length >= 2) {
    out.push({
      kind: "early",
      headline: "Often finds markets early.",
      evidence: `Joined ${early.length} of ${timed.length} within a week of the market opening.`,
    });
  }

  const withCrowd = positions.filter((p) => againstThem(p) != null);
  const against = withCrowd.filter((p) => (againstThem(p) ?? 0) >= PROFILE.contrarianMajorityPct);
  if (withCrowd.length >= PROFILE.minMarketsForPattern && against.length >= 2) {
    out.push({
      kind: "contrarian",
      headline: "Comfortable disagreeing with the room.",
      evidence: `Took the less popular side in ${against.length} of ${withCrowd.length} lopsided markets.`,
    });
  }

  const longHolds = positions.filter((p) => p.daysHeld >= 90);
  if (longHolds.length >= 2) {
    out.push({
      kind: "patient",
      headline: "Stays with their strongest convictions.",
      evidence: `${longHolds.length} positions have been held for more than three months.`,
    });
  }

  if (created > 0) {
    out.push({
      kind: "author",
      headline: "They write questions, not just answer them.",
      evidence: `${created} of the markets here are theirs.`,
    });
  }

  return out.slice(0, PROFILE.maxFollowReasons);
}

/**
 * THEIR CONVICTION MAP — everything they currently back, arranged by theme.
 *
 * A flat chronological list of forty positions is the same as no list: nothing
 * in it is more important than anything else, and a reader scrolls it once and
 * leaves. Grouped by theme it becomes browsable — "what do they think about
 * culture" is a question a visitor actually has.
 *
 * Themes are the market categories, which is the only topic model that exists
 * (eight values in production). No finer grouping is invented here.
 *
 * Everything with too few positions to be a theme collapses into one "Elsewhere"
 * group rather than producing a page of one-item headings.
 */
export interface ConvictionTheme {
  /** The category, or "Elsewhere" for the collected remainder. */
  theme: string;
  positions: PersonPosition[];
  /** How many the theme holds in total, when `positions` was truncated. */
  total: number;
}

export const ELSEWHERE = "Elsewhere";

/**
 * REPETITION CONTROL — how many times one market may appear before the page
 * starts feeling like it owns two markets and keeps showing them.
 *
 * Some repetition is correct: "Start Here" and "Largest conviction" and a
 * shared-market row answer different questions about the same market, and
 * suppressing all of it would leave a section wrong rather than tidy. The
 * failure is a SPARSE profile, where three positions can fill five sections and
 * the visitor sees the same question five times in one scroll.
 *
 * So the interpreting sections are ranked by how much each one adds when a
 * market has already appeared, and past the budget the weakest one drops. The
 * complete lists — the conviction map and All Convictions — are deliberately
 * NOT in the budget: they are inventories, and an inventory with holes in it is
 * a broken inventory, not a tidier page.
 */
export const REPEAT = {
  /** Appearances allowed across the interpreting sections. */
  maxAppearances: 2,
} as const;

/** The interpreting sections, strongest claim on a market first. */
export type ProfileSlot = "start_here" | "defining" | "shared" | "explore";

const SLOT_RANK: Record<ProfileSlot, number> = {
  start_here: 0,
  defining: 1,
  shared: 2,
  explore: 3,
};

/**
 * Which (slot, market) pairs survive the repetition budget.
 *
 * Returns the set of slots each market keeps. The caller filters its sections
 * against this rather than each section guessing about the others — the reason
 * V1's duplication was invisible is that no single section could see the page.
 */
export function limitRepeats(
  claims: readonly { slot: ProfileSlot; marketId: number }[],
  max: number = REPEAT.maxAppearances,
): Set<string> {
  const seen = new Map<number, number>();
  const keep = new Set<string>();
  for (const c of [...claims].sort((a, b) => SLOT_RANK[a.slot] - SLOT_RANK[b.slot])) {
    const n = seen.get(c.marketId) ?? 0;
    if (n >= max) continue;
    seen.set(c.marketId, n + 1);
    keep.add(`${c.slot}:${c.marketId}`);
  }
  return keep;
}

/**
 * EVERY position they currently hold, biggest commitment first.
 *
 * The map above INTERPRETS — it groups, it truncates, it leads with the theme
 * they have said the most about. This does not interpret at all, and that is
 * the point: the interpretation layer builds curiosity, and the full list is
 * what makes it trustworthy. A visitor who suspects the highlights were cherry
 * picked has to be able to check, or the highlights are worth nothing.
 *
 * Sorted, never filtered. Nothing here is below a threshold, because "every"
 * has to mean every.
 */
export function allConvictions(positions: readonly PersonPosition[]): PersonPosition[] {
  return [...positions].sort(
    (a, b) => n(b.valueUsd) - n(a.valueUsd) || b.daysHeld - a.daysHeld || a.marketId - b.marketId,
  );
}

export function convictionMap(positions: readonly PersonPosition[]): ConvictionTheme[] {
  const byTheme = new Map<string, PersonPosition[]>();
  for (const p of positions) {
    const k = p.category ?? ELSEWHERE;
    byTheme.set(k, [...(byTheme.get(k) ?? []), p]);
  }

  // Anything that never reached the threshold joins the remainder, so a
  // long-tail explorer gets one honest group instead of nine headings of one.
  const remainder: PersonPosition[] = [...(byTheme.get(ELSEWHERE) ?? [])];
  byTheme.delete(ELSEWHERE);
  for (const [k, list] of [...byTheme]) {
    if (list.length < PROFILE.minPerTheme) {
      remainder.push(...list);
      byTheme.delete(k);
    }
  }

  // Largest first: the theme they have said the most about is the one a visitor
  // should meet first. Within a theme, biggest commitment then longest held.
  const rank = (a: PersonPosition, b: PersonPosition) =>
    n(b.valueUsd) - n(a.valueUsd) || b.daysHeld - a.daysHeld;

  const out: ConvictionTheme[] = [...byTheme.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([theme, list]) => ({
      theme,
      positions: [...list].sort(rank).slice(0, PROFILE.maxPerTheme),
      total: list.length,
    }));

  if (remainder.length > 0) {
    out.push({
      theme: ELSEWHERE,
      positions: [...remainder].sort(rank).slice(0, PROFILE.maxPerTheme),
      total: remainder.length,
    });
  }
  return out;
}

/**
 * MARKETS YOU BOTH CARE ABOUT — shared curiosity, not a tally of agreement.
 *
 * The point is not how many times you matched. It is that you both went looking
 * at the same question, and each row shows what the two of you concluded, side
 * by side, including when that is nothing alike.
 *
 * DISAGREEMENT LEADS. It is the more informative row, and the one a similarity
 * score buries — a page ordered by agreement teaches a reader nothing they did
 * not already believe.
 */
export interface SharedRow {
  marketId: number;
  title: string;
  viewerSide: Side;
  personSide: Side;
  agree: boolean;
}

export function sharedCuriosity(
  agreed: readonly { marketId: number; title: string; viewerSide: Side; personSide: Side }[],
  opposed: readonly { marketId: number; title: string; viewerSide: Side; personSide: Side }[],
  limit = 6,
): SharedRow[] {
  const row = (m: { marketId: number; title: string; viewerSide: Side; personSide: Side }) => ({
    marketId: m.marketId,
    title: m.title,
    viewerSide: m.viewerSide,
    personSide: m.personSide,
    agree: m.viewerSide === m.personSide,
  });
  return [...opposed.map(row), ...agreed.map(row)].slice(0, Math.max(0, limit));
}
