/**
 * Market AI analysis (server) — the "understand the market ONCE" half of the feed.
 *
 * Meaning is analysed at ingestion and stored; the feed only ever reads the
 * stored row. Analysis reruns when MEANING changes (question, description,
 * media, or the engine/prompt version) — never when price, volume or sentiment
 * move. That is exactly what `contentHash` encodes.
 */
import { serviceClient } from "@/lib/supabase-clients";

export const ANALYSIS_VERSION = 1;
const MODEL = "google/gemini-3.6-flash";
const EMBED_MODEL = "openai/text-embedding-3-small";
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export interface MarketMeaningInput {
  onchainId: number;
  question: string;
  description?: string | null;
  category?: string | null;
  mediaUrl?: string | null;
}

/** Stable fingerprint of everything that changes a market's MEANING. */
export function contentHash(m: MarketMeaningInput): string {
  const raw = [
    ANALYSIS_VERSION,
    m.question.trim().toLowerCase(),
    (m.description ?? "").trim().toLowerCase(),
    m.mediaUrl ?? "",
  ].join("|");
  let h = 5381;
  for (let i = 0; i < raw.length; i += 1) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  return `v${ANALYSIS_VERSION}-${h.toString(36)}-${raw.length}`;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string" },
    subcategory: { type: "string" },
    topic: { type: "string" },
    summary: { type: "string" },
    audience: { type: "string" },
    related_topics: { type: "array", items: { type: "string" } },
    clarity_score: { type: "number" },
    answerability_score: { type: "number" },
    novelty_score: { type: "number" },
    debate_score: { type: "number" },
    identity_score: { type: "number" },
    time_sensitivity: { type: "number" },
    media_relevance: { type: "number" },
    quality_score: { type: "number" },
    risk_flags: { type: "array", items: { type: "string" } },
  },
  required: [
    "category",
    "subcategory",
    "topic",
    "summary",
    "audience",
    "related_topics",
    "clarity_score",
    "answerability_score",
    "novelty_score",
    "debate_score",
    "identity_score",
    "time_sensitivity",
    "media_relevance",
    "quality_score",
    "risk_flags",
  ],
} as const;

const SYSTEM = `You analyse prediction-market questions for a discovery feed.
Return STRUCTURED data only — never an essay, never a prediction, never an opinion on the outcome.
All *_score fields are 0..1.
clarity_score: is the wording unambiguous and unbiased?
answerability_score: can this settle cleanly as YES or NO?
novelty_score: is the idea fresh rather than a rehash?
debate_score: would reasonable people genuinely disagree?
identity_score: does taking a side say something about who a person is?
time_sensitivity: how much does this decay with time?
media_relevance: does the attached media matter to the question?
quality_score: overall worth surfacing to a stranger.
risk_flags: short codes only, e.g. "unverifiable", "manipulable", "offensive", "biased_wording", "duplicate_likely". Empty when clean.
summary: one neutral sentence.
audience: one short phrase describing who cares.`;

async function gateway(path: string, body: unknown): Promise<Record<string, unknown>> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const res = await fetch(`${GATEWAY}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AI ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Record<string, unknown>;
}

async function analyseMeaning(m: MarketMeaningInput): Promise<Record<string, unknown>> {
  const json = await gateway("/chat/completions", {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Question: ${m.question}\nDescription: ${m.description ?? "(none)"}\nStated category: ${m.category ?? "(none)"}\nMedia: ${m.mediaUrl ?? "(none)"}`,
      },
    ],
    tools: [
      {
        type: "function",
        function: { name: "store_analysis", description: "Store the analysis", parameters: SCHEMA },
      },
    ],
    tool_choice: { type: "function", function: { name: "store_analysis" } },
  });
  const choices = json.choices as
    | { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[]
    | undefined;
  const args = choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("AI returned no structured analysis");
  return JSON.parse(args) as Record<string, unknown>;
}

