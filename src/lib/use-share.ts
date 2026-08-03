/**
 * useShare — the platform-correct "Stand on it" interaction.
 *
 *   • touch devices with a native share sheet → open it (Copy Link is a fallback
 *     the sheet itself provides, and we also fall back to clipboard if it's absent
 *     or dismissed with an error).
 *   • desktop → copy the URL immediately and flash a subtle confirmation. Where the
 *     browser supports the Web Share API we still expose `nativeShare` so a small
 *     secondary "Share…" affordance can offer the system sheet — never a modal.
 *
 * No large custom sharing UI: the OS sheet or the clipboard does the work.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface ShareTarget {
  url: string;
  text: string;
}

export function useShare() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const isCoarse =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;

  const flagCopied = useCallback(() => {
    setCopied(true);
    clearTimeout(timer.current ?? undefined);
    timer.current = setTimeout(() => setCopied(false), 2200);
  }, []);

  const copy = useCallback(
    async (url: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(url);
        flagCopied();
        return true;
      } catch {
        // Legacy fallback for browsers without the async clipboard API.
        try {
          const ta = document.createElement("textarea");
          ta.value = url;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(ta);
          if (ok) flagCopied();
          return ok;
        } catch {
          return false;
        }
      }
    },
    [flagCopied],
  );

  const nativeShare = useCallback(
    async ({ url, text }: ShareTarget): Promise<boolean> => {
      if (!canNativeShare) return false;
      try {
        await navigator.share({ text, url });
        return true;
      } catch {
        // A dismissed sheet throws AbortError — not an error worth surfacing.
        return false;
      }
    },
    [canNativeShare],
  );

  /**
   * The primary action: the native sheet on touch devices, an immediate copy on
   * desktop. Always resolves to a real outcome (shared or copied) or false.
   */
  const standOnIt = useCallback(
    async (target: ShareTarget): Promise<boolean> => {
      if (isCoarse && canNativeShare) {
        const shared = await nativeShare(target);
        if (shared) return true;
      }
      return copy(target.url);
    },
    [isCoarse, canNativeShare, nativeShare, copy],
  );

  return { standOnIt, nativeShare, copy, copied, canNativeShare, isCoarse };
}
