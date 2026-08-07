/**
 * THE CATEGORY VOCABULARY — one list, client-safe, that everything writes and
 * everything reads.
 *
 * WHAT WAS WRONG, and it was a vocabulary split rather than a missing feature.
 * Two lists described the same idea and never met:
 *
 *   • `markets.category` holds LOWERCASE SLUGS, written by the POV importer —
 *     sports · crypto · culture · politics · other · ai · defi.
 *   • `CATEGORIES` in `market-create.server.ts` held TITLE-CASE NAMES, which the
 *     AI reviewer was told to pick from and the creation path stored —
 *     Relationships · Money · Technology · …
 *
 * `categoryToDomain` only understood the first list, so anything written by the
 * second resolved to `null`. Measured on production: 2,453 of 2,789 markets
 * resolve; every one of the misses is a market this app created itself. There is
 * exactly one such market today, categorised `Society`, and its DNA domain is
 * nothing. Every market created from here would have joined it.
 *
 * WHY EXTENDING THE SLUGS IS THE FIX rather than picking a winner. The two lists
 * disagree about more than spelling. POV's seven describe an asset feed; the
 * ten describe opinions — Relationships, Morality, Health are exactly what this
 * product asks about, and collapsing them into `other` (already the fate of 308
 * markets) would throw away the distinction the DNA domain map exists to read.
 * Rewriting POV's rows is not an option either: the importer keeps writing them.
 *
 * So the slug space is EXTENDED. POV's seven stay valid and untouched, the
 * opinion categories join them as slugs in the same shape, and the read map
 * covers all of them. Existing rows keep their meaning, new rows gain one, and
 * no migration is needed.
 *
 * THE INVARIANT: `CATEGORY_TO_DOMAIN` is declared `Record<CategorySlug, …>`, so
 * a slug added without a domain is a type error rather than a silent `null`.
 */

export const DOMAIN_MAP_VERSION = 1;

/**
 * The nine DNA spokes. FROZEN — to reclassify, bump DOMAIN_MAP_VERSION and
 * re-persist markets. This is what a person's belief profile is drawn from; it
 * is deliberately coarser than the slugs, which are what gets stored.
 */
export const DOMAINS = [
  "Relationships",
  "Money",
  "Technology",
  "Society",
  "Human Nature",
  "Politics",
  "Morality",
  "Health",
  "Entertainment",
] as const;
export type Domain = (typeof DOMAINS)[number];

/**
 * Every slug that may appear in `markets.category`, in either origin. The first
 * seven are POV's and are written by the importer; the rest are this app's and
 * are written by a creator or by the AI reviewer.
 */
export const CATEGORY_SLUGS = [
  // POV — read-only as far as we are concerned.
  "crypto",
  "defi",
  "ai",
  "culture",
  "sports",
  // Shared: POV writes these too, and the picker offers them.
  "politics",
  "other",
  // Opinion categories. POV has no equivalent; these are why the split mattered.
  "relationships",
  "money",
  "technology",
  "society",
  "human-nature",
  "morality",
  "health",
  "entertainment",
] as const;
export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

/**
 * Slug → DNA spoke. Total by construction: adding a slug above without a domain
 * here will not compile, which is the whole point — the previous map was
 * partial and the misses were invisible.
 *
 * `other` is honestly null. A market nobody could place should widen no spoke.
 */
export const CATEGORY_TO_DOMAIN: Record<CategorySlug, Domain | null> = {
  crypto: "Money",
  defi: "Money",
  money: "Money",
  ai: "Technology",
  technology: "Technology",
  politics: "Politics",
  culture: "Entertainment",
  sports: "Entertainment",
  entertainment: "Entertainment",
  relationships: "Relationships",
  society: "Society",
  "human-nature": "Human Nature",
  morality: "Morality",
  health: "Health",
  other: null,
};

/** How a slug is shown to a person. Never render the slug itself. */
export const CATEGORY_LABEL: Record<CategorySlug, string> = {
  crypto: "Crypto",
  defi: "DeFi",
  money: "Money",
  ai: "AI",
  technology: "Technology",
  politics: "Politics",
  culture: "Culture",
  sports: "Sports",
  entertainment: "Entertainment",
  relationships: "Relationships",
  society: "Society",
  "human-nature": "Human Nature",
  morality: "Morality",
  health: "Health",
  other: "Other",
};

/**
 * What a creator may choose, in the order the picker shows them.
 *
 * Deliberately NOT the full slug list. POV's `crypto`/`defi`/`ai`/`culture`
 * remain readable forever, but offering both "Crypto" and "Money" would ask a
 * creator to resolve an ambiguity that exists only for historical reasons. The
 * picker offers one slug per spoke, and `other` last as the honest escape.
 */
export const CREATOR_CATEGORIES: readonly CategorySlug[] = [
  "relationships",
  "money",
  "technology",
  "society",
  "human-nature",
  "politics",
  "morality",
  "health",
  "entertainment",
  "other",
] as const;

const BY_LOOSE_KEY = new Map<string, CategorySlug>();
for (const slug of CATEGORY_SLUGS) {
  const loose = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  BY_LOOSE_KEY.set(loose(slug), slug);
  BY_LOOSE_KEY.set(loose(CATEGORY_LABEL[slug]), slug);
}

/**
 * Anything category-shaped → a slug, or null if it names nothing we know.
 *
 * Tolerant on the way in on purpose. It has to accept the slug itself, the
 * display label, and the TITLE-CASE names the old `CATEGORIES` list used — the
 * AI has been answering in that vocabulary and one production row is stored in
 * it, so "Human Nature" and "human-nature" must land on the same slug rather
 * than one of them landing nowhere.
 */
export function normalizeCategory(raw: string | null | undefined): CategorySlug | null {
  if (!raw) return null;
  return BY_LOOSE_KEY.get(raw.toLowerCase().replace(/[^a-z]/g, "")) ?? null;
}

/** A slug's DNA spoke, for anything category-shaped. Unknown → null. */
export function categoryToDomain(category: string | null | undefined): Domain | null {
  const slug = normalizeCategory(category);
  return slug ? CATEGORY_TO_DOMAIN[slug] : null;
}

/** A slug's display label, for anything category-shaped. Unknown → null. */
export function categoryLabel(category: string | null | undefined): string | null {
  const slug = normalizeCategory(category);
  return slug ? CATEGORY_LABEL[slug] : null;
}
