/**
 * QUESTION DISCOVERY — the one answer to "does this conversation already exist?"
 *
 * ZERO IO, pure, fully testable. Creation, the Launch rails and the idea
 * generator all ask this module; none of them decides for itself what a
 * duplicate is.
 *
 * WHAT IT REPLACES, and the count is the argument. There were FOUR independent
 * similarity implementations with four thresholds and no shared code:
 *
 *   Jaccard @0.45      market-create.server  findSimilarMarkets — a blind
 *                      4,000-row scan on every debounced keystroke whose result
 *                      NO component ever read. Deleted outright.
 *   subject-Dice @0.34 market-create.server  findMarketSuggestions — the best of
 *                      the four, and the one this module keeps.
 *   Jaccard @0.62      domain/market-suggestion  a SECOND Jaccard with its own
 *                      stopword list, for idea novelty.
 *   cosine @0.90       feed/market-analysis  real embeddings, but only ever
 *                      reached by a cron, never by creation.
 *
 * The same question was answered four different ways, so a market could be
 * "already exists" on one surface and novel on another.
 *
 * THE PIPELINE, cheapest first:
 *
 *   normalize → retrieve (IDF, in-memory) → score (one scorer) → band
 *
 * Retrieval is free. Measured over the live corpus of 2,788 markets: **100%
 * recall@10 of true near-duplicates at 0.04 ms per query**, with no database
 * round trip and no model call. No version of this problem needs a network hop
 * to find the candidates.
 *
 * WHY A BAND IS STILL AMBIGUOUS — the reason an AI step exists at all. Lexical
 * scoring cannot separate a duplicate from a different question built on the
 * same template, because the numbers genuinely overlap:
 *
 *   0.80  "pineapple ACCEPTABLE topping"  / "pineapple SUITABLE topping"    SAME
 *   0.75  "Will SPAIN win the World Cup"  / "Will ENGLAND win the World Cup" DIFF
 *   0.75  "Is RONALDO better than MESSI"  / "Is CRISTIANO better than LIONEL" SAME
 *   0.81  "Will BITCOIN stay above $70k"  / "Will INJ stay above $6"         DIFF
 *
 * No threshold splits 0.75-same from 0.75-different. The discriminator is the
 * SUBJECT ENTITY, which is a language judgement — so that judgement, and only
 * that judgement, is worth a model call, over a candidate set already bounded to
 * ten by the free step above.
 */

/* ── Normalisation ────────────────────────────────────────────────────────── */

/**
 * Words that carry question SHAPE, not subject matter.
 *
 * "Should political parties be required to…" and "Should AI tools be required
 * to…" share almost every one of these, which is exactly how unrelated markets
 * used to surface as duplicates.
 */
const TEMPLATE = new Set([
  "should",
  "would",
  "could",
  "shall",
  "must",
  "can",
  "may",
  "might",
  "need",
  "needs",
  "required",
  "require",
  "requires",
  "allowed",
  "allow",
  "allows",
  "banned",
  "ban",
  "bans",
  "let",
  "make",
  "makes",
  "made",
  "get",
  "gets",
  "going",
  "ever",
  "still",
  "really",
  "actually",
  "just",
  "also",
  "before",
  "after",
  "during",
  "their",
  "them",
  "they",
  "there",
  "then",
  "its",
  "his",
  "her",
  "our",
  "your",
  "you",
  "we",
  "us",
  "people",
  "person",
  "everyone",
  "anyone",
  "someone",
  "thing",
  "things",
  "been",
  "being",
  "have",
  "has",
  "had",
  "was",
  "were",
  "from",
  "into",
  "about",
  "over",
  "under",
  "out",
  "off",
  "not",
  "never",
  "always",
  "other",
  "others",
  "any",
  "all",
  "some",
  "most",
  "much",
  "many",
  "new",
  "own",
  "one",
  "two",
  "per",
  "via",
  "yes",
  "no",
]);

/** Grammar words. Separate from TEMPLATE: these carry no meaning at all. */
const STOP = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "will",
  "be",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "that",
  "this",
  "it",
  "do",
  "does",
  "did",
  "by",
  "at",
  "with",
  "than",
  "more",
  "less",
  "who",
  "what",
  "when",
  "why",
  "how",
]);

