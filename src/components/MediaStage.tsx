/**
 * MediaStage — the plain market scroller.
 *
 * A market with uploaded media gets ONE extra surface, not a new layout: the
 * existing market panel becomes page 1, the evidence becomes page 2, and the
 * only affordance is a hint that names what lives in the other direction
 * ("Photo →" / "← Market"). Dragging or clicking the hint moves between them.
 * No tabs, no dots, no pills. Markets without media never mount this.
 *
 * Pure presentation: the media record comes straight from getConvictionMarket.
 */
import { type ReactNode } from "react";
import { MediaEmbed } from "@/components/MediaEmbed";
import { embedFromRecord, type EmbedMedia } from "@/lib/embed";

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
        {children}
      </div>
    </div>
  );
}

/**
 * TALL MEDIA TAKES THE COLUMN. A YouTube player or an X post is a 16:9-or-taller
 * block: printed inline it pushes the market body off the panel. Those markets
 * get one switch — Media / Market — instead of a scroll. Short media (a Spotify
 * bar, a link card, an audio row) stays inline where it never cost anything.
 */
export function isTallMedia(media: StageMedia | null | undefined): boolean {
  if (!media) return false;
  if (media.kind === "embed")
    return media.embed?.platform === "youtube" || media.embed?.platform === "x";
  return media.kind === "image" || media.kind === "video";
}

export function MediaSwitch({
  value,
  onChange,
  label = "Media",
  className = "",
}: {
  value: "market" | "media";
  onChange: (v: "market" | "media") => void;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Market or media"
      className={`flex items-center gap-1 rounded-full bg-[var(--surface)] p-0.5 text-[12px] font-semibold ${className}`}
    >
      {(
        [
          ["market", "Market"],
          ["media", label],
        ] as const
      ).map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`rounded-full px-3 py-1 transition-colors ${
            value === key
              ? "bg-[var(--surface-2,rgba(255,255,255,0.08))] text-[var(--text)]"
              : "text-[var(--text-muted)]"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** The label the switch prints for this media. */
export function mediaSwitchLabel(media: StageMedia): string {
  if (media.kind === "embed") {
    if (media.embed?.platform === "youtube") return "Video";
    if (media.embed?.platform === "x") return "Post";
  }
  if (media.kind === "video") return "Video";
  if (media.kind === "image") return "Photo";
  return "Media";
}



export function MediaEvidence({ media }: { media: StageMedia }) {
  if (media.kind === "embed" && media.embed)
    return <MediaEmbed media={media.embed} caption={false} />;
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
