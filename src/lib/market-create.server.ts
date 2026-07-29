/**
 * Market creation — server-only helpers.
 *
 * AI review (question quality + category), duplicate detection and byte-level
 * media verification live here. Nothing in this file is reachable from the
 * browser bundle.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { assertAllowedBytes } from "@/lib/market-create";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

export const CATEGORIES = [
  "Relationships",
  "Money",
  "Technology",
  "Society",
  "Human Nature",
  "Politics",
  "Morality",
  "Health",
  "Entertainment",
  "Other",
] as const;

export interface QuestionReview {
  ok: boolean;
  /** Why it was rejected, in plain language. */
  reason: string | null;
  /** A tightened rewrite the user can accept with one tap. */
  suggestion: string | null;
  category: string;
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
      `category must be one of: ${CATEGORIES.join(", ")}.`,
      "blocked=true ONLY for illegal content, sexual content involving minors, doxxing, or targeted harassment/violence against a real identifiable person.",
      "suggestion: a tighter rewrite under 160 characters, or null if the original is already good.",
    ].join(" "),
    question,
  );
  const parsed = parseJson<QuestionReview>(raw);
  if (!parsed) return { ok: true, reason: null, suggestion: null, category: "Other", blocked: false };
  return {
    ok: parsed.blocked ? false : parsed.ok !== false,
    reason: parsed.reason ?? null,
    suggestion: parsed.suggestion ?? null,
    category: CATEGORIES.includes(parsed.category as (typeof CATEGORIES)[number])
      ? parsed.category
      : "Other",
    blocked: parsed.blocked === true,
  };
}

const STOP = new Set([
  "the","a","an","is","are","will","be","to","of","in","on","for","and","or","that","this","it",
  "do","does","did","by","at","with","than","more","less","who","what","when","why","how",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Jaccard overlap — cheap, deterministic, and good enough to catch near-dupes. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export interface DuplicateMatch {
  onchainId: number | null;
  questionId: string | null;
  title: string;
  score: number;
}

/** Existing markets that look like the same question. */
export async function findSimilarMarkets(question: string, limit = 5): Promise<DuplicateMatch[]> {
  const db = serviceClient();
  const [pov, own] = await Promise.all([
    db.from("markets").select("onchain_id, title").not("title", "is", null).limit(2000),
    db.from("conviction_markets").select("onchain_id, question_id, question").limit(2000),
  ]);
  const pool: DuplicateMatch[] = [];
  for (const r of pov.data ?? []) {
    pool.push({
      onchainId: Number(r.onchain_id),
      questionId: null,
      title: String(r.title),
      score: similarity(question, String(r.title)),
    });
  }
  for (const r of (own.data ?? []) as { onchain_id: number | null; question_id: string; question: string }[]) {
    pool.push({
      onchainId: r.onchain_id != null ? Number(r.onchain_id) : null,
      questionId: r.question_id,
      title: r.question,
      score: similarity(question, r.question),
    });
  }
  return pool
    .filter((m) => m.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

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
    html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, "i"))?.[1] ??
    null;
  return {
    url: parsed.toString(),
    title: pick("og:title") ?? html.match(/<title[^>]*>([^<]{1,200})/i)?.[1]?.trim() ?? parsed.hostname,
    image: pick("og:image"),
    site: parsed.hostname,
  };
}
