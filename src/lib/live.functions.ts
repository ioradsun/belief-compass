/**
 * Live tape — the server-function surface. The build itself lives in
 * `src/lib/insider/build.server.ts` (source → narration → significance →
 * discovery → editorial) and the shared-answer cache in
 * `src/lib/insider/cache.ts`. This file is a thin wrapper on purpose: server
 * functions are split out of the client bundle, and anything else declared
 * beside them is deleted from the server module.
 */
import { createServerFn } from "@tanstack/react-start";
import type { z } from "zod";
import { peekSwr, swrCache } from "@/lib/server-cache";
import { tapeInput } from "@/lib/insider/tape-input";
import { buildTape } from "@/lib/insider/build.server";
import { isSharedTape, tapeCacheKey, TAPE_TTL_MS } from "@/lib/insider/cache";

export const listLiveEvents = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof tapeInput>) => tapeInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    if (!isSharedTape(data)) return buildTape(data);
    return swrCache(tapeCacheKey(data?.limit), { ttlMs: TAPE_TTL_MS }, () => buildTape(data));
  });

/**
 * The SSR read: this isolate's warm tape, or null. NEVER builds — a shell that
 * waits on the tape is the stall this whole path exists to remove.
 */
export const getWarmTape = createServerFn({ method: "GET" }).handler(async () => {
  return peekSwr<Awaited<ReturnType<typeof buildTape>>>(tapeCacheKey(120)) ?? null;
});
