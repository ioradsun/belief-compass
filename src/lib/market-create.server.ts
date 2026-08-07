/**
 * Market creation — server-only helpers.
 *
 * AI review (question quality + category), duplicate detection and byte-level
 * media verification live here. Nothing in this file is reachable from the
 * browser bundle.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { textScore, contentTokens } from "@/domain/question-discovery";
import { assertAllowedBytes } from "@/lib/market-create";
import { CREATOR_CATEGORIES, normalizeCategory, type CategorySlug } from "@/domain/categories";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

export interface QuestionReview {
  ok: boolean;
  /** Why it was rejected, in plain language. */
  reason: string | null;
  /** A tightened rewrite the user can accept with one tap. */
  suggestion: string | null;
  /**
   * A CATEGORY SLUG, not a display name. This used to be a title-case string
   * from a list that lived here and nowhere else, which meant the reviewer's
   * answer was stored in a vocabulary no reader understood — see the note at
   * the top of `@/domain/categories`.
   */
  category: CategorySlug;
  /** Hard block: illegal / targeted-harm content never reaches the chain. */
  blocked: boolean;
}

async function askAI(system: string, user: string): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

/**
 * Review a proposed question. The AI is advisory for quality but authoritative
 * for the hard block — and when the AI is unavailable we fail OPEN on quality
 * and CLOSED on nothing, because the contract is permissionless anyway.
 */
export async function reviewQuestion(question: string): Promise<QuestionReview> {
  const raw = await askAI(
    [
      "You review opinion-market questions for a permissionless prediction app.",
      "A good question is a single, sharply-worded claim people can back YES or NO on today.",
      "It does NOT need a real-world resolution date — these are opinion markets.",
      'Reply ONLY as JSON: {"ok":bool,"reason":string|null,"suggestion":string|null,"category":string,"blocked":bool}',
      `category must be exactly one of these slugs: ${CREATOR_CATEGORIES.join(", ")}.`,
      "blocked=true ONLY for illegal content, sexual content involving minors, doxxing, or targeted harassment/violence against a real identifiable person.",
      "suggestion: a tighter rewrite under 160 characters, or null if the original is already good.",
    ].join(" "),
    question,
  );
  const parsed = parseJson<QuestionReview>(raw);
  if (!parsed)
    return { ok: true, reason: null, suggestion: null, category: "other", blocked: false };
  return {
    ok: parsed.blocked ? false : parsed.ok !== false,
    reason: parsed.reason ?? null,
    suggestion: parsed.suggestion ?? null,
    // Through the same door as everything else. The model is asked for a slug
    // but answers in prose often enough — "Human Nature", "Crypto" — and
    // `normalizeCategory` accepts all of those spellings rather than dropping
    // a usable answer on the floor.
    category: normalizeCategory(parsed.category) ?? "other",
    blocked: parsed.blocked === true,
  };
}

/**
 * WHAT WAS HERE. A private stopword list, a private `tokens()`, a Jaccard
 * `similarity()`, and `findSimilarMarkets()` — a blind 4,000-row scan of
 * `markets` + `conviction_markets` on every debounced keystroke, whose result
 * `reviewMarketQuestion` dutifully returned and **no component ever read**.
 *
 * All four are gone. Tokenising and scoring live in @/domain/question-discovery,
 * the one place that decides what a duplicate is, where retrieval costs 0.04ms
 * against the warm catalog instead of two full table reads.
 */

/**
 * Download what the client actually stored and verify it by magic bytes.
 * A lying Content-Type never survives this.
 */
export async function verifyStoredMedia(path: string) {
  const db = serviceClient();
  const { data, error } = await db.storage.from("market-media").download(path);
  if (error || !data) throw new Error("Upload not found.");
  const buf = new Uint8Array(await data.arrayBuffer());
  const { mime, kind } = assertAllowedBytes(buf.slice(0, 64), buf.byteLength);
  return { mime, kind, size: buf.byteLength };
}

