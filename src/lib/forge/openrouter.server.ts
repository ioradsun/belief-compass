/**
 * OpenRouter — server side only.
 *
 * The key never leaves the worker runtime. There is exactly one place in this
 * app that constructs an OpenRouter request, and it is here; UI code names a
 * role and gets text back, or gets a named failure.
 *
 * Phase 1 note: nothing calls this yet on a normal path. It exists so the
 * orchestration layer has a real client to reach for rather than a stub that
 * later has to be replaced.
 */
import { costOf, modelFor, type ModelRole } from "./models";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ModelResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  modelId: string;
};

export class OpenRouterNotConfigured extends Error {
  constructor() {
    super("OPENROUTER_API_KEY is not configured.");
    this.name = "OpenRouterNotConfigured";
  }
}

export function openRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export async function callModel(
  role: ModelRole,
  messages: ChatMessage[],
  opts: { timeoutMs?: number; maxTokens?: number } = {},
): Promise<ModelResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new OpenRouterNotConfigured();

  const model = modelFor(role);
  if (!model.enabled) throw new Error(`Forge: model role "${role}" is disabled.`);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "X-Title": "Conviction Forge",
      },
      body: JSON.stringify({
        model: model.modelId,
        messages,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: role === "challenger" ? 0.2 : 0.3,
      }),
    });

    if (!res.ok) {
      // Provider bodies can be long and can echo the prompt. Keep it short.
      const body = (await res.text()).slice(0, 400);
      throw new Error(`OpenRouter ${res.status}: ${body}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const inputTokens = json.usage?.prompt_tokens ?? 0;
    const outputTokens = json.usage?.completion_tokens ?? 0;

    return {
      text: json.choices?.[0]?.message?.content ?? "",
      inputTokens,
      outputTokens,
      // Missing usage metadata costs nothing rather than blocking the run.
      costUsd: costOf(role, inputTokens, outputTokens),
      latencyMs: Date.now() - started,
      modelId: model.modelId,
    };
  } finally {
    clearTimeout(timer);
  }
}
