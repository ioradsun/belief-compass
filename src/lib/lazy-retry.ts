/**
 * Resilient code-splitting.
 *
 * A redeploy renames every hashed chunk, so a tab that was loaded before the
 * deploy fails the moment it lazily imports a surface it hasn't touched yet:
 * "Failed to fetch dynamically imported module: .../assets/MyWorld-XXXX.js".
 * React.lazy rejections are caught by the nearest error boundary, so the
 * window-level chunk handler in VersionWatcher never sees them and the panel
 * just shows "Feed failed".
 *
 * lazyRetry wraps the dynamic import: retry once (transient network blips), and
 * if it still fails with a chunk-load error, hard-reload the page once with a
 * cache-busting flag so the browser fetches the new manifest.
 */
import { lazy, type ComponentType } from "react";

const RELOAD_FLAG = "_chunkReload";

function isChunkError(err: unknown): boolean {
  const s = String((err as Error)?.message ?? err ?? "");
  return (
    s.includes("Failed to fetch dynamically imported module") ||
    s.includes("Importing a module script failed") ||
    s.includes("error loading dynamically imported module") ||
    /ChunkLoadError/i.test(s)
  );
}

function reloadOnce(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get(RELOAD_FLAG) === "1") return; // already tried — avoid loops
  url.searchParams.set(RELOAD_FLAG, "1");
  window.location.replace(url.toString());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().catch(async (err) => {
      if (!isChunkError(err)) throw err;
      await new Promise((r) => setTimeout(r, 400));
      try {
        return await factory();
      } catch (err2) {
        if (isChunkError(err2)) {
          reloadOnce();
          // Keep the promise pending while the reload happens so no error
          // boundary flashes "failed" on the way out.
          return await new Promise<{ default: T }>(() => {});
        }
        throw err2;
      }
    }),
  );
}