/** A signed read URL for private media (rotated on every read). */
export async function signMediaUrl(path: string, seconds = 60 * 60 * 24 * 7) {
  const db = serviceClient();
  const { data } = await db.storage.from("market-media").createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

/** Fetch OpenGraph title/image for a pasted link. Never renders remote HTML. */
export async function fetchLinkPreview(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Links must be https.");
  const res = await fetch(parsed.toString(), {
    headers: { "User-Agent": "ConvictionBot/1.0" },
    redirect: "follow",
  });
  const html = (await res.text()).slice(0, 200_000);
  const pick = (prop: string) =>
    html.match(
      new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)`, "i"),
    )?.[1] ??
    html.match(
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, "i"),
    )?.[1] ??
    null;
  return {
    url: parsed.toString(),
    title:
      pick("og:title") ?? html.match(/<title[^>]*>([^<]{1,200})/i)?.[1]?.trim() ?? parsed.hostname,
    image: pick("og:image"),
    site: parsed.hostname,
  };
}

/**
 * Scoring is @/domain/question-discovery's job. `textScore` is the same
 * subject-gated measure this file used to own, moved so the rails, the idea
 * generator and creation all read ONE implementation. `contentTokens` comes with
 * it, because the keyword pull below must target the same words the scorer
 * weighs — that is what keeps retrieval and ranking honest about each other.
 */

export interface SuggestionInput {
  question: string;
  /** SHA-256 of an attached upload, when the user has one. */
  sha256?: string | null;
  /** An attached https link. */
  linkUrl?: string | null;
}

export interface MarketSuggestion {
  onchainId: number;
  title: string;
  /** Why it surfaced, for the card's eyebrow. */
  reason: "same-media" | "same-link" | "similar";
  score: number;
  thumbUrl: string | null;
  backedUsd: number | null;
  believers: number | null;
  yesPct: number | null;
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * Ranked "you might rather back this" candidates.
 *
 * Three signals, strongest first: identical uploaded bytes, the same external
 * link, then question-text overlap. Stats come from the same `market_state`
 * read model the rest of the app renders — nothing here is invented.
 */
export async function findMarketSuggestions(
  input: SuggestionInput,
  limit = 3,
): Promise<MarketSuggestion[]> {
  const question = (input.question ?? "").trim();
  const hasMedia = !!input.sha256 || !!input.linkUrl;
  if (question.length < 8 && !hasMedia) return [];

  const db = serviceClient();
  // Keyword-targeted candidates beat a blind page of rows: an arbitrary
  // `limit(N)` slice can miss the one market that actually matches.
  const keywords = [...contentTokens(question)]
    .filter((t) => t.length > 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);

  const titleOr = keywords.map((k) => `title.ilike.%${k}%`).join(",");
  const questionOr = keywords.map((k) => `question.ilike.%${k}%`).join(",");

  const [pov, povRecent, own] = await Promise.all([
    titleOr
      ? db
          .from("markets")
          .select("onchain_id, title")
          .not("title", "is", null)
          .or(titleOr)
          .limit(400)
      : Promise.resolve({ data: [] as { onchain_id: number | null; title: string | null }[] }),
    db
      .from("markets")
      .select("onchain_id, title")
      .not("title", "is", null)
      .order("onchain_id", { ascending: false })
      .limit(400),
    db
      .from("conviction_markets")
      .select("onchain_id, question, media")
      .not("onchain_id", "is", null)
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(400),
  ]);

  const best = new Map<
    number,
    { title: string; score: number; reason: MarketSuggestion["reason"]; media: unknown }
  >();
  const consider = (
    id: number | null,
    title: string,
    score: number,
    reason: MarketSuggestion["reason"],
    media: unknown = null,
  ) => {
    if (id == null || !Number.isFinite(id) || !title) return;
    const prev = best.get(id);
    if (!prev || score > prev.score) best.set(id, { title, score, reason, media });
  };

  for (const r of [...(pov.data ?? []), ...(povRecent.data ?? [])]) {
    consider(
      r.onchain_id != null ? Number(r.onchain_id) : null,
      String(r.title),
      textScore(question, String(r.title)),
      "similar",
    );
  }

  const wantLink = input.linkUrl ? normalizeUrl(input.linkUrl) : null;
  for (const r of (own.data ?? []) as {
    onchain_id: number | null;
    question: string;
    media: Record<string, unknown> | null;
  }[]) {
    const id = r.onchain_id != null ? Number(r.onchain_id) : null;
    const media = r.media ?? null;
    const mediaHash = media && typeof media.sha256 === "string" ? media.sha256 : null;
    const mediaUrl = media && typeof media.url === "string" ? media.url : null;
    if (input.sha256 && mediaHash && mediaHash === input.sha256) {
      consider(id, r.question, 1, "same-media", media);
      continue;
    }
    if (wantLink && mediaUrl && normalizeUrl(mediaUrl) === wantLink) {
      consider(id, r.question, 0.98, "same-link", media);
      continue;
    }
    consider(id, r.question, textScore(question, r.question), "similar", media);
  }

  const ranked = [...best.entries()]
    .map(([onchainId, v]) => ({ onchainId, ...v }))
    .filter((m) => m.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (!ranked.length) return [];

  const { data: states } = await db
    .from("market_state")
    .select(
      "onchain_id, volume_total_usd, believers_yes, believers_no, believers_mixed, money_yes_pct",
    )
    .in(
      "onchain_id",
      ranked.map((m) => m.onchainId),
    );
  const stateById = new Map((states ?? []).map((s) => [Number(s.onchain_id), s]));

  const out: MarketSuggestion[] = [];
  for (const m of ranked) {
    const s = stateById.get(m.onchainId);
    const media = m.media as Record<string, unknown> | null;
    let thumbUrl: string | null = null;
    if (media) {
      if (typeof media.image === "string") thumbUrl = media.image;
      else if (media.kind === "image" && typeof media.path === "string") {
        thumbUrl = await signMediaUrl(media.path, 3600).catch(() => null);
      }
    }
    out.push({
      onchainId: m.onchainId,
      title: m.title,
      reason: m.reason,
      score: m.score,
      thumbUrl,
      backedUsd: s?.volume_total_usd != null ? Number(s.volume_total_usd) : null,
      believers:
        s != null
          ? Number(s.believers_yes ?? 0) +
            Number(s.believers_no ?? 0) +
            Number(s.believers_mixed ?? 0)
          : null,
      yesPct: s?.money_yes_pct != null ? Number(s.money_yes_pct) : null,
    });
  }
  return out;
}
