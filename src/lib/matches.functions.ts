/**
 * Conviction DNA — public server functions (Phase 8).
 *
 * ONE viewer-facing entry point. `getViewerMatches` returns the bounded cache
 * (closest / Tribe / Rivals / domain Circles), computing on a miss/stale within
 * the request when a caller explicitly wants the DNA now (e.g. the wallet page).
 * The feed instead reads the cache and enqueues a background refresh so it never
 * blocks on the scan (see markets.functions listFeed).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicClient } from "@/lib/supabase-clients";
import { readViewerCache, type ViewerMatchCache } from "@/lib/matches/viewer-cache.server";
import { computeViewerMatches } from "@/lib/matches/compute-viewer-matches.server";

export type { ViewerMatchCache } from "@/lib/matches/viewer-cache.server";
export type { MatchEntry } from "@/domain/viewer-matches";

/**
 * Return the viewer's bounded relationships. Fresh cache → served as-is;
 * miss/stale → recomputed synchronously (bounded, single-viewer) and cached.
 */
export async function ensureViewerMatches(walletRaw: string): Promise<ViewerMatchCache> {
  const wallet = walletRaw.toLowerCase();
  const cached = await readViewerCache(publicClient(), wallet);
  if (cached && cached.fresh) return cached;
  return computeViewerMatches(wallet);
}

export const getViewerMatches = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string }) => z.object({ wallet: z.string().min(3) }).parse(d))
  .handler(async ({ data }) => ensureViewerMatches(data.wallet));
