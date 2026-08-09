/**
 * COPY VERSION — the identity of the SENTENCES a build produces.
 *
 * The tape is deliberately sticky: a delta poll re-fetches only the overlap
 * window and merges a fresh head onto an immutable cached tail, and a row that
 * nothing newer displaces can sit in that tail for a long time. That is right
 * for FACTS — an event that happened at 14:02 still happened at 14:02 — and
 * wrong for COPY, because every row carries a `story` composed by the server
 * that shipped it. So a PI-copy fix could go out, be provably correct in the
 * repository, and still be invisible on screen: the old composed sentence was
 * already sitting in the reader's tail and no new event was going to evict it.
 * That is exactly how "Busier than this market has ever been" survived a build
 * that no longer contains the phrase.
 *
 * The fix is small and total: every payload is stamped with the version of the
 * build that composed it, and the client refuses to merge a tail composed by a
 * different one. A copy deployment therefore costs one full rebuild — the
 * cheapest possible price — and can never leave stale sentences on screen.
 *
 * VITE_BUILD_ID is defined at build time (see vite.config.ts), so it is
 * identical for the server and the client of one build and different across
 * deployments, which is precisely the equivalence we need.
 */
const fromEnv = (): string | null => {
  try {
    const v = (import.meta as { env?: Record<string, string | undefined> }).env?.["VITE_BUILD_ID"];
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
};

export const COPY_VERSION: string = fromEnv() ?? "dev";

/** Can this cached payload's rows be merged with what this build composes? */
export const sameCopyVersion = (v: string | null | undefined): boolean => v === COPY_VERSION;
