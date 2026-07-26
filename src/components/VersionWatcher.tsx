import { useEffect } from "react";
import { BUILD_ID } from "@/lib/build-id";

/**
 * Polls /api/public/build-id every 60s. When the server reports a different
 * build id than the one baked into this bundle, the page hard-reloads with a
 * cache-busting query so users always see the latest ConvictionFeed/MarketFacts.
 *
 * No-ops in dev (BUILD_ID === "dev"), where Vite HMR already handles updates.
 */
export function VersionWatcher() {
  useEffect(() => {
    // Chunk-load failures happen the instant a user navigates to a route whose
    // JS chunk was renamed by a redeploy. Reload immediately (once) instead of
    // waiting for the 60s poll — otherwise the page is blank until then.
    const reloadOnce = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("_chunkReload") === "1") return; // avoid loops
      url.searchParams.set("_chunkReload", "1");
      window.location.replace(url.toString());
    };
    const isChunkError = (msg: unknown) => {
      const s = String(msg ?? "");
      return (
        s.includes("Importing a module script failed") ||
        s.includes("Failed to fetch dynamically imported module") ||
        s.includes("error loading dynamically imported module") ||
        /ChunkLoadError/i.test(s)
      );
    };
    const onError = (e: ErrorEvent) => {
      if (isChunkError(e.message) || isChunkError((e.error as Error)?.message)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      if (isChunkError(r?.message ?? r)) reloadOnce();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    if (BUILD_ID === "dev") {
      return () => {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
      };
    }
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch("/api/public/build-id", { cache: "no-store" });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId?: string };
        if (cancelled || !buildId || buildId === BUILD_ID) return;
        const url = new URL(window.location.href);
        url.searchParams.set("_v", buildId);
        window.location.replace(url.toString());
      } catch {
        // Network hiccup — try again next tick.
      }
    };

    const id = window.setInterval(check, 60_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    void check();

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}

