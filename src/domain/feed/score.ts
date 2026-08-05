/**
 * Feed ranking — one composite score, seven bounded components.
 *
 * Every component is 0..1 and derived from VERIFIED data: live market state, the
 * viewer's own history, and the AI analysis stored once at ingestion. The
 * weighted sum is scaled to 0..100. Nothing here calls a model, reads a clock it
 * wasn't given, or touches IO — so a card's position is always reproducible and
 * explainable (see `diagnostics`).
 */
import {
  WEIGHTS,
  MOMENTUM_CAPS,
  FRESHNESS,
  FOLLOWS,
  ORIGIN,
  clamp01,
  sat,
  type ScoreComponent,
} from "./config";

/** Live, continuously-updated market signals (never AI). */
export interface FeedMarketSignals {
  onchainId: number;
  category: string | null;
  creator: string | null;
  createdAt: string | null;
  newBelievers1h: number;
  newBelievers24h: number;
  tradeCount1h: number;
  tradeCount24h: number;
  uniqueWallets1h: number;
  uniqueWallets24h: number;
  velocity5m: number;
  volumeUsd24h: number;
  directionalBelievers: number;
  divergence: number;
  /** Absolute % price move over the active window. */
  priceMovePct: number;
  opportunityType: string | null;
  opportunityReason: string | null;
  opportunityScore: number | null;
  opportunityEligible: boolean;
  tribeSide: "YES" | "NO" | null;
  oppSide: "YES" | "NO" | null;
  /**
   * How many of the viewer's aligned / opposed people hold a side here.
   *
   * Zero when the viewer has no DNA yet, which is most viewers — so nothing
   * that reads these may require them. They sharpen a sentence the side alone
   * could already carry; they never gate it.
   */
  tribeCount: number;
  oppCount: number;
  /**
   * People the viewer explicitly follows who are connected to this market —
   * whether they created it or took a side in it.
   *
   * ONE number, not two. A person is a connection, and whether they wrote the
   * question or backed it is a ranking detail the interface never surfaces. The
   * count is of DISTINCT people, so a market cannot look crowded because one
   * follower did several things in it.
   */
  followedHere: number;
  /**
   * People who hold a side BOTH here and in the market the viewer arrived from
   * — the one they opened out of search, a Live row or a position, rather than
   * by walking the queue.
   *
   * This is what makes search an entry point into the network instead of a
   * lookup that ends when the result opens: the people in the market you went
   * looking for shape what the queue offers next. Zero when there is no origin,
   * which is the ordinary case of reading straight down the feed.
   */
  connectedToOrigin: number;
  hasMedia: boolean;
}

/** Stored, versioned AI meaning. Absent until the background job analyses it. */
export interface FeedAiAnalysis {
  category?: string | null;
  topic?: string | null;
  summary?: string | null;
  clarity?: number | null;
  answerability?: number | null;
  novelty?: number | null;
  debate?: number | null;
  identity?: number | null;
  timeSensitivity?: number | null;
  mediaRelevance?: number | null;
  quality?: number | null;
  riskFlags?: string[];
  embedding?: number[] | null;
  duplicateClusterId?: string | null;
  duplicateSimilarity?: number | null;
}

/** The viewer's real, already-computed history. */
export interface ViewerProfile {
  categoryAffinity: Record<string, number>;
  topicAffinity: Record<string, number>;
  creatorAffinity: Record<string, number>;
  /** Mean embedding of the markets this person actually acted on. */
  tasteEmbedding: number[] | null;
  /** Market ids this wallet has never been shown before. */
  neverShown: ReadonlySet<number>;
}

export const EMPTY_PROFILE: ViewerProfile = {
  categoryAffinity: {},
  topicAffinity: {},
  creatorAffinity: {},
  tasteEmbedding: null,
  neverShown: new Set(),
};

export type Components = Record<ScoreComponent, number>;

export interface ScoredMarket {
  onchainId: number;
  score: number;
  components: Components;
  /** The dominant component — drives which reason the card shows. */
  driver: ScoreComponent;
  acceleration: number;
  ageHours: number | null;
}

export function cosine(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na <= 0 || nb <= 0) return 0;
  return clamp01(dot / Math.sqrt(na * nb));
}

export function ageHoursOf(createdAt: string | null, now: number): number | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / 3_600_000);
}

