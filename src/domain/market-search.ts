/**
 * MARKET SEARCH — intent matching over a small catalog.
 *
 * A searcher types an IDEA, not a title. "gold", "iphone", "work", "smile" must
 * all land on the conversation they mean, even with a typo, a plural, a synonym
 * or the words in a different order. So matching happens on normalised tokens,
 * never on the raw string:
 *
 *   exact phrase  >  whole-word  >  stem  >  prefix  >  synonym  >  near-miss
 *
 * Coverage (how many of the searcher's words the market answers) dominates the
 * score, so a market that speaks to every word beats one that echoes a single
 * word loudly. Momentum only breaks ties — relevance is never bought by volume.
 *
 * ZERO IO, pure, fully testable.
 */

/** Words that carry no intent — dropped from the query and from title tokens. */
const STOP = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "do",
  "does",
  "did",
  "will",
  "would",
  "can",
  "could",
  "should",
  "of",
  "to",
  "in",
  "on",
  "for",
  "and",
  "or",
  "if",
  "it",
  "its",
  "this",
  "that",
  "you",
  "your",
  "i",
  "me",
  "my",
  "we",
  "our",
  "they",
  "them",
  "he",
  "she",
  "at",
  "by",
  "with",
  "as",
  "than",
  "then",
  "there",
  "here",
  "what",
  "who",
  "when",
  "which",
  "how",
  "why",
  "before",
  "after",
  "more",
  "most",
  "less",
  "really",
  "actually",
  "ever",
  "any",
  "about",
]);

/**
 * Concept groups. Any word in a group matches any other word in the group, so
 * "gold" finds a bullion market and "job" finds a market about working.
 */
const CONCEPTS: string[][] = [
  ["bitcoin", "btc", "satoshi"],
  ["ethereum", "eth", "ether"],
  ["crypto", "cryptocurrency", "coin", "token", "memecoin", "altcoin"],
  ["gold", "bullion", "silver", "metal"],
  ["money", "cash", "dollar", "wealth", "rich", "capital", "price", "value"],
  ["iphone", "apple", "ios", "mac"],
  ["android", "samsung", "pixel", "google"],
  ["phone", "mobile", "smartphone", "device"],
  [
    "work",
    "working",
    "job",
    "career",
    "employment",
    "labour",
    "labor",
    "slavery",
    "hustle",
    "9to5",
  ],
  ["office", "remote", "wfh", "commute"],
  ["smile", "smiling", "laugh", "laughing", "happy", "happiness", "joy"],
  ["sad", "depressed", "depression", "lonely", "loneliness"],
  ["ai", "artificial", "intelligence", "llm", "chatgpt", "openai", "robot", "agi"],
  ["car", "auto", "vehicle", "tesla", "ev", "driving"],
  ["love", "romance", "dating", "relationship", "marriage", "partner"],
  ["food", "eating", "diet", "meal", "hungry", "restaurant"],
  ["health", "fitness", "gym", "exercise", "workout", "wellness"],
  ["sleep", "sleeping", "rest", "tired", "insomnia"],
  ["sport", "football", "soccer", "basketball", "nba", "nfl", "athlete"],
  ["politics", "election", "president", "government", "vote", "political"],
  ["music", "song", "artist", "album", "concert"],
  ["movie", "film", "cinema", "hollywood", "show", "series"],
  ["school", "education", "college", "university", "student", "degree", "teacher"],
  ["social", "instagram", "tiktok", "twitter", "influencer", "creator", "content"],
  ["climate", "warming", "environment", "planet", "green"],
  ["god", "religion", "faith", "church", "spiritual", "soul"],
  ["city", "town", "country", "nation", "world"],
  ["kid", "child", "children", "baby", "parent", "family"],
  ["house", "home", "rent", "mortgage", "property", "housing"],
  ["war", "peace", "military", "army", "conflict"],
  ["space", "mars", "moon", "nasa", "rocket", "alien"],
];

const CONCEPT_OF = new Map<string, number>();
CONCEPTS.forEach((group, i) => group.forEach((w) => CONCEPT_OF.set(w, i)));

/** Crude English stem: enough to unify plural/verb forms without a stemmer. */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && (w.endsWith("ses") || w.endsWith("xes") || w.endsWith("ches"))) {
    return w.slice(0, -2);
  }
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  return w;
}

