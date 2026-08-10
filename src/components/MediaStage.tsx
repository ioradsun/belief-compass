/**
 * MediaStage — the two-state stage for markets that carry evidence.
 *
 * A market with uploaded media gets ONE extra surface, not a new layout: the
 * existing market panel becomes page 1, the evidence becomes page 2, and the
 * only affordance is a hint that names what lives in the other direction
 * ("Photo →" / "← Market"). Dragging or clicking the hint moves between them.
 * No tabs, no dots, no pills. Markets without media never mount this.
 *
 * Pure presentation: the media record comes straight from getConvictionMarket.
 */
import { useRef, useState, type ReactNode } from "react";
import { MediaEmbed } from "@/components/MediaEmbed";
import { embedFromRecord, PLATFORM_LABEL, type EmbedMedia } from "@/lib/embed";

export interface StageMedia {
  kind: "image" | "video" | "audio" | "link" | "embed";
  /** Signed URL for uploaded files; the target URL for links/embeds. */
  url: string | null;
  mime?: string | null;
  alt?: string | null;
  /** Link previews only. */
  title?: string | null;
  image?: string | null;
  site?: string | null;
  /** Third-party embeds only. */
  embed?: EmbedMedia | null;
}

/** The word the hint uses for each kind of evidence. */
const KIND_LABEL: Record<StageMedia["kind"], string> = {
  image: "Photo",
  video: "Video",
  audio: "Audio",
  link: "Article",
  embed: "Media",
};

/** Reads the stage's media out of a getConvictionMarket response. Null = no media. */
export function stageMediaFrom(
  cm:
    | {
        market?: { media?: unknown; mediaUrl?: string | null } | null;
      }
    | null
    | undefined,
): StageMedia | null {
  const raw = cm?.market?.media as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== "object") return null;
  const kind = String(raw.kind ?? "");

  if (kind === "embed") {
    const embed = embedFromRecord(raw);
    if (!embed) return null;
    return { kind: "embed", url: embed.url, embed, title: embed.title ?? null };
  }

  if (!["image", "video", "audio", "link"].includes(kind)) return null;
  const url =
    kind === "link"
      ? typeof raw.url === "string"
        ? raw.url
        : null
      : (cm?.market?.mediaUrl ?? null);
  if (!url) return null;
  return {
    kind: kind as StageMedia["kind"],
    url,
    mime: typeof raw.mime === "string" ? raw.mime : null,
    alt: typeof raw.alt === "string" ? raw.alt : null,
    title: typeof raw.title === "string" ? raw.title : null,
    image: typeof raw.image === "string" ? raw.image : null,
    site: typeof raw.site === "string" ? raw.site : null,
  };
}

export function MediaStage({
  media,
  children,
  className = "",
}: {
  /**
   * Null when this market carries no evidence. Evidence is no longer a second
   * page: it renders inline, directly under the question, so a market with
   * media has exactly the same layout as every other market.
   */
  media: StageMedia | null;
  /** The market panel — unchanged. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative min-h-0 overflow-hidden ${className}`}>
      <div
        className="flex h-full w-full min-w-full shrink-0 flex-col overflow-y-scroll overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch]"
        style={{ gap: "var(--deck-gap, 12px)" }}
      >
        {media && <Evidence media={media} />}
        {children}
      </div>
    </div>
  );
}


function Evidence({ media }: { media: StageMedia }) {
  if (media.kind === "embed" && media.embed) return <MediaEmbed media={media.embed} />;
  const url = media.url as string;
  if (media.kind === "image") {
    return (
      <img
        src={url}
        alt={media.alt ?? "Evidence attached to this market"}
        loading="lazy"
        className="max-h-full w-full rounded-[16px] object-contain"
      />
    );
  }
  if (media.kind === "video") {
    return (
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        className="max-h-full w-full rounded-[16px] bg-black object-contain"
      />
    );
  }
  if (media.kind === "audio") {
    return (
      <div className="rounded-[16px] bg-[var(--surface)] p-4">
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
          Audio evidence
        </div>
        <audio src={url} controls preload="metadata" className="w-full" />
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="block overflow-hidden rounded-[16px] bg-[var(--surface)]"
    >
      {media.image && (
        <img
          src={media.image}
          alt=""
          loading="lazy"
          className="max-h-[280px] w-full object-cover"
        />
      )}
      <div className="p-4">
        <div className="text-[15px] font-semibold leading-snug text-[var(--text)]">
          {media.title ?? url}
        </div>
        {media.site && (
          <div className="mt-1 text-[12px] text-[var(--text-muted)]">{media.site} ↗</div>
        )}
      </div>
    </a>
  );
}