/**
 * Recent rate ÷ its own baseline — acceleration, not size. This is the ONE
 * baseline definition (normal = the market's own 24h trade rate); every surface
 * that needs "× normal" must call this rather than re-deriving a second baseline.
 *
 * `velocity5m` extrapolates a five-minute tick into an hourly rate, and it goes
 * stale: on a market with NO trades in the last hour it kept claiming 12/hr and
 * so "24× normal" on a book where nothing had happened. Trades in the last hour
 * are the ground truth — with none, acceleration is zero, whatever the tick says.
 */
export function accelerationFrom(
  tradeCount1h: number,
  tradeCount24h: number,
  velocity5m: number,
): number {
  if (tradeCount1h <= 0) return 0;
  const baseline = Math.max(0.5, tradeCount24h / 24);
  const recent = Math.max(tradeCount1h, velocity5m * 12);
  return Math.min(MOMENTUM_CAPS.ACCELERATION, recent / baseline);
}

/** Recent rate ÷ its own baseline. Acceleration, not size. */
export function accelerationOf(s: FeedMarketSignals): number {
  return accelerationFrom(s.tradeCount1h, s.tradeCount24h, s.velocity5m);
}

function momentum(s: FeedMarketSignals): number {
  const accel = accelerationOf(s) / MOMENTUM_CAPS.ACCELERATION;
  return clamp01(
    0.35 * accel +
      0.25 * sat(s.newBelievers1h, MOMENTUM_CAPS.NEW_BELIEVERS_1H) +
      0.2 * sat(s.tradeCount1h, MOMENTUM_CAPS.TRADES_1H) +
      0.1 * sat(s.velocity5m, MOMENTUM_CAPS.VELOCITY_5M) +
      0.1 * sat(s.volumeUsd24h, MOMENTUM_CAPS.VOLUME_USD_24H),
  );
}

function personal(s: FeedMarketSignals, ai: FeedAiAnalysis | undefined, v: ViewerProfile): number {
  const cat = s.category ?? ai?.category ?? null;
  const catAff = cat ? clamp01(v.categoryAffinity[cat] ?? 0) : 0;
  const topic = ai?.topic ?? null;
  const topicAff = topic ? clamp01(v.topicAffinity[topic] ?? 0) : 0;
  const creatorAff = s.creator ? clamp01(v.creatorAffinity[s.creator.toLowerCase()] ?? 0) : 0;
  const semantic = cosine(v.tasteEmbedding, ai?.embedding ?? null);
  // A follow belongs here as much as in `socialSignal`: it is the DELIBERATE
  // version of `creatorAffinity` two lines up — that measures whose markets you
  // ended up trading, this records whose you said you wanted. Tribe and Rival
  // are already counted in both components, so leaving follows out of this one
  // would have made an explicit choice permanently weaker than an inference.
  const social = s.followedHere > 0 ? 0.8 : s.tribeSide ? 0.6 : s.oppSide ? 0.4 : 0;
  return clamp01(
    0.3 * catAff + 0.2 * topicAff + 0.15 * creatorAff + 0.2 * semantic + 0.15 * social,
  );
}

function freshness(s: FeedMarketSignals, v: ViewerProfile, now: number): number {
  const age = ageHoursOf(s.createdAt, now);
  const unseen = v.neverShown.has(s.onchainId) ? 0.35 : 0;
  let byAge = 0;
  if (age != null) {
    if (age <= FRESHNESS.BRAND_NEW_HOURS) byAge = 0.65;
    else if (age <= FRESHNESS.NEW_HOURS)
      byAge =
        0.65 *
        (1 - (age - FRESHNESS.BRAND_NEW_HOURS) / (FRESHNESS.NEW_HOURS - FRESHNESS.BRAND_NEW_HOURS));
  }
  return clamp01(unseen + byAge);
}

/**
 * FOLLOWS AND INFERRED RELATIONSHIPS SIT IN THE SAME BAND, on purpose.
 *
 * The tempting claim is that choosing beats inferring, so a follow should
 * outrank a Tribe. It should not, and the measured gradient is better: ONE
 * follow is a cheap gesture and scores below a Tribe relationship, which the
 * DNA engine only asserts after real agreement across real markets. SEVERAL
 * followed people in one market scores above it — that is no longer a gesture,
 * it is the viewer's corner of the platform.
 *
 * `sat` rather than a linear count, so the fourth follower adds less than the
 * first. Otherwise one prolific creator would own the feed of everyone who
 * followed them.
 *
 * Either way this is one term of two components, so a followed market rises and
 * never excludes anything. Following is not a filter.
 */
