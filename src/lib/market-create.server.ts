/**
 * Market creation — server-only helpers.
 *
 * AI review (question quality + category), duplicate detection and byte-level
 * media verification live here. Nothing in this file is reachable from the
 * browser bundle.
 */
import { serviceClient } from "@/lib/supabase-clients";
import {
  textScore,
  contentTokens,
  normalizeQuestion,
  bandFor,
  byConsolidation,
  livenessScore,
  BANDS,
  type Relation,
} from "@/domain/question-discovery";
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
 * A FEW ALTERNATE PHRASINGS — the right rail's job, and never the form's.
 *
 * The form used to carry a single "Polish" rewrite inline, which appeared a
 * beat after the writer paused typing and shoved every field below it down. That
 * is two problems in one: the help arrived as a layout shift, and one rewrite is
 * not a choice. Both move here. This returns 2–3 genuinely different angles the
 * rail offers beside the question, so nothing the AI does can move a field, and
 * the writer picks a direction rather than accepting a single edit.
 *
 * DISTINCT, AND NEVER THE ORIGINAL. Alternates are normalised and de-duplicated
 * against the draft and each other (the same `normalizeQuestion` the discovery
 * layer uses), so a rewrite that only changed the punctuation never fills a slot.
 * Unavailable AI simply yields none — the rail then renders nothing, exactly as
 * it does when the House has no spark. Silence is honest; a padded rail is not.
 */
