/**
 * Embeds — the only media a Conviction market carries.
 *
 * Conviction hosts the market, never the media. A creator pastes a link, we
 * detect the platform, normalise it to its canonical URL and render the
 * platform's OWN embed in a fixed frame. Nothing is downloaded, transcoded or
 * stored beyond the canonical URL plus the few metadata fields needed to draw
 * a fallback card.
 *
 * Pure + client-safe: the same parser runs in the composer (instant preview)
 * and on the server (the trusted copy). Anything not matched here is refused —
 * there is no arbitrary-iframe or arbitrary-domain path.
 */

export type EmbedPlatform = "youtube" | "instagram" | "tiktok" | "x" | "spotify";

export const PLATFORM_LABEL: Record<EmbedPlatform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  spotify: "Spotify",
};

/**
 * How each embed occupies the stage. `ratio` is width/height; `fixedHeight`
 * wins when the platform's player is a fixed-height bar (Spotify).
 */
export interface EmbedShape {
  ratio: number | null;
  fixedHeight: number | null;
  /** Cap so a portrait embed can never push the trading controls off-screen. */
  maxHeight: number;
}

export interface ParsedEmbed {
  platform: EmbedPlatform;
  /** The canonical, shareable URL we store and link out to. */
  url: string;
  /** The platform's official embed URL (always same-platform, always https). */
  embedUrl: string;
  /** Platform-side id, kept for cheap dedupe. */
  id: string;
  shape: EmbedShape;
}

/** Metadata is a nicety: an embed renders fine without it. */
export interface EmbedMedia extends ParsedEmbed {
  kind: "embed";
  title?: string | null;
  author?: string | null;
  thumbnail?: string | null;
}

const SHAPES = {
  landscape: { ratio: 16 / 9, fixedHeight: null, maxHeight: 420 },
  portrait: { ratio: 9 / 16, fixedHeight: null, maxHeight: 560 },
  square: { ratio: 4 / 5, fixedHeight: null, maxHeight: 560 },
  post: { ratio: 3 / 4, fixedHeight: null, maxHeight: 560 },
  // Spotify's compact player paints an 80px row; anything taller is dead space.
  bar: { ratio: null, fixedHeight: 80, maxHeight: 80 },
  panel: { ratio: null, fixedHeight: 352, maxHeight: 352 },
} satisfies Record<string, EmbedShape>;

/** Hosts we preconnect to so the first frame paints as early as possible. */
export const EMBED_ORIGINS: Record<EmbedPlatform, string[]> = {
  youtube: ["https://www.youtube-nocookie.com", "https://i.ytimg.com"],
  instagram: ["https://www.instagram.com"],
  tiktok: ["https://www.tiktok.com"],
  x: ["https://platform.twitter.com"],
  spotify: ["https://open.spotify.com"],
};

function safeUrl(raw: string): URL | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.protocol = "https:";
    return u;
  } catch {
    return null;
  }
}

const host = (u: URL) => u.hostname.replace(/^www\./, "").toLowerCase();

/**
 * Pasted embed code is a courtesy, not a second format. We pull every URL a
 * platform's snippet can carry (iframe src, blockquote cite/permalink, the
 * anchor fallback) and hand them back in order; the gate below still decides.
 */
export function embedUrlCandidates(raw: string): string[] {
  const out: string[] = [];
  const push = (v: string | undefined | null) => {
    const t = v?.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  const attr = (name: string) => {
    const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "gi");
    for (const m of raw.matchAll(re)) push(m[2] ?? m[3]);
  };
  attr("src");
  attr("cite");
  attr("data-instgrm-permalink");
  attr("data-video-id");
  attr("href");
  // Bare URLs inside the snippet (TikTok/X blockquotes end with one).
  for (const m of raw.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) push(m[0]);
  return out;
}

const looksLikeHtml = (raw: string) => /<[a-z]/i.test(raw);

/**
 * The single gate. Returns null for anything that is not a supported public
 * post on one of the five platforms. Full embed code is accepted by reducing
 * it to the media URL first — everything else in the snippet is discarded.
 */
export function parseEmbed(raw: string): ParsedEmbed | null {
  if (looksLikeHtml(raw)) {
    for (const candidate of embedUrlCandidates(raw)) {
      const hit = parseEmbedUrl(candidate);
      if (hit) return hit;
    }
    return null;
  }
  return parseEmbedUrl(raw);
}

