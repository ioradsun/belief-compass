/**
 * Forge model registry.
 *
 * Models are a configuration concern, not a call-site concern. Nothing in the
 * UI names a provider; it names a ROLE, and the role resolves here. Swapping
 * the Builder later is an edit to this file, not a hunt through components.
 *
 * Costs are per million tokens, in USD. They are metadata for the ledger — if
 * a provider returns no usage, the run is still recorded, just uncosted.
 */

export type ModelProvider = "openrouter";
export type ModelRole = "builder" | "challenger" | "escalation";

export type ModelConfig = {
  provider: ModelProvider;
  modelId: string;
  role: ModelRole;
  enabled: boolean;
  /** USD per 1M input tokens. */
  inputCost: number;
  /** USD per 1M output tokens. */
  outputCost: number;
  contextWindow: number;
  metadata: {
    label: string;
    purpose: string;
    /** Called on every job, or only on escalation. */
    invocation: "routine" | "escalation-only";
  };
};

export const MODEL_REGISTRY: Record<ModelRole, ModelConfig> = {
  builder: {
    provider: "openrouter",
    modelId: "deepseek/deepseek-v4-flash",
    role: "builder",
    enabled: true,
    inputCost: 0.27,
    outputCost: 1.1,
    contextWindow: 164_000,
    metadata: {
      label: "Builder",
      purpose:
        "Smallest complete implementation. Reuses existing Conviction mechanisms before inventing new ones.",
      invocation: "routine",
    },
  },
  challenger: {
    provider: "openrouter",
    modelId: "minimax/minimax-m2.5",
    role: "challenger",
    enabled: true,
    inputCost: 0.3,
    outputCost: 1.2,
    contextWindow: 200_000,
    metadata: {
      label: "Challenger",
      purpose:
        "Proves the Builder wrong. Duplicate mechanisms, drift, hidden regressions, simpler implementations.",
      invocation: "routine",
    },
  },
  escalation: {
    provider: "openrouter",
    modelId: "anthropic/claude-opus-5",
    role: "escalation",
    enabled: true,
    inputCost: 15,
    outputCost: 75,
    contextWindow: 200_000,
    metadata: {
      label: "Escalation",
      purpose: "Supreme Court. Deadlocks, security, money, destructive migrations only.",
      invocation: "escalation-only",
    },
  },
};

export function modelFor(role: ModelRole): ModelConfig {
  return MODEL_REGISTRY[role];
}

export function costOf(role: ModelRole, inputTokens: number, outputTokens: number): number {
  const m = MODEL_REGISTRY[role];
  return (inputTokens / 1e6) * m.inputCost + (outputTokens / 1e6) * m.outputCost;
}
