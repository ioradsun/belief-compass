/**
 * THE TAPE SEED — the first few Insider rows, kept where a COLD isolate can reach them.
 *
 * `peekSwr` only pays off on a warm isolate. A cold one had nothing, so SSR
 * shipped a skeleton and the reader waited a full client round trip plus a
 * multi-query build before the Insider said anything. The build is far too
 * expensive to await on the shell's budget — but a single-row read of a stored
 * snapshot is not. So every successful shared (signed-out, unscoped) build
 * leaves its head rows behind in `feed_snapshot`, and a cold SSR reads that one
 * row.
 *
 * The seed is PAINT ONLY: the client still fetches the real tape, and refuses
 * to merge anything composed by a different build. Scoping the key by
 * COPY_VERSION makes that absolute — a new deploy cannot see the previous
 * build's sentences, so a copy fix is never served from the database.
 */
import { COPY_VERSION } from "@/domain/copy-version";
import { serviceClientOrNull } from "@/lib/supabase-clients";
import { peekSwr } from "@/lib/server-cache";
import { tapeCacheKey } from "@/lib/insider/cache";
import type { LiveRow } from "@/lib/live-tape";

export interface TapeResult {
  rows: LiveRow[];
  copyVersion: string;
  error: string | null;
}

const SEED_KEY = `insider:tape:anon:${COPY_VERSION}`;
/** Enough to fill the first screen; small enough that the row stays cheap. */
const SEED_ROWS = 12;
/** A seed that cannot be read quickly is not a seed. Bound the SSR read. */
const SEED_READ_MS = 700;

export function trimTapeSeed(result: TapeResult): TapeResult {
  return { ...result, rows: result.rows.slice(0, SEED_ROWS) };
}

/**
 * A SEED WRITE MAY NEVER GATE THE TAPE.
 *
 * This used to be awaited inside the shared-cache factory, so the cached value
 * was only produced once the write came back. On this runtime a write belonging
 * to an already-responded request can be CANCELLED without ever settling — and
 * an await that never resumes inside the single-flight factory means the cache
 * entry is never written, so the next reader cold-rebuilds, forever. The tape
 * felt slow and stopped updating for exactly that reason.
 *
 * The write is now bounded: it is best-effort persistence of a snapshot, and a
 * snapshot that takes longer than this is simply skipped until next time.
 */
export const SEED_WRITE_MS = 800;

export async function writeTapeSeed(result: TapeResult): Promise<void> {
  const t0 = Date.now();
  try {
    if (result.error || !result.rows?.length) return;
    const sb = serviceClientOrNull();
    if (!sb) return;
    const write = sb.from("feed_snapshot").upsert(
      {
        key: SEED_KEY,
        payload: trimTapeSeed(result) as unknown as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    const done = await Promise.race([
      Promise.resolve(write).then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), SEED_WRITE_MS)),
    ]);
    console.log(`[insider] writeTapeSeed ${done ? "ok" : "timeout"} ${Date.now() - t0}ms`);
  } catch {
    // A cache that fails to write must never fail the tape.
  }
}

export async function readTapeSeed(): Promise<TapeResult | null> {
  try {
    const sb = serviceClientOrNull();
    if (!sb) return null;
    const read = sb.from("feed_snapshot").select("payload").eq("key", SEED_KEY).maybeSingle();
    const res = await Promise.race([
      read,
      new Promise<null>((r) => setTimeout(() => r(null), SEED_READ_MS)),
    ]);
    const payload = (res as { data?: { payload?: unknown } } | null)?.data?.payload as
      | TapeResult
      | undefined;
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.rows)) return null;
    // Never hand a reader sentences from another build.
    if (payload.copyVersion !== COPY_VERSION) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Warm read first, stored seed second — never a build, never a long await. */
export async function warmTape(limit = 120): Promise<TapeResult | null> {
  const warm = peekSwr<TapeResult>(tapeCacheKey(limit));
  if (warm) return warm;
  return readTapeSeed();
}