async function embed(text: string): Promise<number[]> {
  const json = await gateway("/embeddings", { model: EMBED_MODEL, input: text });
  const data = json.data as { embedding?: number[] }[] | undefined;
  const v = data?.[0]?.embedding;
  if (!Array.isArray(v)) throw new Error("AI returned no embedding");
  return v;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

const DUPLICATE_THRESHOLD = 0.9;

/**
 * Analyse one market and store the result. Never throws into the caller's path:
 * a failure is recorded on the row so the job can retry, and the feed simply
 * ranks the market with neutral quality until then.
 */
export async function analyseMarket(m: MarketMeaningInput): Promise<"ready" | "failed"> {
  const sb = serviceClient();
  const hash = contentHash(m);
  try {
    const [analysis, vector] = await Promise.all([
      analyseMeaning(m),
      embed(`${m.question}\n${m.description ?? ""}`),
    ]);

    // Duplicate clustering: join the nearest existing cluster above threshold,
    // otherwise start one keyed on this market.
    const { data: others } = await sb
      .from("market_ai_analysis")
      .select("onchain_id, embedding, duplicate_cluster_id")
      .eq("status", "ready")
      .neq("onchain_id", m.onchainId)
      .limit(500);
    let clusterId = `c${m.onchainId}`;
    let similarity = 0;
    for (const o of (others ?? []) as {
      embedding: unknown;
      duplicate_cluster_id: string | null;
      onchain_id: number;
    }[]) {
      if (!Array.isArray(o.embedding)) continue;
      const sim = cosine(vector, (o.embedding as number[]).map(Number));
      if (sim > similarity) {
        similarity = sim;
        if (sim >= DUPLICATE_THRESHOLD) clusterId = o.duplicate_cluster_id ?? `c${o.onchain_id}`;
      }
    }

    const num = (k: string) => {
      const v = Number(analysis[k]);
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
    };
    await sb.from("market_ai_analysis").upsert(
      {
        onchain_id: m.onchainId,
        content_hash: hash,
        status: "ready",
        engine_version: ANALYSIS_VERSION,
        analyzed_at: new Date().toISOString(),
        category: (analysis.category as string) ?? null,
        subcategory: (analysis.subcategory as string) ?? null,
        topic: (analysis.topic as string) ?? null,
        summary: (analysis.summary as string) ?? null,
        audience: (analysis.audience as string) ?? null,
        related_topics: (analysis.related_topics as string[]) ?? [],
        clarity_score: num("clarity_score"),
        answerability_score: num("answerability_score"),
        novelty_score: num("novelty_score"),
        debate_score: num("debate_score"),
        identity_score: num("identity_score"),
        time_sensitivity: num("time_sensitivity"),
        media_relevance: num("media_relevance"),
        quality_score: num("quality_score"),
        risk_flags: (analysis.risk_flags as string[]) ?? [],
        embedding: vector,
        duplicate_cluster_id: clusterId,
        duplicate_similarity: similarity,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "onchain_id" },
    );
    return "ready";
  } catch (e) {
    await sb.from("market_ai_analysis").upsert(
      {
        onchain_id: m.onchainId,
        content_hash: hash,
        status: "failed",
        last_error: e instanceof Error ? e.message.slice(0, 500) : "analysis failed",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "onchain_id" },
    );
    return "failed";
  }
}

/**
 * Queue a market for background analysis. Called right after a market is saved
 * or materially edited — the user never waits for it.
 */
export async function queueMarketAnalysis(m: MarketMeaningInput): Promise<void> {
  const sb = serviceClient();
  const hash = contentHash(m);
  const { data: existing } = await sb
    .from("market_ai_analysis")
    .select("content_hash, status")
    .eq("onchain_id", m.onchainId)
    .maybeSingle();
  const row = existing as { content_hash?: string; status?: string } | null;
  if (row?.content_hash === hash && row.status === "ready") return; // meaning unchanged
  await sb.from("market_ai_analysis").upsert(
    {
      onchain_id: m.onchainId,
      content_hash: hash,
      status: "pending",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "onchain_id" },
  );
}

/** Markets whose stored meaning is missing or out of date. */
export async function pendingAnalysisTargets(limit: number): Promise<MarketMeaningInput[]> {
  const sb = serviceClient();
  const [{ data: markets }, { data: rows }] = await Promise.all([
    sb
      .from("markets")
      .select("onchain_id, title, category, our_metadata")
      .order("first_seen", { ascending: false })
      .limit(300),
    sb.from("market_ai_analysis").select("onchain_id, content_hash, status, attempts"),
  ]);
  const byId = new Map(
    ((rows ?? []) as { onchain_id: number; content_hash: string; status: string; attempts: number }[]).map(
      (r) => [Number(r.onchain_id), r],
    ),
  );
  const out: MarketMeaningInput[] = [];
  for (const m of (markets ?? []) as {
    onchain_id: number;
    title: string | null;
    category: string | null;
    our_metadata: Record<string, unknown> | null;
  }[]) {
    if (!m.title) continue;
    const meta = m.our_metadata ?? {};
    const input: MarketMeaningInput = {
      onchainId: Number(m.onchain_id),
      question: m.title,
      description: (meta["description"] as string | null) ?? null,
      category: m.category,
      mediaUrl: ((meta["media"] as { url?: string } | null)?.url as string | null) ?? null,
    };
    const row = byId.get(input.onchainId);
    const stale = !row || row.content_hash !== contentHash(input) || row.status !== "ready";
    const givenUp = row?.status === "failed" && Number(row.attempts ?? 0) >= 3;
    if (stale && !givenUp) out.push(input);
    if (out.length >= limit) break;
  }
  return out;
}
