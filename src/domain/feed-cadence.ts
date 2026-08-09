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
 * FIVE RULES, in priority order:
 *
 *   1. SIGNIFICANCE FIRST. A genuinely big event is never held back to satisfy a
 *      pacing target. Above `breakingAt` an event ignores sequencing entirely.
 *   2. DISCOVERY IS THE OTHER HALF OF QUALITY. An event that introduces the
 *      viewer to someone worth knowing outranks a bigger event that introduces
 *      nobody. Discovery does not replace significance — it lifts a candidate's
 *      QUALITY toward 1 in proportion to how much of an introduction it is, so a
 *      Twin's small buy can lead a whale's large one while an anonymous market
 *      flip still leads everything. `breakingAt` deliberately stays on
 *      significance alone: structural news skips the queue, personalization
 *      competes inside it.
 *   3. VARIETY. Adjacent rows should not repeat a family, a market, a side, a
 *      person or a motif, and a person not yet met in this window is worth a
 *      small bonus — the network should feel broad, and every session should
 *      introduce someone new. Penalties and bonuses, never filters: if the only
 *      candidates left are three holding milestones, you get three holding
 *      milestones rather than an empty feed.
 *   4. NOBODY DOMINATES — and neither does any one KIND of story. Soft caps per
 *      wallet, per market and per motif, applied as growing penalties rather
 *      than hard cuts, so a busy market is quietened rather than silenced. The
 *      motif cap is window-wide because repetition of a kind is felt across the
 *      whole read: six "Back from the dead" rows in ten make the phrase mean
 *      nothing, however far apart they sit.
 *   5. TARGETS ARE GUIDANCE. Under-represented families get a nudge bounded well
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
  /**
   * 0..1 — how much of an INTRODUCTION this is for the reader
   * (src/domain/discovery). Absent means "we know nothing about who this is
   * for", which is scored as zero, so an anonymous feed behaves exactly as it
   * did before this dimension existed.
   */
  discovery?: number;
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
  /**
   * How loudly the PI speaks about this row (src/domain/pi-voice `voiceLevel`).
   * Used for one thing only: charging for repeated Intelligence, below.
   */
  voice?: "receipt" | "observation" | "intelligence";
  /** `informationGain` for the row — lets a genuine clue buy its way past the cost. */
  signalGain?: number;
  /**
   * The SHAPE of the clue: the vector's `primary` signal, and the tension kind
   * when there is one (src/domain/signal-vector). A motif keys on the composed
   * copy, so two rows can read as the same observation — "believers left while
   * price rose", four times, in four different markets — and pay nothing. The
   * shape is what the reader recognises, so the shape is what gets capped.
   */
  signalPrimary?: string | null;
  signalKind?: string | null;
  /**
   * This row is here for HEARTBEAT, not for meaning: it failed standard
   * admission and passed only the silence-adjusted one (src/domain/feed-density
   * `admissionOf`). The mixer treats it as an ordinary receipt in every respect
   * but one — repetition of the same heartbeat shape is charged, so a quiet
   * window fills with four different people rather than one person four times.
   * It NEVER changes significance, voice or gain.
   */
  pulse?: boolean;
}


/**
 * TWO LAYERS, ONE FEED.
 *
 * Insider is an intelligence layer with an activity layer underneath it, and
 * the ranking has to make that obvious without a second tab. A row's VOICE is
 * already decided by the signal vector and the copy it can support; this is the
 * band of significance each voice is allowed to occupy, so a clue outranks an
 * ordinary receipt even when the receipt is about the reader's own money.
 */
