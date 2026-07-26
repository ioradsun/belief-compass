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
    if (BUILD_ID === "dev") return;
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch("/api/public/build-id", { cache: "no-store" });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId?: string };
        if (cancelled || !buildId || buildId === BUILD_ID) return;
        // New deploy — reload once, with a cache-buster to defeat any HTML cache.
        const url = new URL(window.location.href);
        url.searchParams.set("_v", buildId);
        window.location.replace(url.toString());
      } catch {
        // Network hiccup — try again next tick.
      }
    };

    const id = window.setInterval(check, 60_000);
    // Also check right after tab regains focus so a returning user sees new UI fast.
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    void check();

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return null;
}
