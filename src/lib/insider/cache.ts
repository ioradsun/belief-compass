/**
 * THE SHARED TAPE IS ONE ANSWER, NOT ONE PER READER.
 *
 * The unscoped, signed-out tape is identical for every visitor, and building it
 * is several reads plus the whole grammar pass. Cached under one key it is
 * built once per window and handed to everyone else — which is what lets SSR
 * peek at it (see `getWarmTape`) and the phone paint the Insider on arrival
 * instead of waiting a round trip for it.
 *
 * A wallet, a market scope, a side or a delta `since` is a DIFFERENT question
 * and never touches this cache.
 */
import type { TapeInput } from "@/lib/insider/build.server";

export const TAPE_KEY = "tape:anon";
export const TAPE_TTL_MS = 10_000;

/** The one question every reader shares: no wallet, no scope, no side, no delta. */
export function isSharedTape(data: TapeInput): boolean {
  return !data?.wallet && !data?.marketIds?.length && !data?.side && !data?.since;
}

/** One cache entry per window size, so a 60-row ask cannot poison the 120-row tape. */
export function tapeCacheKey(limit: number | undefined): string {
  return `${TAPE_KEY}:${limit ?? 120}`;
}
