/**
 * FEED CADENCE — the editorial pass over an already-valid feed.
 *
 * Ranking by score alone produces a feed that is correct and exhausting: four
 * buys, then three holding milestones, then the same wallet twice. Every one of
 * those rows earned its place; the SEQUENCE is what fails. This is the pass that
 * decides the order a reader actually experiences.
 *
 * It only ever REORDERS AND TRIMS. It cannot invent an event, cannot alter one,
 * and cannot promote something that was not already eligible — aggregation,
 * deduplication and significance all happen upstream and are not this module's
 * job. If the mixer is ever the thing preventing repetition, the aggregation
 * above it is broken.
 *
 * FOUR RULES, in priority order:
 *
 *   1. SIGNIFICANCE FIRST. A genuinely big event is never held back to satisfy a
 *      pacing target. Above `breakingAt` an event ignores sequencing entirely.
 *   2. VARIETY SECOND. Adjacent rows should not repeat a family, a market, a
 *      side, a person or a motif. This is a penalty, never a filter: if the only
 *      candidates left are three holding milestones, you get three holding
 *      milestones rather than an empty feed.
 *   3. NOBODY DOMINATES. Soft caps per wallet and per market, applied as growing
 *      penalties rather than hard cuts, so a busy market is quietened rather
 *      than silenced.
 *   4. TARGETS ARE GUIDANCE. Under-represented families get a nudge bounded well
 *      below the significance range, and an event under `minQuality` is never
 *      promoted by it. A quiet period yields a shorter, slower feed — never a
 *      padded one.
 *
 * DETERMINISM. Pure function, no randomness, no clock. The same candidates in
 * the same order always produce the same output, so pagination is stable and a
 * poll that changes nothing re-renders nothing. Callers mix the WHOLE set and
 * then slice — mixing per page would let an item move between pages.
 *
 * ZERO IO, pure, fully testable.
 */

/** What kind of story this is. Derived from existing event kinds — never a new event. */
export type EventFamily =
  | "live_action"
  | "conviction_celebration"
  | "collective_story"
  | "market_transition"
  | "relationship_story";

export interface MixCandidate {
  id: string;
  family: EventFamily;
  /** 0..1, from the upstream scorers. The mixer never recomputes it. */
  significance: number;
  /** ISO. Only used for recency and deterministic tie-breaks. */
  occurredAt: string;
  marketId: string;
  side: "YES" | "NO" | null;
  /** The people this event is about — for dominance limits. */
  subjects?: string[];
  /**
   * Semantic identity: two events with the same motif tell the same KIND of
   * story ("another 30-day cohort on YES"), even when they are different rows.
   */
  motif?: string;
}

export const CADENCE = {
  /** Above this an event is breaking news and ignores sequencing. */
  breakingAt: 0.8,
  /** Below this an event is never promoted to fill a family target. */
  minQuality: 0.25,
  /** How far back adjacency is felt. Beyond this, repetition stops mattering. */
  lookback: 3,
  /** Soft caps inside one mixed window. Exceeding them costs, it doesn't block. */
  maxPerWallet: 2,
  maxPerMarket: 3,
  /** Penalties. Deliberately smaller than the significance range they compete with. */
  penalty: {
    family: 0.18,
    market: 0.14,
    subject: 0.22,
    motif: 0.3,
    side: 0.05,
    overCap: 0.35,
  },
  /** The most a pacing target can ever be worth. Never enough to beat real news. */
  targetNudge: 0.12,
} as const;

/**
 * Pacing guidance, not quotas. Read as "roughly this much of a healthy feed",
 * and only ever used to break near-ties between events of comparable quality.
 */
export const FAMILY_TARGET: Record<EventFamily, number> = {
  live_action: 0.475, // 40–55%
  conviction_celebration: 0.18,
  collective_story: 0.12, // celebrations + collective ≈ 25–35%
  market_transition: 0.15, // 10–20%
  relationship_story: 0.075, // 5–15%, and only when the viewer has any
};

/** Newer is better, but gently — a strong old story still beats a weak new one. */
function recencyScore(occurredAt: string, newestMs: number, oldestMs: number): number {
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t) || newestMs === oldestMs) return 1;
  return (t - oldestMs) / (newestMs - oldestMs);
}

/** How much this candidate repeats what the reader just saw. */
function adjacencyPenalty(c: MixCandidate, recent: MixCandidate[]): number {
  let p = 0;
  const subjects = new Set(c.subjects ?? []);
  recent.forEach((prev, i) => {
    // The immediately preceding row matters most; the effect decays.
    const weight = (CADENCE.lookback - i) / CADENCE.lookback;
    if (prev.family === c.family) p += CADENCE.penalty.family * weight;
    if (prev.marketId === c.marketId) p += CADENCE.penalty.market * weight;
    if (c.motif && prev.motif === c.motif) p += CADENCE.penalty.motif * weight;
    if (prev.side && c.side && prev.side === c.side) p += CADENCE.penalty.side * weight;
    if (subjects.size && (prev.subjects ?? []).some((s) => subjects.has(s)))
      p += CADENCE.penalty.subject * weight;
  });
  return p;
}