export const VOICE_CEILING: Record<"receipt" | "observation" | "intelligence", number> = {
  receipt: 0.3,
  observation: 0.65,
  intelligence: 1,
};

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
  /**
   * How many rows may tell the SAME KIND of story in one window.
   *
   * A motif already costs the most of any adjacency penalty, but adjacency only
   * looks back `lookback` rows and decays — so six "Back from the dead" spread
   * across ten rows paid almost nothing and the copy stopped meaning anything.
   * A market and a wallet each had a window-wide ceiling; the thing that makes a
   * row feel repetitive did not. Two of a kind is a coincidence; the third is a
   * pattern, and a pattern is what makes a feed read as generated.
   */
  maxPerMotif: 2,
  /**
   * How many rows in one window may have the SAME SIGNAL SHAPE.
   *
   * Distinct from the motif: the motif is the copy's identity, the shape is the
   * observation's. Three markets can each honestly report "believers left while
   * price rose" with different wallets, different numbers and three different
   * motifs — and the reader still experiences one sentence, three times. The
   * kind (`believers_left_price_rose`) is the tighter cap because it is the more
   * recognisable phrase; the primary signal is the looser one.
   */
  maxPerSignalKind: 2,
  maxPerSignalPrimary: 3,
  /** Penalties. Deliberately smaller than the significance range they compete with. */
  penalty: {
    family: 0.18,
    market: 0.14,
    subject: 0.22,
    motif: 0.3,
    side: 0.05,
    overCap: 0.35,
    /** Per Intelligence row over the window's allowance. Escalates; never blocks. */
    intelligence: 0.12,

  },
  /** The most a pacing target can ever be worth. Never enough to beat real news. */
  targetNudge: 0.12,
  /**
   * How much of the distance to a perfect score a full discovery can close.
   * Sized so a Twin's ordinary buy (significance ≈0.55, discovery ≈0.9) lands
   * above an anonymous whale trade (≈0.8, ≈0.2) without letting personalization
   * reach the breaking band on its own — that stays significance's alone.
   */
  discoveryLift: 0.85,
  /** A person not yet met in this window. Small, and never a reason on its own. */
  newPersonBonus: 0.1,
  /**
   * SCARCITY IS A COST, NEVER A CEILING (plan §6).
   *
   * Roughly a quarter of a healthy window speaks at Intelligence volume. Held
   * as a quota it would make the PI deliberately dumber: an hour with six real
   * contradictions must be allowed to report six. So the target is enforced as
   * an ESCALATING PRICE — the first rows over the allowance pay a little, the
   * fifth pays five times that — and a genuinely strong clue skips it entirely,
   * exactly as `breakingAt` skips sequencing.
   */
  intelligenceTarget: 0.25,
  /** Above this `informationGain`, the row is a real clue and pays nothing. */
  intelligenceBypass: 0.6,
  /** The smallest window the allowance is computed against, so early rows aren't taxed. */
  intelligenceFloorWindow: 4,
} as const;


/**
 * Pacing guidance, not quotas. Read as "roughly this much of a HEALTHY feed",
 * and only ever used to break near-ties between events of comparable quality.
 *
 * These are the shares to aim for on a busy day. What to do on a quiet one is
 * `familyTargets` below — because most days here are quiet ones.
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

/**
 * How good this candidate is, on both axes at once. Discovery closes some of the
 * remaining distance to 1 — the same bounded composition significance itself uses
 * — so it can lift a modest event a long way without any amount of it ever
 * overshooting, and a feed with no discovery data scores exactly as before.
 */
function quality(c: MixCandidate): number {
  const d = c.discovery ?? 0;
  if (d <= 0) return c.significance;
  return c.significance + (1 - c.significance) * CADENCE.discoveryLift * Math.min(1, d);
}

/**
 * A face the reader has not met yet in this window. Bounded and small: broadening
 * the network is worth a tie-break, never worth promoting a weak story.
 */
function noveltyBonus(c: MixCandidate, walletCount: Map<string, number>): number {
  const subjects = c.subjects ?? [];
  if (subjects.length === 0 || c.significance < CADENCE.minQuality) return 0;
  return subjects.some((s) => !walletCount.has(s)) ? CADENCE.newPersonBonus : 0;
}

