/**
 * Row → record. One boundary, one translation. Pure, so the shapes the UI
 * renders can be exercised without a database.
 */
import type {
  DiffSummary,
  ForgeCheck,
  ForgeEvent,
  ForgeJob,
  ForgeModelRun,
  ForgeObjection,
  ForgePlan,
} from "./types";

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (v == null ? 0 : Number(v));

export function toJob(r: Row): ForgeJob {
  return {
    id: String(r.id),
    createdBy: str(r.created_by),
    request: String(r.request ?? ""),
    mode: r.mode as ForgeJob["mode"],
    status: r.status as ForgeJob["status"],
    currentPhase: str(r.current_phase),
    builderModel: String(r.builder_model ?? ""),
    challengerModel: String(r.challenger_model ?? ""),
    escalationModel: String(r.escalation_model ?? ""),
    verificationProfile: (str(r.verification_profile) ?? null) as ForgeJob["verificationProfile"],
    plan: (r.plan as ForgePlan | null) ?? null,
    planLockedAt: str(r.plan_locked_at),
    branchName: str(r.branch_name),
    prUrl: str(r.pr_url),
    diffSummary: (r.diff_summary as DiffSummary | null) ?? null,
    workerJobId: str(r.worker_job_id),
    totalCostUsd: num(r.total_cost_usd),
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    error: str(r.error),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function toEvent(r: Row): ForgeEvent {
  return {
    id: Number(r.id),
    kind: String(r.kind ?? ""),
    level: (str(r.level) ?? "info") as ForgeEvent["level"],
    role: (str(r.role) ?? null) as ForgeEvent["role"],
    message: String(r.message ?? ""),
    detail: (r.detail as ForgeEvent["detail"]) ?? null,
    createdAt: String(r.created_at),
  };
}

export function toObjection(r: Row): ForgeObjection {
  return {
    id: String(r.id),
    round: Number(r.round ?? 1),
    severity: r.severity as ForgeObjection["severity"],
    title: String(r.title ?? ""),
    body: str(r.body),
    status: r.status as ForgeObjection["status"],
    resolution: str(r.resolution),
    createdAt: String(r.created_at),
    resolvedAt: str(r.resolved_at),
  };
}

export function toCheck(r: Row): ForgeCheck {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    command: str(r.command),
    status: r.status as ForgeCheck["status"],
    startedAt: str(r.started_at),
    completedAt: str(r.completed_at),
    durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
    outputSummary: str(r.output_summary),
    failureSummary: str(r.failure_summary),
    position: Number(r.position ?? 0),
  };
}

export function toModelRun(r: Row): ForgeModelRun {
  return {
    id: String(r.id),
    role: r.role as ForgeModelRun["role"],
    provider: String(r.provider ?? "openrouter"),
    modelId: String(r.model_id ?? ""),
    phase: str(r.phase),
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    costUsd: num(r.cost_usd),
    latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
    status: (str(r.status) ?? "ok") as ForgeModelRun["status"],
    error: str(r.error),
    createdAt: String(r.created_at),
  };
}