/** Lowercase, strip punctuation, split into meaningful words. */
export function tokenize(s: string, keepStop = false): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && (keepStop || !STOP.has(w)));
}

/**
 * Bounded Damerau-Levenshtein distance (transposition counts as ONE edit, so
 * "bitcion" is one slip from "bitcoin"). Returns `max + 1` once certainly worse.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, i) => i)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, rows[i - 2][j - 2] + 1);
      }
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    rows.push(row);
  }
  return rows[a.length][b.length];
}

/** Typo budget grows with word length; short words must be spelled right. */
const budget = (w: string): number => (w.length >= 8 ? 2 : w.length >= 5 ? 1 : 0);

export interface SearchDoc {
  id: number;
  title: string;
  category?: string | null;
  /** 0–1 momentum/interest weight used only to break relevance ties. */
  interest?: number;
}

export interface SearchScore {
  id: number;
  score: number;
  /** Fraction of the searcher's words this market speaks to, 0–1. */
  coverage: number;
}

interface Prepared {
  doc: SearchDoc;
  title: string;
  words: string[];
  stems: Set<string>;
  concepts: Set<number>;
}

function prepare(doc: SearchDoc): Prepared {
  const words = tokenize(`${doc.title} ${doc.category ?? ""}`);
  const stems = new Set(words.map(stem));
  const concepts = new Set<number>();
  for (const w of words) {
    const c = CONCEPT_OF.get(w) ?? CONCEPT_OF.get(stem(w));
    if (c != null) concepts.add(c);
  }
  return { doc, title: (doc.title || "").toLowerCase(), words, stems, concepts };
}

/** Best score one query word can earn against one market. */
function wordScore(q: string, p: Prepared): number {
  const qs = stem(q);
  if (p.words.includes(q)) return 10;
  if (p.stems.has(qs)) return 9;
  // Prefix / containment: "bitcoi" → "bitcoin", "influenc" → "influencer".
  // Both sides must be substantial — a stray "s" from "U.S." is not a prefix match.
  if (
    q.length >= 3 &&
    p.words.some((w) => w.length >= 4 && (w.startsWith(q) || (q.length >= 4 && q.startsWith(w))))
  )
    return 7;
  if (q.length >= 4 && p.words.some((w) => w.includes(q))) return 6;
  const c = CONCEPT_OF.get(q) ?? CONCEPT_OF.get(qs);
  if (c != null && p.concepts.has(c)) return 5;
  const b = budget(q);
  if (
    b > 0 &&
    p.words.some((w) => Math.abs(w.length - q.length) <= b && editDistance(w, q, b) <= b)
  )
    return 4;
  return 0;
}

/**
 * Rank a catalog against a natural-language query. Results are already sorted:
 * most useful first, momentum only breaking relevance ties.
 */
export function rankMarkets(query: string, docs: SearchDoc[], limit = 8): SearchScore[] {
  const raw = (query || "").trim().toLowerCase();
  if (raw.length < 2) return [];
  let qWords = tokenize(raw);
  // A query made entirely of common words ("do you think") still deserves a search.
  if (qWords.length === 0) qWords = tokenize(raw, true);
  if (qWords.length === 0) return [];

  const out: SearchScore[] = [];
  for (const doc of docs) {
    const p = prepare(doc);
    let sum = 0;
    let matched = 0;
    for (const q of qWords) {
      const s = wordScore(q, p);
      if (s > 0) {
        matched += 1;
        sum += s;
      }
    }
    if (matched === 0) continue;
    const coverage = matched / qWords.length;
    // Coverage dominates: answering every word beats echoing one word loudly.
    let score = sum * (0.35 + 0.65 * coverage) * (0.5 + 0.5 * coverage);
    // The exact phrase, verbatim in the title, is the strongest possible signal.
    if (p.title.includes(raw)) score += 40;
    if (p.title.startsWith(raw)) score += 20;
    // Momentum is a tiebreaker only — never a way to buy relevance.
    score += Math.max(0, Math.min(1, doc.interest ?? 0)) * 3;
    out.push({ id: doc.id, score, coverage });
  }

  out.sort((a, b) => b.score - a.score || b.coverage - a.coverage);
  return out.slice(0, limit);
}
