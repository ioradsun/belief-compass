/**
 * Share — the pure engine behind "Stand on it": the challenge message, the
 * readable market URL, and the slug. ZERO IO, deterministic, fully testable.
 *
 * Sharing is a growth action, not a utility: a viewer brings their tribe INTO a
 * market. The message is deliberately short — the link preview (Open Graph) carries
 * the market's real state — and it reads like a challenge, never a website card.
 */

export type ShareSide = "YES" | "NO" | null;

export interface ShareMessageInput {
  /** The viewer's backed side, or null when they haven't taken one. */
  side: ShareSide;
  /** A media market (video/image) — the ask leads with "Watch this." */
  hasMedia: boolean;
}

/**
 * The short share message. Backing a side is the strongest hook, so it wins even
 * on a media market; otherwise a media market invites a watch, and a plain market
 * asks for a side. The link preview supplies every number.
 */
export function shareMessage({ side, hasMedia }: ShareMessageInput): string {
  if (side === "YES" || side === "NO") return `I backed ${side}. Stand on business.`;
  if (hasMedia) return "Watch this. Pick a side. Stand on business.";
  return "Pick a side. Stand on business.";
}

/**
 * A readable, URL-safe slug from a market title: lowercased, non-alphanumerics
 * folded to single hyphens, trimmed, and capped so a link stays clean. Empty when
 * the title has no usable characters (the URL then falls back to the id alone).
 */
export function slugifyTitle(title: string | null | undefined, max = 60): string {
  const s = (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= max) return s;
  // Cut at the last hyphen before the cap so a word is never sliced mid-way.
  const cut = s.slice(0, max);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, "");
}

/**
 * The canonical, human-readable path for a market: `/m/<id>-<slug>`. The id leads
 * so the route always resolves even if the title (and thus the slug) later changes;
 * the slug is cosmetic. Falls back to `/m/<id>` when there is no usable title.
 */
export function marketPath(id: number, title?: string | null): string {
  const slug = slugifyTitle(title);
  return slug ? `/m/${id}-${slug}` : `/m/${id}`;
}

/** Parse the market id back out of a `/m/<id>-<slug>` path segment. */
export function marketIdFromParam(param: string | null | undefined): number | null {
  if (!param) return null;
  const m = /^(\d+)/.exec(param.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * The full shareable URL. `ref` is the lightweight attribution code (kept short so
 * the visible link stays clean); omitted when absent so a plain share has no query.
 */
export function marketShareUrl(
  origin: string,
  id: number,
  title?: string | null,
  ref?: string | null,
): string {
  const base = origin.replace(/\/+$/, "");
  const path = marketPath(id, title);
  const q = ref ? `?r=${encodeURIComponent(ref)}` : "";
  return `${base}${path}${q}`;
}