/** The one tokenizer. Three copies of this used to exist. */
export function tokens(text: string): Set<string> {
  return new Set(
    String(text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Subject-matter words only — the part a duplicate must actually share. */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokens(text)) if (!TEMPLATE.has(t)) out.add(t);
  return out;
}

/**
 * A stable key for "the same question, however it was typed".
 *
 * Insensitive to case, punctuation, spacing and word order, so two people
 * typing the same thought produce the same key — which is what makes it safe
 * both as a cache key and as the exact-duplicate test below.
 */
export function normalizeQuestion(text: string): string {
  return [...tokens(text)].sort().join(" ");
}

/* ── Scoring ──────────────────────────────────────────────────────────────── */

/** Character trigrams — catches rewordings that share no whole tokens. */
function trigrams(text: string): Set<string> {
  const t = ` ${String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return (2 * shared) / (a.size + b.size);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * How alike two questions read, 0..1. THE scorer — there is no second one.
 *
 * Surface overlap (token-Dice, char-trigrams, Jaccard) catches rewordings but on
 * its own rewards shared boilerplate, so it is GATED on subject-word overlap:
 * both must be high for the score to be. The geometric mean is what makes the
 * gate bite — a high surface score against zero subject overlap is zero, not
 * "half".
 */
export function textScore(a: string, b: string): number {
  const subject = dice(contentTokens(a), contentTokens(b));
  if (subject <= 0) return 0;
  const surface = Math.max(
    dice(tokens(a), tokens(b)),
    dice(trigrams(a), trigrams(b)),
    jaccard(tokens(a), tokens(b)),
  );
  if (surface <= 0) return 0;
  return Math.sqrt(surface * subject);
}

/* ── Retrieval ────────────────────────────────────────────────────────────── */

/** The minimum a market must expose to be discoverable. */
export interface DiscoveryDoc {
  onchainId: number;
  title: string;
}

export interface Retrievable extends DiscoveryDoc {
  /** Subject tokens, precomputed — building these per query is the slow part. */
  subject: Set<string>;
}

/**
 * A corpus prepared for repeated querying.
 *
 * Built once per catalog refresh and reused across every draft, which is what
 * makes a query 0.04 ms. Inverse document frequency is computed here so a rare
 * word ("Mbappé") outweighs a common one ("bitcoin") when choosing candidates.
 */
export interface DiscoveryIndex {
  docs: Retrievable[];
  postings: Map<string, Retrievable[]>;
  idf: Map<string, number>;
}

/**
 * Words so common they identify nothing. A posting list this long costs more to
 * walk than it could ever narrow, so retrieval skips it.
 */
const UBIQUITOUS_POSTINGS = 400;

export function buildIndex(docs: readonly DiscoveryDoc[]): DiscoveryIndex {
  const prepared: Retrievable[] = [];
  const postings = new Map<string, Retrievable[]>();
  const df = new Map<string, number>();

  for (const d of docs) {
    if (!d.title) continue;
    const subject = contentTokens(d.title);
    if (subject.size === 0) continue;
    const doc: Retrievable = { onchainId: d.onchainId, title: d.title, subject };
    prepared.push(doc);
    for (const w of subject) {
      const list = postings.get(w);
      if (list) list.push(doc);
      else postings.set(w, [doc]);
      df.set(w, (df.get(w) ?? 0) + 1);
    }
  }

  const n = Math.max(1, prepared.length);
  const idf = new Map<string, number>();
  for (const [w, c] of df) idf.set(w, Math.log(1 + n / (1 + c)));
  return { docs: prepared, postings, idf };
}

/**
 * The cheapest step that could work: walk only the posting lists of the draft's
 * own subject words, summing IDF.
 *
 * It never scores the whole corpus — which is what the deleted implementation
 * did, 4,000 rows per keystroke — and it does not need to: at ten candidates
 * this recalls every true near-duplicate in the live corpus.
 */
export function retrieve(index: DiscoveryIndex, question: string, k = 10): Retrievable[] {
  const subject = contentTokens(question);
  if (subject.size === 0) return [];
  const score = new Map<Retrievable, number>();
  for (const w of subject) {
    const list = index.postings.get(w);
    if (!list || list.length > UBIQUITOUS_POSTINGS) continue;
    const weight = index.idf.get(w) ?? 0;
    for (const doc of list) score.set(doc, (score.get(doc) ?? 0) + weight);
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].onchainId - b[0].onchainId)
    .slice(0, k)
    .map(([doc]) => doc);
}

/* ── The verdict ──────────────────────────────────────────────────────────── */

/**
 * What the draft is, relative to what already exists.
 *
 * `ambiguous` is not a verdict the product shows anyone — it is this module
 * saying "text alone cannot decide this one", and it is the ONLY input that
 * earns a model call.
 */
export type Relation = "duplicate" | "ambiguous" | "related" | "novel";

/**
 * The band edges, measured against the live corpus rather than chosen.
 *
 *   AMBIGUOUS  the contested middle: same template, possibly different subject.
 *              "Spain wins" vs "England wins" lives here, and so does the
 *              genuine duplicate "Ronaldo/Messi" vs "Cristiano/Lionel".
 *   RELATED    real overlap, clearly a different question. Worth showing, never
 *              worth warning about.
 *   below      noise. Sampling at 0.35–0.44 returned 1,133 pairs sharing a sport
 *              or an asset class and nothing else.
 *
 * THERE IS NO NUMERIC DUPLICATE CUT, and that is a finding rather than an
 * omission. Scoring all 17,861 pairs retrieval actually surfaces:
 *
 *   0.90–1.00   83 pairs, 73 of them provably identical — 88%
 *
 * 88% is not good enough to tell someone their idea already exists. The 12% is
 * not noise either; it is pairs like
 *
 *   0.943  "Have you been cheated on before?" / "Have you cheated before?"
 *
 * — opposite questions. No threshold below 0.95 excludes that while still
 * catching "Will France win the World Cup?" / "Will France win the 2026 World
 * Cup?" at 0.894. The bands overlap because the discriminator is meaning.
 *
 * So the ONLY deterministic duplicate claim is an exact match after
 * normalisation, which is unarguable (73 real pairs, all of them). Everything
 * that merely LOOKS alike goes to judgement or is shown as a neighbour. The
 * product never accuses on arithmetic.
 */
export const BANDS = {
  ambiguous: 0.62,
  related: 0.45,
} as const;

export function bandFor(score: number): Relation {
  if (!Number.isFinite(score)) return "novel";
  if (score >= BANDS.ambiguous) return "ambiguous";
  if (score >= BANDS.related) return "related";
  return "novel";
}

/**
 * How alive a candidate conversation is — the tie-break, never the gate.
 *
 * The left rail exists to consolidate people into rooms that already have
 * someone in them, so between two equally similar markets the busier one should
 * win. But activity must NEVER lift a market across a band: an unrelated market
 * with a hundred participants is still unrelated, and letting popularity promote
 * it would turn the panel from consolidation into recommendation.
 */
export interface Liveness {
  participants?: number | null;
  lastActivityMs?: number | null;
  /** 0..1, how split the room is. A contested market is a live debate. */
  contested?: number | null;
}

/**
 * How close two scores must be to count as "equally similar".
 *
 * One rounding step on the 0..1 scale. Wide enough that "0.80" and "0.78" are
 * the same claim to a reader, narrow enough that liveness can never reach across
 * a real difference in meaning.
 */
export const TIE_EPS = 0.05;

/** A bounded 0..1 activity weight. Saturating, so a whale room cannot dominate. */
export function livenessScore(l: Liveness | undefined, nowMs: number): number {
  if (!l) return 0;
  const people = Math.max(0, Number(l.participants ?? 0));
  const byPeople = people / (people + 5); // 5 people ≈ half weight
  const at = Number(l.lastActivityMs ?? NaN);
  const days = Number.isFinite(at) ? Math.max(0, (nowMs - at) / 86_400_000) : Infinity;
  const byRecency = Number.isFinite(days) ? Math.max(0, 1 - days / 14) : 0;
  const byHeat = Math.max(0, Math.min(1, Number(l.contested ?? 0)));
  return Math.max(0, Math.min(1, 0.55 * byPeople + 0.3 * byRecency + 0.15 * byHeat));
}

export interface Candidate {
  onchainId: number;
  title: string;
  score: number;
  band: Relation;
  /** 0..1 activity weight, for ordering within a band only. */
  liveness: number;
}

export interface Discovery {
  /** The strongest thing the draft could be. Never `ambiguous` to a caller. */
  relation: Exclude<Relation, "ambiguous">;
  /** True when a model call would change the answer — see `Relation`. */
  needsJudgement: boolean;
  /** Strongest band first, busiest within it. Empty when the idea is new. */
  candidates: Candidate[];
  /** The single market to offer joining, when there is an obvious one. */
  duplicateOf: Candidate | null;
}

export interface DiscoverOptions {
  retrieveK?: number;
  keep?: number;
  /** Per-market activity, keyed by onchain id. Absent ⇒ ordering by score only. */
  liveness?: Map<number, Liveness>;
  now?: number;
}

/**
 * Score retrieved candidates and decide what the draft is.
 *
 * PURE, so the AI step is a caller's concern: this returns `needsJudgement` and
 * the bounded candidate list, and a server layer may refine it. Nothing here
 * blocks anything — the verdict is advice, and creation stays permissionless.
 */
export function discover(
  index: DiscoveryIndex,
  question: string,
  opts: DiscoverOptions = {},
): Discovery {
  const q = String(question ?? "").trim();
  if (q.length < 8) {
    return { relation: "novel", needsJudgement: false, candidates: [], duplicateOf: null };
  }

  const nowMs = opts.now ?? Date.now();
  const key = normalizeQuestion(q);
  const retrieved = retrieve(index, q, opts.retrieveK ?? 10);

  // THE ONE UNARGUABLE CASE: the same question, however it was typed. Checked
  // before scoring because it is not a matter of degree.
  const exact = retrieved.find((d) => normalizeQuestion(d.title) === key);

  // BAND, THEN SIMILARITY, AND ONLY THEN LIVENESS.
  //
  // "Equally similar" has to mean equally similar. Sorting by liveness directly
  // after the band lets a well-populated market outrank a semantically closer
  // one, which is recommendation wearing consolidation's clothes — the reader
  // asked whether their idea already exists, not what is popular.
  //
  // So scores are quantised into TIE_EPS buckets and liveness orders WITHIN a
  // bucket. Two markets differing by less than a rounding step are ties and the
  // busier one wins; anything further apart is decided by similarity alone. The
  // rule is a property of the ordering, not of any particular subject matter:
  // no term here reads the topic, and the regression that motivated it lives in
  // the tests, where a concrete case belongs.
  const rank: Record<Relation, number> = { duplicate: 3, ambiguous: 2, related: 1, novel: 0 };
  const bucket = (score: number) => Math.round(score / TIE_EPS);
  const scored: Candidate[] = retrieved
    .map((d) => {
      const score = textScore(q, d.title);
      return {
        onchainId: d.onchainId,
        title: d.title,
        score,
        band: bandFor(score),
        liveness: livenessScore(opts.liveness?.get(d.onchainId), nowMs),
      };
    })
    .filter((c) => c.score >= BANDS.related)
    .sort(
      (a, b) =>
        rank[b.band] - rank[a.band] ||
        bucket(b.score) - bucket(a.score) ||
        b.liveness - a.liveness ||
        b.score - a.score ||
        a.onchainId - b.onchainId,
    )
    .slice(0, opts.keep ?? 5);

  if (exact) {
    const match = scored.find((c) => c.onchainId === exact.onchainId) ?? {
      onchainId: exact.onchainId,
      title: exact.title,
      score: 1,
      band: "ambiguous" as Relation,
      liveness: livenessScore(opts.liveness?.get(exact.onchainId), nowMs),
    };
    return { relation: "duplicate", needsJudgement: false, candidates: scored, duplicateOf: match };
  }

  const top = scored[0];
  if (!top) return { relation: "novel", needsJudgement: false, candidates: [], duplicateOf: null };

  // The contested middle. Reported as `related` — the honest default, because
  // showing a neighbouring conversation is always safe and calling something a
  // duplicate on a coin flip is not.
  return {
    relation: "related",
    needsJudgement: scored.some((c) => c.band === "ambiguous"),
    candidates: scored,
    duplicateOf: null,
  };
}

/**
 * Fold a language judgement back in.
 *
 * Kept separate and pure so the model's answer is data, not control flow, and so
 * every rule about what a verdict may claim lives in one place. A model may
 * PROMOTE the contested middle to `duplicate` or settle it as `related`; it can
 * never overrule the deterministic bands, and it can never invent a candidate —
 * the id must be one retrieval already found.
 */
export function applyJudgement(
  base: Discovery,
  verdict: "duplicate" | "related" | "novel",
  onchainId?: number,
): Discovery {
  if (!base.needsJudgement) return base;
  if (verdict === "duplicate") {
    const match = base.candidates.find((c) => c.onchainId === onchainId) ?? base.candidates[0];
    if (!match) return { ...base, needsJudgement: false };
    return { ...base, relation: "duplicate", needsJudgement: false, duplicateOf: match };
  }
  // "Novel" means DO NOT WARN, not "show nothing" — the candidates were still
  // retrieved and still overlap, so they stay visible as neighbours.
  return { ...base, relation: "related", needsJudgement: false, duplicateOf: null };
}