export async function alternateQuestions(question: string): Promise<string[]> {
  const q = question.trim();
  if (q.length < 8) return [];
  const raw = await askAI(
    [
      "You rewrite opinion-market questions for a permissionless prediction app.",
      "Given a draft, return 2-3 ALTERNATE versions of it — each a single, sharply-worded claim people can back YES or NO on today.",
      "They do NOT need a real-world resolution date — these are opinion markets.",
      "Make each a genuinely different angle (for example: sharper, broader, or more provocative), never a trivial rewording of the draft or of each other.",
      "Each must be under 160 characters, and none may repeat the original.",
      'Reply ONLY as JSON: {"alternates":[string, string, ...]}',
    ].join(" "),
    q,
  );
  const parsed = parseJson<{ alternates?: unknown }>(raw);
  const list = Array.isArray(parsed?.alternates) ? parsed.alternates : [];
  // Guard against the model echoing the draft or itself: normalise once and
  // keep only the first appearance of each distinct claim.
  const seen = new Set<string>([normalizeQuestion(q)]);
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (t.length < 8 || t.length > 200) continue;
    const key = normalizeQuestion(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * FOUR CONTESTED QUESTIONS ON A TOPIC — the left rail's spark generator.
 *
 * The personalised House idea only exists once somebody has a history worth
 * reading. A first-time writer staring at an empty form got an empty column,
 * which is honest but useless. A topic is the smallest input that makes a
 * genuinely interesting question possible without pretending to know the
 * person, so the rail asks for one and this answers it.
 *
 * CONTESTED, NOT TRIVIA. The whole product fails if the answer is lookup-able:
 * every question must be one where informed people actually split.
 */
export async function topicIdeas(topic: string): Promise<string[]> {
  const t = topic.trim().slice(0, 60);
  if (!t) return [];
  const raw = await askAI(
    [
      "You create provocative opinion markets for a permissionless belief app.",
      "Given a TOPIC, return exactly 4 claims that make people instinctively pick a side.",
      "These are not trivia questions, forecasts, or facts to look up. They are arguments people would actually have at dinner, at work, in a group chat, or on a first date.",
      "Write like Larry David found the uncomfortable premise everyone was politely avoiding.",
      "Each claim should: expose a real social tension, hypocrisy, taboo, double standard, or unpopular truth; make YES and NO both feel defensible; be specific enough to trigger an immediate reaction; sound like something a real person would say, not a survey question; avoid bland framing like 'Do you think', 'Is it important', or 'Should society'; avoid obvious consensus, settled facts, trivia, and niche technical debates; be under 140 characters; be meaningfully different from the other three.",
      "Prefer claims with stakes around status, money, sex, relationships, work, parenting, technology, culture, ambition, fairness, or human behavior.",
      "Push toward the sentence people are thinking but usually soften before saying out loud.",
      'Bad: "Is remote work better for productivity?" Better: "Most people who hate remote work really hate not being able to watch their employees."',
      'Bad: "Should AI be regulated?" Better: "People demanding AI regulation mostly want protection from becoming replaceable."',
      'Bad: "Is dating harder today?" Better: "Dating apps didn\'t ruin dating. They just exposed how disposable everyone thinks everyone else is."',
      'Return ONLY valid JSON: {"ideas":["…","…","…","…"]}',
    ].join(" "),
    t,
  );
  const parsed = parseJson<{ ideas?: unknown }>(raw);
  const list = Array.isArray(parsed?.ideas) ? parsed.ideas : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    if (s.length < 8 || s.length > 200) continue;
    const key = normalizeQuestion(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 4) break;
  }
  return out;
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
  /**
   * How close this is, as a band rather than a number. The rail states its
   * confidence in words, and a reader should never be shown 0.71 — see the note
   * on BANDS: no numeric cut is honest enough to call something a duplicate.
   */
  band: Relation;
  thumbUrl: string | null;
  backedUsd: number | null;
  believers: number | null;
  yesPct: number | null;
  /** Last trade, so the rail can say how alive the room is. Never a gate. */
  lastActivityMs: number | null;
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
 * Ranked "someone is already having this conversation" candidates.
 *
 * Three signals, strongest first: identical uploaded bytes, the same external
 * link, then question-text overlap. Stats come from the same `market_state`
 * read model the rest of the app renders — nothing here is invented.
 *
 * SIMILARITY GATES, ACTIVITY BREAKS NEAR-TIES. The band decides whether a market
 * may appear at all; `byConsolidation` then orders, and it quantises the score
 * before liveness is consulted so a busy room can never outrank a semantically
 * closer one. Both come from @/domain/question-discovery — this file scores,
 * gates and sorts with the same code the discovery module does, and owns none
 * of it.
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

  // SIMILARITY GATES. The cut is `BANDS.related`, the same edge the discovery
  // module uses, replacing a private 0.34 that let through pairs sharing a sport
  // or an asset class and nothing else. A market below the band is not a quieter
  // suggestion, it is a wrong one, and no amount of activity may promote it.
  // The one unarguable claim, and the only place `duplicate` may come from: the
  // same question, however it was typed. Everything else is a band, because no
  // numeric cut separates "France win 2026" from "have you cheated / been
  // cheated on" — see BANDS.
  const key = normalizeQuestion(question);
  const eligible = [...best.entries()]
    .map(([onchainId, v]) => ({
      onchainId,
      ...v,
      band: normalizeQuestion(v.title) === key ? ("duplicate" as Relation) : bandFor(v.score),
    }))
    .filter((m) => m.score >= BANDS.related)
    .sort((a, b) => b.score - a.score)
    // A bounded shortlist, so liveness costs one `.in()` on a handful of ids
    // rather than a second pass over the corpus. Wider than `limit` because
    // activity may still reorder inside it.
    .slice(0, Math.max(limit * 4, 12));
  if (!eligible.length) return [];

  const { data: states } = await db
    .from("market_state")
    .select(
      "onchain_id, volume_total_usd, believers_yes, believers_no, believers_mixed, money_yes_pct, directional_believers, last_trade_at, side_balance",
    )
    .in(
      "onchain_id",
      eligible.map((m) => m.onchainId),
    );
  const stateById = new Map((states ?? []).map((s) => [Number(s.onchain_id), s]));

  // ACTIVITY ONLY BREAKS NEAR-TIES — `byConsolidation` is the one ordering, and
  // it quantises score into TIE_EPS buckets before liveness is consulted at all.
  const nowMs = Date.now();
  const ranked = eligible
    .map((m) => {
      const s = stateById.get(m.onchainId);
      const at = s?.last_trade_at ? Date.parse(String(s.last_trade_at)) : NaN;
      return {
        ...m,
        lastActivityMs: Number.isFinite(at) ? at : null,
        liveness: livenessScore(
          {
            participants: s?.directional_believers != null ? Number(s.directional_believers) : null,
            lastActivityMs: Number.isFinite(at) ? at : null,
            // `side_balance` is signed lopsidedness, so a room split down the
            // middle is 0 and a one-sided one is ±1. Contest is the inverse.
            contested:
              s?.side_balance != null ? 1 - Math.min(1, Math.abs(Number(s.side_balance))) : null,
          },
          nowMs,
        ),
      };
    })
    .sort(byConsolidation)
    .slice(0, limit);

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
      band: m.band,
      lastActivityMs: m.lastActivityMs,
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
