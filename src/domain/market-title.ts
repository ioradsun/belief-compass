/**
 * THE ONE PLACE A MARKET'S NAME IS DECIDED. Pure, client-safe, no IO.
 *
 * A market title was being resolved at ~15 call sites, each with its own
 * `?? \`Market #${id}\`` fallback and its own idea of what counts as a title.
 * That is how the Now feed shipped rows reading "Market #2380" for markets that
 * have had a perfectly good question in the database the whole time: one broken
 * lookup, fifteen independent fallbacks, and nothing to say the fallback fired.
 *
 * Every surface now goes through `marketTitle()`. The fallback string exists in
 * exactly one place, so it can be recognised, tested, and changed at once.
 */

/** The placeholder shown ONLY when a market genuinely has no readable title. */
export function marketTitleFallback(id: number | string): string {
  return `Market #${id}`;
}

/**
 * The displayable title for a market. Whitespace-only and empty strings are NOT
 * titles — treating them as one is what makes a row render blank instead of
 * falling back — so they resolve to the placeholder like any other absence.
 */
export function marketTitle(raw: string | null | undefined, id: number | string): string {
  const t = typeof raw === "string" ? raw.trim() : "";
  return t || marketTitleFallback(id);
}

/** True when a string is the placeholder rather than a real question. */
export function isFallbackTitle(title: string | null | undefined): boolean {
  return /^Market #\d+$/.test((title ?? "").trim());
}
