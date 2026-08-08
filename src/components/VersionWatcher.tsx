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

    // Guard against reload loops: if the server's build id never matches the
    // one baked into this bundle (which happens whenever the server and client
    // are built separately), an unguarded reload fires forever and the page
    // blinks. Reload at most once per target build id, per tab.
    const alreadyReloadedFor = (id: string) => {
      try {
        const key = "conviction:reloaded-for";
        if (window.sessionStorage.getItem(key) === id) return true;
        window.sessionStorage.setItem(key, id);
        return false;
      } catch {
        return true; // no storage → don't risk a loop
      }
    };

    /**
     * The FIRST answer is a baseline, never a reason to reload.
     *
     * The server and the client bundle are built separately, so a freshly
     * loaded page can legitimately disagree with the endpoint. Reloading on
     * that first mismatch is what made the preview "start, revert, start
     * again" — a reload that produces the same mismatch teaches nothing and
     * costs the reader a whole cold start. Only a build id that CHANGES while
     * this tab is open means a genuinely newer deploy shipped.
     */
    let baseline: string | null = null;

    const check = async () => {
      try {
        const res = await fetch("/api/public/build-id", { cache: "no-store" });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId?: string };
        if (cancelled || !buildId || buildId === BUILD_ID) return;
        if (baseline === null) {
          baseline = buildId; // first sighting — remember, don't act
          return;
        }
        if (buildId === baseline) return;
        baseline = buildId;
        if (alreadyReloadedFor(buildId)) return;
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