function socialSignal(s: FeedMarketSignals): number {
  const split = clamp01(1 - Math.abs(0.5 - clamp01(0.5 + s.divergence / 2)) * 2);
  return clamp01(
    (s.followedHere > 0 ? 0.45 * sat(s.followedHere, FOLLOWS.SATURATE_AT) : 0) +
      (s.tribeSide ? 0.4 : 0) +
      (s.oppSide ? 0.3 : 0) +
      // The people in the market you arrived at, still connected. Deliberately
      // the smallest term here: a shared participant is the weakest of these
      // claims — they are not yours, and one overlapping stranger is a
      // coincidence — but it is what carries a search into the queue rather
      // than letting the thread end when the result opens.
      (s.connectedToOrigin > 0 ? 0.25 * sat(s.connectedToOrigin, ORIGIN.SATURATE_AT) : 0) +
      0.2 * sat(s.newBelievers24h, 25) +
      0.1 * split,
  );
}

function quality(ai: FeedAiAnalysis | undefined, s: FeedMarketSignals): number {
  if (!ai || ai.quality == null) {
    // No stored analysis yet: stay neutral rather than punishing a new market.
    return s.hasMedia ? 0.55 : 0.5;
  }
  const risk = (ai.riskFlags?.length ?? 0) > 0 ? 0.4 : 0;
  const dupe = clamp01(Number(ai.duplicateSimilarity ?? 0));
  const base =
    0.3 * clamp01(Number(ai.quality ?? 0)) +
    0.2 * clamp01(Number(ai.clarity ?? 0)) +
    0.2 * clamp01(Number(ai.answerability ?? 0)) +
    0.15 * clamp01(Number(ai.debate ?? 0)) +
    0.15 * clamp01(Number(ai.novelty ?? 0));
  return clamp01(base * (1 - risk) * (1 - 0.5 * dupe));
}

function early(s: FeedMarketSignals): number {
  // Small books only score when the acceleration is real — not every quiet
  // market is an "early opportunity".
  const small = clamp01(1 - sat(s.directionalBelievers, 40));
  const credible = clamp01((accelerationOf(s) - 1) / 2) * clamp01(sat(s.uniqueWallets1h, 6));
  return clamp01(small * credible);
}

/** Deterministic 0..1 hash — stable exploration picks across SSR and client. */
export function stableNoise(id: number, salt: number): number {
  let x = (id * 2654435761 + salt * 40503) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822507) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

function exploration(
  s: FeedMarketSignals,
  ai: FeedAiAnalysis | undefined,
  v: ViewerProfile,
  q: number,
  epoch: number,
): number {
  const cat = s.category ?? ai?.category ?? null;
  const known = cat ? clamp01(v.categoryAffinity[cat] ?? 0) : 0;
  // Strong markets OUTSIDE the usual interests, chosen deterministically.
  return clamp01((1 - known) * q * stableNoise(s.onchainId, epoch));
}

export interface ScoreInput {
  signals: FeedMarketSignals;
  ai?: FeedAiAnalysis | undefined;
  viewer?: ViewerProfile;
  now?: number;
  /** Rotates the exploration pick without shuffling the rest of the feed. */
  epoch?: number;
}

export function scoreMarket(input: ScoreInput): ScoredMarket {
  const s = input.signals;
  const ai = input.ai;
  const v = input.viewer ?? EMPTY_PROFILE;
  const now = input.now ?? Date.now();
  const q = quality(ai, s);

  const components: Components = {
    momentum: momentum(s),
    personal: personal(s, ai, v),
    freshness: freshness(s, v, now),
    social: socialSignal(s),
    quality: q,
    early: early(s),
    exploration: exploration(s, ai, v, q, input.epoch ?? 0),
  };

  let total = 0;
  let driver: ScoreComponent = "momentum";
  let best = -1;
  for (const key of Object.keys(WEIGHTS) as ScoreComponent[]) {
    const contribution = WEIGHTS[key] * components[key];
    total += contribution;
    if (contribution > best) {
      best = contribution;
      driver = key;
    }
  }

  return {
    onchainId: s.onchainId,
    score: Math.round(clamp01(total) * 1000) / 10,
    components,
    driver,
    acceleration: accelerationOf(s),
    ageHours: ageHoursOf(s.createdAt, now),
  };
}
