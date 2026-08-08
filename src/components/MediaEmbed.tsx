/**
 * MediaEmbed — one stable frame for every third-party embed.
 *
 * The market layout must not move because of what someone pasted, so the frame
 * is sized from a known aspect ratio (or Spotify's fixed player height) BEFORE
 * anything loads, capped so a portrait video can never push the trading
 * controls off-screen. Inside it we render the platform's official embed and
 * nothing else — no downloaded media, no arbitrary HTML.
 *
 * Every embed has a fallback: if the post is deleted, private, geo-blocked, or
 * simply slow, the frame keeps its size and shows the thumbnail, platform,
 * creator and a "View on <Platform>" action. The market stays usable either way.
 */
import { useEffect, useRef, useState } from "react";
import { EMBED_ORIGINS, PLATFORM_LABEL, type EmbedMedia } from "@/lib/embed";

/** How long we wait for a frame before assuming it will never arrive. */
const LOAD_TIMEOUT = 6000;

/**
 * Warm the platform's origin as early as we know a card carries an embed —
 * DNS + TLS are the bulk of an embed's time-to-first-frame.
 */
export function preconnectEmbed(platform: EmbedMedia["platform"]) {
  if (typeof document === "undefined") return;
  for (const origin of EMBED_ORIGINS[platform]) {
    if (document.querySelector(`link[data-embed="${origin}"]`)) continue;
    for (const rel of ["preconnect", "dns-prefetch"]) {
      const l = document.createElement("link");
      l.rel = rel;
      l.href = origin;
      l.crossOrigin = "";
      l.dataset.embed = origin;
      document.head.appendChild(l);
    }
  }
}

export function MediaEmbed({ media, className = "" }: { media: EmbedMedia; className?: string }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    preconnectEmbed(media.platform);
  }, [media.platform]);

  useEffect(() => {
    setState("loading");
    timer.current = setTimeout(() => setState((s) => (s === "ready" ? s : "failed")), LOAD_TIMEOUT);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [media.embedUrl]);

  const { ratio, fixedHeight, maxHeight } = media.shape;
  const label = PLATFORM_LABEL[media.platform];

  return (
    <figure className={`w-full ${className}`}>
      <div
        className="relative w-full overflow-hidden rounded-[16px] bg-[var(--surface)]"
        style={{
          ...(fixedHeight
            ? { height: fixedHeight }
            : { aspectRatio: String(ratio ?? 16 / 9), maxHeight }),
          // Cap the width to the ratio so a height-capped frame never
          // letterboxes the embed inside an oversized box.
          marginInline: ratio != null ? "auto" : undefined,
          maxWidth: ratio != null ? maxHeight * ratio : undefined,
        }}
      >
        {state !== "failed" ? (
          <>
            {/* Poster paints instantly under the iframe; the frame covers it. */}
            {media.thumbnail && state === "loading" && (
              <img
                src={media.thumbnail}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-cover opacity-60 blur-[1px]"
              />
            )}
            <iframe
              src={media.embedUrl}
              title={media.title ?? `${label} embed`}
              loading="eager"
              onLoad={() => setState("ready")}
              onError={() => setState("failed")}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
              className="absolute inset-0 h-full w-full border-0"
              style={{ colorScheme: "normal" }}
            />
          </>
        ) : (
          <Fallback media={media} label={label} />
        )}
      </div>

      <figcaption className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
        <span className="min-w-0 truncate">
          {media.author ? `${media.author} · ` : ""}
          {media.title ?? label}
        </span>
        <a
          href={media.url}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 font-medium text-[var(--text-secondary)] underline"
        >
          View on {label} ↗
        </a>
      </figcaption>
    </figure>
  );
}

/** Deleted, private, blocked, or just never arrived — same honest card. */
function Fallback({ media, label }: { media: EmbedMedia; label: string }) {
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noreferrer noopener"
      className="absolute inset-0 flex flex-col justify-end"
    >
      {media.thumbnail && (
        <img
          src={media.thumbnail}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
      )}
      <div className="relative p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {label}
        </div>
        <div className="mt-1 line-clamp-2 text-[14px] font-semibold leading-snug text-[var(--text)]">
          {media.title ?? "This post can’t be shown here"}
        </div>
        {media.author && (
          <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{media.author}</div>
        )}
        <div className="mt-2 text-[12px] font-medium text-[var(--text-secondary)] underline">
          View on {label} ↗
        </div>
      </div>
    </a>
  );
}