/** Growing cost for a wallet or market that is taking over the window. */
function dominancePenalty(
  c: MixCandidate,
  walletCount: Map<string, number>,
  marketCount: Map<string, number>,
): number {
  let p = 0;
  const m = marketCount.get(c.marketId) ?? 0;
  if (m >= CADENCE.maxPerMarket) p += CADENCE.penalty.overCap * (1 + m - CADENCE.maxPerMarket);
  for (const s of c.subjects ?? []) {
    const w = walletCount.get(s) ?? 0;
    if (w >= CADENCE.maxPerWallet) p += CADENCE.penalty.overCap * (1 + w - CADENCE.maxPerWallet);
  }
  return p;
}

/**
 * Nudge toward a family the feed is short of — bounded, and never applied to an
 * event that isn't good enough to be there on its own merits.
 */
function targetBonus(c: MixCandidate, picked: MixCandidate[], available: Set<EventFamily>): number {
  if (c.significance < CADENCE.minQuality) return 0;
  // A target for a family with nothing to offer would starve every other family.
  if (!available.has(c.family)) return 0;
  const total = picked.length;
  if (total === 0) return 0;
  const have = picked.filter((p) => p.family === c.family).length / total;
  const want = FAMILY_TARGET[c.family];
  const gap = want - have;
  return gap <= 0 ? 0 : CADENCE.targetNudge * Math.min(1, gap / Math.max(want, 0.01));
}

/**
 * Order an eligible, deduplicated, already-scored set into the sequence a reader
 * should meet it in. Returns every candidate — trimming is the caller's job, so
 * that pagination slices one stable ordering instead of re-mixing per page.
 */
export function mixFeed(candidates: MixCandidate[]): MixCandidate[] {
  if (candidates.length <= 1) return [...candidates];

  const times = candidates.map((c) => Date.parse(c.occurredAt)).filter(Number.isFinite);
  const newest = times.length ? Math.max(...times) : 0;
  const oldest = times.length ? Math.min(...times) : 0;
  const available = new Set(candidates.map((c) => c.family));

  const pool = [...candidates];
  const picked: MixCandidate[] = [];
  const walletCount = new Map<string, number>();
  const marketCount = new Map<string, number>();

  while (pool.length > 0) {
    const recent = picked.slice(-CADENCE.lookback).reverse();
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < pool.length; i += 1) {
      const c = pool[i];
      const base = 0.7 * c.significance + 0.3 * recencyScore(c.occurredAt, newest, oldest);
      // Breaking news skips the queue: no adjacency, no dominance, no pacing.
      const score =
        c.significance >= CADENCE.breakingAt
          ? base + 1
          : base -
            adjacencyPenalty(c, recent) -
            dominancePenalty(c, walletCount, marketCount) +
            targetBonus(c, picked, available);

      // Deterministic tie-break: newer first, then id. No randomness, ever.
      if (score > bestScore + 1e-9) {
        bestScore = score;
        bestIdx = i;
      } else if (Math.abs(score - bestScore) <= 1e-9) {
        const a = pool[i];
        const b = pool[bestIdx];
        const at = Date.parse(a.occurredAt) || 0;
        const bt = Date.parse(b.occurredAt) || 0;
        if (at > bt || (at === bt && a.id < b.id)) bestIdx = i;
      }
    }

    const [chosen] = pool.splice(bestIdx, 1);
    picked.push(chosen);
    marketCount.set(chosen.marketId, (marketCount.get(chosen.marketId) ?? 0) + 1);
    for (const s of chosen.subjects ?? []) walletCount.set(s, (walletCount.get(s) ?? 0) + 1);
  }

  return picked;
}

/** The share each family ended up with — for tests and diagnostics. */
export function familyMix(events: MixCandidate[]): Record<EventFamily, number> {
  const out = {
    live_action: 0,
    conviction_celebration: 0,
    collective_story: 0,
    market_transition: 0,
    relationship_story: 0,
  } as Record<EventFamily, number>;
  if (events.length === 0) return out;
  for (const e of events) out[e.family] += 1;
  for (const k of Object.keys(out) as EventFamily[]) out[k] /= events.length;
  return out;
}

/**
 * Which family an event belongs to, from the vocabulary that already exists.
 * `personal` is the viewer-relationship flag the renderer already sets, so a
 * relationship story is recognised without a second event ever being written.
 */
export function familyOf(input: {
  kind: string;
  category?: string | null;
  personal?: boolean | null;
}): EventFamily {
  if (input.personal) return "relationship_story";
  switch (input.kind) {
    case "conviction_cohort":
      return "collective_story";
    case "market_transition":
    case "believer_milestone":
    case "tribe_doubled":
      return "market_transition";
    default:
      return "live_action";
  }
}
