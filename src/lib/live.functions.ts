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
    const built = await swrCache(tapeCacheKey(data?.limit), { ttlMs: TAPE_TTL_MS }, () =>
      buildTape(data),
    );
    // THE SEED IS A SIDE EFFECT OF THE ANSWER, NEVER PART OF IT. It used to be
    // awaited INSIDE the factory, which meant the cached value existed only
    // once the write returned — and on this runtime a write belonging to an
    // already-responded request can be cancelled without ever settling, so the
    // factory never resolved, the entry was never stored and every request
    // cold-rebuilt the tape. That is the "slow, and then it stops updating"
    // report. The cache now stores `buildTape`'s result directly; the seed
    // write happens after, bounded (see SEED_WRITE_MS) and unable to fail or
    // delay the response beyond that bound.
    await writeTapeSeed(built as TapeResult);
    return built;
  });

/**
 * The SSR read: this isolate's warm tape, else the durable seed, else null.
 * NEVER builds — a shell that waits on the tape is the stall this whole path
 * exists to remove.
 */
export const getWarmTape = createServerFn({ method: "GET" }).handler(async () => {
  return (await warmTape(120)) ?? null;
});