function parseEmbedUrl(raw: string): ParsedEmbed | null {
  const u = safeUrl(raw);
  if (!u) return null;

  const h = host(u);
  const path = u.pathname.replace(/\/+$/, "");

  // ── YouTube (watch, share, shorts, embed, live) ─────────────────────────
  if (h === "youtube.com" || h === "m.youtube.com" || h === "music.youtube.com") {
    const id =
      u.searchParams.get("v") ??
      path.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,20})/)?.[1] ??
      null;
    if (!id) return null;
    const short = /^\/shorts\//.test(path);
    return youtube(id, short);
  }
  if (h === "youtu.be") {
    const id = path.slice(1).split("/")[0];
    return id ? youtube(id, false) : null;
  }

  // ── Instagram (post, reel, tv) ──────────────────────────────────────────
  if (h === "instagram.com" || h.endsWith(".instagram.com")) {
    const m = path.match(/\/(p|reel|reels|tv)\/([\w-]+)/);
    if (!m) return null;
    const type = m[1] === "reels" ? "reel" : m[1];
    const id = m[2];
    return {
      platform: "instagram",
      id,
      url: `https://www.instagram.com/${type}/${id}/`,
      embedUrl: `https://www.instagram.com/${type}/${id}/embed/captioned/`,
      shape: type === "reel" ? SHAPES.portrait : SHAPES.square,
    };
  }

  // ── TikTok (full video URL, or a short link we can't expand client-side) ─
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) {
    const m = path.match(/\/video\/(\d{6,25})/) ?? path.match(/^\/(?:v|embed)\/(\d{6,25})/);
    const id = m?.[1];
    if (!id) return null;
    const user = path.match(/^\/(@[\w.-]+)\//)?.[1] ?? "";
    return {
      platform: "tiktok",
      id,
      url: user
        ? `https://www.tiktok.com/${user}/video/${id}`
        : `https://www.tiktok.com/embed/v2/${id}`,
      embedUrl: `https://www.tiktok.com/embed/v2/${id}`,
      shape: SHAPES.portrait,
    };
  }

  // ── X / Twitter ─────────────────────────────────────────────────────────
  if (h === "x.com" || h === "twitter.com" || h === "mobile.twitter.com" || h === "mobile.x.com") {
    const m = path.match(/\/status(?:es)?\/(\d{6,25})/);
    const id = m?.[1];
    if (!id) return null;
    const user = path.match(/^\/([\w]{1,20})\//)?.[1] ?? "i";
    return {
      platform: "x",
      id,
      url: `https://x.com/${user}/status/${id}`,
      embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true&theme=dark`,
      shape: SHAPES.post,
    };
  }

  // ── Spotify (track, episode, album, playlist, show, artist) ─────────────
  if (h === "open.spotify.com" || h === "spotify.com") {
    const m = path.match(/\/(?:intl-[a-z]{2}\/)?(track|episode|album|playlist|show|artist)\/(\w+)/);
    if (!m) return null;
    const [, type, id] = m;
    const compact = type === "track" || type === "episode";
    return {
      platform: "spotify",
      id: `${type}:${id}`,
      url: `https://open.spotify.com/${type}/${id}`,
      embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
      shape: compact ? SHAPES.bar : SHAPES.panel,
    };
  }

  return null;
}

function youtube(id: string, short: boolean): ParsedEmbed | null {
  if (!/^[\w-]{6,20}$/.test(id)) return null;
  return {
    platform: "youtube",
    id,
    url: short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`,
    shape: short ? SHAPES.portrait : SHAPES.landscape,
  };
}

/** Best-effort poster without a network round trip (YouTube only). */
export function instantThumbnail(p: ParsedEmbed): string | null {
  return p.platform === "youtube" ? `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg` : null;
}

/** Read a stored media record back into an EmbedMedia. Null when it isn't one. */
export function embedFromRecord(raw: unknown): EmbedMedia | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "embed" || typeof r.url !== "string") return null;
  // Re-parse rather than trust the stored embedUrl: the parser is the gate.
  const parsed = parseEmbed(r.url);
  if (!parsed) return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    kind: "embed",
    ...parsed,
    title: str(r.title),
    author: str(r.author),
    thumbnail: str(r.thumbnail) ?? instantThumbnail(parsed),
  };
}

export const EMBED_HINT = "Paste a link or embed code — YouTube, Instagram, TikTok, X or Spotify.";