/** Growing cost for a wallet, a market, or a KIND OF STORY taking over the window. */
function dominancePenalty(
  c: MixCandidate,
  walletCount: Map<string, number>,
  marketCount: Map<string, number>,
  motifCount: Map<string, number>,
  shapeCount?: Map<string, number>,
): number {
  let p = 0;
  const m = marketCount.get(c.marketId) ?? 0;
  if (m >= CADENCE.maxPerMarket) p += CADENCE.penalty.overCap * (1 + m - CADENCE.maxPerMarket);
  for (const s of c.subjects ?? []) {
    const w = walletCount.get(s) ?? 0;
    if (w >= CADENCE.maxPerWallet) p += CADENCE.penalty.overCap * (1 + w - CADENCE.maxPerWallet);
  }
  // Window-wide, unlike the adjacency motif penalty: repetition of a KIND is
  // felt across the whole read, not only between neighbours. Still a cost and
  // never a block — a third genuinely breaking row of one kind still gets in,
  // because significance ≥ breakingAt skips this entirely.
  if (c.motif) {
    const k = motifCount.get(c.motif) ?? 0;
    if (k >= CADENCE.maxPerMotif) p += CADENCE.penalty.overCap * (1 + k - CADENCE.maxPerMotif);
  }
  // The same OBSERVATION, in different markets, with different copy. Same cost
  // shape as the motif cap, and equally soft: a fourth genuine contradiction is
  // quietened, never dropped, and breaking rows skip it entirely.
  if (shapeCount) {
    if (c.signalKind) {
      const k = shapeCount.get(`kind:${c.signalKind}`) ?? 0;
      if (k >= CADENCE.maxPerSignalKind)
        p += CADENCE.penalty.overCap * (1 + k - CADENCE.maxPerSignalKind);
    }
    if (c.signalPrimary && c.signalPrimary !== "none") {
      const k = shapeCount.get(`primary:${c.signalPrimary}`) ?? 0;
      if (k >= CADENCE.maxPerSignalPrimary)
        p += CADENCE.penalty.overCap * (1 + k - CADENCE.maxPerSignalPrimary);
    }
  }
  return p;
}

/**
 * The price of speaking at Intelligence volume again.
 *
 * `intelCount` rows already read as intelligence; this candidate would be the
 * next. The allowance grows with the window, so a short feed of three genuine
 * clues is untouched, while a long one that keeps escalating pays more for each
 * additional clue than it did for the last. A row whose `informationGain` is
 * genuinely high pays nothing at all — the quota must never downgrade a true
 * contradiction into a receipt.
 */
export function intelligenceCost(
  c: MixCandidate,
  intelCount: number,
  pickedTotal: number,
): number {
  if (c.voice !== "intelligence") return 0;
  if ((c.signalGain ?? 0) >= CADENCE.intelligenceBypass) return 0;
  const window = Math.max(pickedTotal + 1, CADENCE.intelligenceFloorWindow);
  const allowance = Math.max(1, Math.round(CADENCE.intelligenceTarget * window));
  const over = intelCount + 1 - allowance;
  return over <= 0 ? 0 : CADENCE.penalty.intelligence * over;
}

const FAMILIES = Object.keys(FAMILY_TARGET) as EventFamily[];


