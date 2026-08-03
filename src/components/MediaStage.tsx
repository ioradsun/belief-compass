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


/** How far a horizontal drag must travel (px) before the page flips. */
const FLIP = 56;

export function MediaStage({
  media,
  children,
  className = "",
}: {
  media: StageMedia;
  /** The existing market panel — rendered untouched as page 1. */
  children: ReactNode;
  className?: string;
}) {
  // Media is the point of these markets: open on the evidence, with the market
  // one drag (or one hint tap) to the left.
  const [page, setPage] = useState<0 | 1>(1);
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; axis: "" | "x" | "y" } | null>(null);
  const width = useRef(1);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return; // mouse users click the hint
    width.current = e.currentTarget.clientWidth || 1;
    drag.current = { x: e.clientX, y: e.clientY, axis: "" };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      d.axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
    }
    if (d.axis !== "x") return;
    // Resist dragging past the ends — the stage has exactly two states.
    const bounded = page === 0 ? Math.min(0, mx) : Math.max(0, mx);
    setDx(bounded);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.axis === "x" && Math.abs(dx) > FLIP) setPage(dx < 0 ? 1 : 0);
    setDx(0);
  };

  const label = media.embed ? PLATFORM_LABEL[media.embed.platform] : KIND_LABEL[media.kind];

  return (
    <div
      className={`relative min-h-0 overflow-hidden ${className}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div
        className="flex h-full min-h-0 touch-pan-y will-change-transform"
        style={{
          transform: `translate3d(calc(${page * -100}% + ${dx}px), 0, 0)`,
          transition: drag.current ? "none" : "transform 260ms cubic-bezier(.22,.61,.36,1)",
        }}
      >
        {/* Page 1 — the market, exactly as it was. */}
        <div className="flex h-full w-full min-w-full shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch]">
          <Hint side="right" onClick={() => setPage(1)}>
            {label} →
          </Hint>
          {children}
        </div>

        {/* Page 2 — the evidence. */}
        <div className="flex h-full w-full min-w-full shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch]">
          <Hint side="left" onClick={() => setPage(0)}>
            ← Market
          </Hint>
          <Evidence media={media} />
        </div>
      </div>
    </div>
  );
}

function Hint({
  side,
  onClick,
  children,
}: {
  side: "left" | "right";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`shrink-0 ${side === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={onClick}
        className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
      >
        {children}
      </button>
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
