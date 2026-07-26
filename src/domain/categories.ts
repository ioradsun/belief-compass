/**
 * Conviction DNA v2 — canonical POV-slug → domain map.
 * FROZEN. To reclassify, bump DOMAIN_MAP_VERSION and re-persist markets.
 *
 * We keep the 9 spec domains as spokes, but only ones with a POV mapping
 * are ever populated from data; the rest render as honest missing spokes.
 */

export const DOMAIN_MAP_VERSION = 1;

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

// POV categorySlug → domain. Unknown slugs → null (missing spoke).
const POV_TO_DOMAIN: Record<string, Domain> = {
  crypto: "Money",
  defi: "Money",
  ai: "Technology",
  politics: "Politics",
  culture: "Entertainment",
  sports: "Entertainment",
  // "other" and unknown → null
};

export function categoryToDomain(category: string | null | undefined): Domain | null {
  if (!category) return null;
  return POV_TO_DOMAIN[category.toLowerCase()] ?? null;
}