/**
 * THE BUDGET FOR THE DAY THAT ACTUALLY HAPPENED.
 *
 * `FAMILY_TARGET` describes a healthy feed — roughly half live action, a fifth
 * celebration, and so on. It was applied as a constant, which is right exactly
 * once a day and wrong the rest of the time. Measured, NINE OF A THOUSAND
 * markets traded in the last 24 hours: live action is not half of what happened
 * here, it is a handful of rows, and holding 47.5% of the budget for it starves
 * the families that DO have something to say.
 *
 * There was already a guard for the extreme case — a family with no candidates
 * at all earns no nudge — but a family with ONE candidate still held its whole
 * share, and the freed budget went nowhere. So the feed's own pacing worked
 * against it on precisely the days it was needed.
 *
 * Two rules, and no new constant to tune:
 *
 *   A FAMILY IS NEVER ASKED FOR MORE THAN IT HAS. Its ceiling is its share of
 *   the supply. One live action among twenty rows is asked to be one row, not
 *   half the feed.
 *
 *   WHAT CANNOT BE SUPPLIED IS SHARED OUT, by preference, among the families
 *   that can fill it — so on a quiet day the celebrations, the collective
 *   stories and the long-held convictions inherit the space the trades left
 *   behind, and the feed leans toward them without anyone deciding a "quiet
 *   mode" threshold.
 *
 * The two rules interact, so one pass is not enough: hand a capped family's
 * share to the others and one of THEM may now exceed its own ceiling. This is
 * water-filling — pour the budget out by preference, freeze whoever overflows,
 * pour the rest again. Five families, so it settles in at most five passes and
 * is fully deterministic.
 *
 * On a busy day supply exceeds every ceiling and this returns FAMILY_TARGET
 * unchanged, which is the point: one rule, and the healthy mix is its own
 * special case.
 */
export function familyTargets(candidates: readonly MixCandidate[]): Record<EventFamily, number> {
  const out = {} as Record<EventFamily, number>;
  for (const f of FAMILIES) out[f] = 0;
  if (candidates.length === 0) return out;

  const ceiling = {} as Record<EventFamily, number>;
  for (const f of FAMILIES) ceiling[f] = 0;
  for (const c of candidates) ceiling[c.family] += 1 / candidates.length;

  let open = FAMILIES.filter((f) => ceiling[f] > 0);
  let budget = 1;
  // At most one family freezes per pass, so this cannot run longer than FAMILIES.
  for (let pass = 0; pass < FAMILIES.length && open.length > 0 && budget > 1e-9; pass += 1) {
    const weight = open.reduce((sum, f) => sum + FAMILY_TARGET[f], 0);
    if (weight <= 0) break;
    const overflow: EventFamily[] = [];
    for (const f of open) {
      const share = (budget * FAMILY_TARGET[f]) / weight;
      if (share >= ceiling[f]) overflow.push(f);
    }
    if (overflow.length === 0) {
      for (const f of open) out[f] += (budget * FAMILY_TARGET[f]) / weight;
      budget = 0;
      break;
    }
    for (const f of overflow) {
      out[f] = ceiling[f];
      budget -= ceiling[f];
    }
    open = open.filter((f) => !overflow.includes(f));
  }
  return out;
}

/**
 * Nudge toward a family the feed is short of — bounded, and never applied to an
 * event that isn't good enough to be there on its own merits.
 */
