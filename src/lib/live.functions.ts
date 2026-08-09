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
import { swrCache } from "@/lib/server-cache";
import { tapeInput } from "@/lib/insider/tape-input";
import { buildTape } from "@/lib/insider/build.server";
import { isSharedTape, tapeCacheKey, TAPE_TTL_MS } from "@/lib/insider/cache";
import { warmTape, writeTapeSeed, type TapeResult } from "@/lib/insider/seed.server";

export const listLiveEvents = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof tapeInput>) => tapeInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    if (!isSharedTape(data)) return buildTape(data);
    return swrCache(tapeCacheKey(data?.limit), { ttlMs: TAPE_TTL_MS }, async () => {
      const built = await buildTape(data);
      // The seed is what a COLD isolate paints from; only the shared answer
      // qualifies, and only a successful one. Awaited, because work belonging
      // to a responded request is cancelled on this runtime.
      await writeTapeSeed(built as TapeResult);
      return built;
    });
  });

/**
 * The SSR read: this isolate's warm tape, else the durable seed, else null.
 * NEVER builds — a shell that waits on the tape is the stall this whole path
 * exists to remove.
 */
export const getWarmTape = createServerFn({ method: "GET" }).handler(async () => {
  return (await warmTape(120)) ?? null;
});

