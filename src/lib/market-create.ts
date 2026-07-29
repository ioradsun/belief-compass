/**
 * Market creation — shared, client-safe rules.
 *
 * Everything here is pure: the upload limits, the magic-byte sniffer, the
 * question-id generator and the disclaimer copy. The server re-runs the same
 * checks (see market-create.functions.ts) — the client copies exist only so the
 * UI can fail fast, never as the security boundary.
 */

export type MarketFormat = "text" | "media";
export type MediaKind = "image" | "audio" | "video" | "link";

export const MEDIA_LIMITS = {
  image: { bytes: 10 * 1024 * 1024, seconds: null as number | null },
  audio: { bytes: 20 * 1024 * 1024, seconds: 5 * 60 },
  video: { bytes: 50 * 1024 * 1024, seconds: 60 },
} as const;

/** Longest edge for uploaded stills — enforced client-side by re-encoding. */
export const MAX_IMAGE_EDGE = 4096;

export const ALLOWED_MIME: Record<Exclude<MediaKind, "link">, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"],
  audio: [
    "audio/mpeg",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
  ],
  video: ["video/mp4", "video/webm"],
};

/** Never accepted: SVG/HTML can carry script, archives can carry anything. */
const BLOCKED_SNIFF = ["image/svg+xml", "text/html", "application/zip", "application/x-msdownload"];

/** File-dialog filter. Extensions are included because some platforms report
 *  an empty or non-standard MIME type for .m4a/.aac files. */
const ACCEPT_EXT: Record<Exclude<MediaKind, "link">, string[]> = {
  image: [],
  audio: [".m4a", ".mp3", ".aac", ".wav", ".ogg", ".mp4"],
  video: [],
};

export function accept(kind: Exclude<MediaKind, "link">): string {
  return [...ALLOWED_MIME[kind], ...ACCEPT_EXT[kind]].join(",");
}

export function kindForMime(mime: string): Exclude<MediaKind, "link"> | null {
  for (const k of ["image", "audio", "video"] as const) {
    if (ALLOWED_MIME[k].includes(mime)) return k;
  }
  return null;
}

/**
 * Identify a file from its first bytes. The browser-declared MIME type is a
 * hint from an untrusted source; this is what we actually trust.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  const ascii = (start: number, len: number) =>
    String.fromCharCode(...b.slice(start, start + len));
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (ascii(0, 3) === "GIF") return "image/gif";
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
    const b4 = brand.toUpperCase();
    if (b4.startsWith("M4A") || b4.startsWith("M4B")) return "audio/mp4";
    return "video/mp4";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  const head = ascii(0, 64).trim().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return "text/html";
  if (b[0] === 0x50 && b[1] === 0x4b) return "application/zip";
  return null;
}

/** Throws with a human reason when the bytes aren't an allowed media file. */
export function assertAllowedBytes(
  bytes: Uint8Array,
  size: number,
): { mime: string; kind: Exclude<MediaKind, "link"> } {
  const mime = sniffMime(bytes);
  if (!mime) throw new Error("Unrecognised file type.");
  if (BLOCKED_SNIFF.includes(mime)) throw new Error("That file type isn't allowed.");
  const kind = kindForMime(mime);
  if (!kind) throw new Error("That file type isn't allowed.");
  if (size > MEDIA_LIMITS[kind].bytes) {
    throw new Error(`${kind} must be under ${Math.round(MEDIA_LIMITS[kind].bytes / 1048576)}MB.`);
  }
  return { mime, kind };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/**
 * The immutable on-chain identifier. Human-legible for other indexers, but the
 * random tail is what guarantees uniqueness — the question text stays editable
 * off-chain and is never the id.
 */
export function makeQuestionId(question: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  const slug = slugify(question) || "market";
  return `conviction-${slug}-${rand}`;
}

export const QUESTION_MAX = 160;

/** §7 disclaimers. Short ones render in the flow; all of them on /terms. */
export const DISCLAIMERS = {
  financial:
    "Creating or backing a market spends real ETH on a permissionless, unaudited smart contract. Transactions are irreversible. Prices can go to zero, there is no guarantee of any return, and Conviction markets are not resolved against a real-world outcome. Nothing here is financial advice.",
  permissionless:
    "Anyone can create a market. Conviction does not create, vet, endorse, or verify markets or their content, and the existence of a market is not an endorsement of it.",
  notPov:
    "This market and its media are created and hosted on Conviction, not on POV.co. The underlying token contract is public; POV and other indexers may see on-chain economic data (market ID, creator, question ID, token prices, activity) but do not host or control Conviction's media, artwork, descriptions, or presentation.",
  ugc: "By uploading, you confirm you own or have the rights to this content, that it does not infringe anyone's copyright or other rights, and that it is not illegal, harmful, or sexually explicit. Conviction may remove content and markets at its discretion.",
  opinion:
    "This is an opinion market. You're backing what you believe right now — there is no official resolution or payout tied to a real-world result.",
  immutable:
    "The market's on-chain identity is permanent. You can edit or remove the off-chain question and media, but the market and its tokens will continue to exist on-chain.",
} as const;