function targetBonus(
  c: MixCandidate,
  picked: MixCandidate[],
  want: Record<EventFamily, number>,
): number {
  if (c.significance < CADENCE.minQuality) return 0;
  const total = picked.length;
  if (total === 0) return 0;
  const target = want[c.family];
  // A family with nothing to offer scores zero above, so this also covers the
  // case the old `available` set was guarding.
  if (target <= 0) return 0;
  const have = picked.filter((p) => p.family === c.family).length / total;
  const gap = target - have;
  return gap <= 0 ? 0 : CADENCE.targetNudge * Math.min(1, gap / Math.max(target, 0.01));
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
  // The budget for THIS set, not for an imagined healthy day. See familyTargets.
  const want = familyTargets(candidates);

  const pool = [...candidates];
  const picked: MixCandidate[] = [];
  const walletCount = new Map<string, number>();
  const marketCount = new Map<string, number>();
  const motifCount = new Map<string, number>();
  const shapeCount = new Map<string, number>();
  let intelCount = 0;

  while (pool.length > 0) {
    const recent = picked.slice(-CADENCE.lookback).reverse();
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < pool.length; i += 1) {
      const c = pool[i];
      const base = 0.7 * quality(c) + 0.3 * recencyScore(c.occurredAt, newest, oldest);
      // Breaking news skips the queue: no adjacency, no dominance, no pacing.
      // The test is SIGNIFICANCE, not quality — a market changing its own answer
      // interrupts everyone, while an introduction has to earn its place in the
      // sequence like every other row.
      const score =
        c.significance >= CADENCE.breakingAt
          ? base + 1
          : base -
            adjacencyPenalty(c, recent) -
            dominancePenalty(c, walletCount, marketCount, motifCount, shapeCount) -
            intelligenceCost(c, intelCount, picked.length) +
            targetBonus(c, picked, want) +
            noveltyBonus(c, walletCount);

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
    if (chosen.motif) motifCount.set(chosen.motif, (motifCount.get(chosen.motif) ?? 0) + 1);
    if (chosen.signalKind)
      shapeCount.set(
        `kind:${chosen.signalKind}`,
        (shapeCount.get(`kind:${chosen.signalKind}`) ?? 0) + 1,
      );
    if (chosen.signalPrimary && chosen.signalPrimary !== "none")
      shapeCount.set(
        `primary:${chosen.signalPrimary}`,
        (shapeCount.get(`primary:${chosen.signalPrimary}`) ?? 0) + 1,
      );
    if (chosen.voice === "intelligence") intelCount += 1;
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
 * Which family an event belongs to.
 *
 * TWO BUGS LIVED HERE, and between them they emptied the two most interesting
 * families in the feed.
 *
 * 1. THE FAMILY WAS READ FROM THE EVENT KIND. Every conviction celebration the
 *    grammar writes — a first believer, someone doubling down, someone changing
 *    their mind after months — arrives as a `trade`, so all of them fell to
 *    `live_action`. `FAMILY_TARGET.conviction_celebration` reserves 18% of a
 *    healthy feed and NOTHING COULD ENTER IT. Worse, a celebration sitting in
 *    `live_action` is penalised by the adjacency rule for following an ordinary
 *    buy, so the mixer pushed down exactly the rows it should have lifted. That
 *    is the "Sarah backed… Mike backed… Emily backed…" feed.
 *
 *    The signature already accepted `category` and the call site never passed
 *    it. The classification input existed and was discarded.
 *
 * 2. `personal` OVERRODE EVERYTHING. A Tribe member being the first believer in
 *    a market was a `relationship_story` competing for a 7.5% slot, and the fact
 *    that it was a first believer was lost. Personalization and story type are
 *    two different axes; collapsing them meant the rows a reader cares about
 *    most were the ones the mixer knew least about.
 *
 *    Who an event is about is already carried — and already bounded — by the
 *    DISCOVERY lift, which is the mechanism built for it. `relationship_story`
 *    now means what its name says: a row whose subject IS the relationship,
 *    with no stronger story of its own.
 */
export function familyOf(input: {
  kind: string;
  /** The composed story's category (src/domain/story#LiveCategory). */
  category?: string | null;
  /**
   * True when the row's classified story is a celebration — a moment rather
   * than a transaction. Set from `isCelebration` (src/domain/conviction-event)
   * for trades, and from the story-event type for market-wide rows.
   */
  celebration?: boolean | null;
  personal?: boolean | null;
}): EventFamily {
  if (input.celebration) return "conviction_celebration";
  switch (input.kind) {
    case "conviction_cohort":
      return "collective_story";
    case "market_transition":
    case "believer_milestone":
    case "tribe_doubled":
    /* PERSISTENCE IS A MARKET READING. "The price fell and the four oldest
       holders didn't move" belongs in the same family as the move itself —
       it competes with change because it is ABOUT change. Only the bare
       receipt ("still here, 31 days") is a relationship story. */
    case "standing_signal":
      return "market_transition";
    case "discovery_moment":
    case "standing_fact":
      return "relationship_story";

    default:
      // A market opening, or a milestone crossed, is a moment however it was
      // recorded — the category says so even when the kind cannot.
      if (input.category === "fresh_market" || input.category === "milestone")
        return "conviction_celebration";
      return input.personal ? "relationship_story" : "live_action";
  }
}
