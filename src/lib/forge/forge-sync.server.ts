/**
 * Forge — mirror worker progress into Conviction's own tables.
 *
 * The worker drives the pipeline autonomously and holds the live truth; but it
 * has no access to this database, so the Forge UI (which reads `forge_jobs`,
 * `forge_events`, …) never moves on its own. This function is the bridge: it
 * pulls the worker's `GET /jobs/:id` snapshot and writes it into our tables.
 *
 * It is safe to call on every poll — status never regresses, events de-dupe,
 * and objections/checks upsert by a deterministic id.
 *
 * Place at: src/lib/forge/forge-sync.server.ts
 */
import { serviceClient } from "../supabase-clients";
import { forgeWorker, workerConfigured } from "./worker.server";
import type { ForgeStatus } from "./types";
import type { Json } from "../../integrations/supabase/types";

/** The shape of the worker's GET /jobs/:id `detail` payload. */
type WorkerDetail = {
  status: string;
  phase: string | null;
  plan: unknown;
  planLockedAt: string | null;
  branchName: string | null;
  prUrl: string | null;
  diffSummary: unknown;
  error: string | null;
  cost?: { inputTokens: number; outputTokens: number; costUsd: number };
  objections?: Array<{
    id: string;
    round: number;
    severity: string;
    title: string;
    body: string | null;
    status: string;
    createdAt: string;
  }>;
  checks?: Array<{
    name: string;
    command: string;
    status: string;
    durationMs: number;
    outputSummary?: string;
    failureSummary?: string;
    position: number;
    startedAt: string | null;
    completedAt: string | null;
  }>;
  events?: Array<{
    ts: string;
    level: string;
    role: string;
    kind: string;
    message: string;
    detail?: unknown;
  }>;
};

/** Pipeline order, so a mirror never drags the status backwards. */
const ORDER: ForgeStatus[] = [
  "DRAFT",
  "ANALYZING",
  "BUILDER_PLAN",
  "CHALLENGER_REVIEW",
  "BUILDER_REVISION",
  "PLAN_LOCKED",
  "IMPLEMENTING",
  "VERIFYING",
  "REVIEWING",
  "QA",
  "READY_FOR_HUMAN",
  "PR_CREATED",
  "COMPLETED",
];
const rank = (s: ForgeStatus) => Math.max(0, ORDER.indexOf(s));

/** Translate the worker's (status, phase) into a Conviction ForgeStatus. */
function toForgeStatus(status: string, phase: string | null): ForgeStatus {
  if (status === "cancelled") return "CANCELLED";
  if (status === "failed") return "FAILED";
  if (status === "pr_created" || phase === "pr") return "PR_CREATED";
  if (status === "ready_for_human" || phase === "human") return "READY_FOR_HUMAN";
  if (status === "plan_locked") return "PLAN_LOCKED";
  switch (phase) {
    case "analyze":
      return "ANALYZING";
    case "plan":
      return "BUILDER_PLAN";
    case "debate":
    case "lock": // debate done, awaiting the human plan lock
      return "CHALLENGER_REVIEW";
    case "implement":
      return "IMPLEMENTING";
    case "verify":
      return "VERIFYING";
    case "review":
    case "security":
      return "REVIEWING";
    case "qa":
      return "QA";
  }
  switch (status) {
    case "created":
    case "cloning":
      return "ANALYZING";
    case "planning":
    case "revising":
      return "BUILDER_PLAN";
    case "debating":
      return "CHALLENGER_REVIEW";
    case "implementing":
      return "IMPLEMENTING";
    case "verifying":
      return "VERIFYING";
    case "reviewing":
      return "REVIEWING";
    case "qa":
      return "QA";
    default:
      return "ANALYZING";
  }
}

export async function syncForgeJobFromWorker(jobId: string): Promise<void> {
  if (!workerConfigured()) return;
  const db = serviceClient();

  const { data: row } = await db
    .from("forge_jobs")
    .select("worker_job_id, status")
    .eq("id", jobId)
    .maybeSingle();
  const workerJobId = row?.worker_job_id;
  if (!workerJobId) return;
  const current = (row?.status ?? null) as ForgeStatus | null;
  if (current === "COMPLETED" || current === "CANCELLED") return; // nothing left to mirror

  let detail: WorkerDetail;
  try {
    const res = await forgeWorker.getJob(workerJobId);
    if (!res?.detail || typeof res.detail !== "object") return;
    detail = res.detail as WorkerDetail;
  } catch {
    return; // worker unreachable — leave what we have; the UI reads the DB
  }

  // 1) The job row.
  const mapped = toForgeStatus(detail.status, detail.phase ?? null);
  const advance =
    mapped === "FAILED" || mapped === "CANCELLED" || !current || rank(mapped) >= rank(current);
  await db
    .from("forge_jobs")
    .update({
      ...(advance ? { status: mapped } : {}),
      current_phase: detail.phase ?? null,
      plan: (detail.plan ?? null) as Json,
      plan_locked_at: detail.planLockedAt ?? null,
      branch_name: detail.branchName ?? null,
      pr_url: detail.prUrl ?? null,
      diff_summary: (detail.diffSummary ?? null) as Json,
      total_cost_usd: detail.cost?.costUsd ?? 0,
      input_tokens: detail.cost?.inputTokens ?? 0,
      output_tokens: detail.cost?.outputTokens ?? 0,
      error: detail.error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  // 2) Objections — upsert by a deterministic id.
  if (detail.objections?.length) {
    await db.from("forge_objections").upsert(
      detail.objections.map((o) => ({
        id: `${jobId}:${o.id}`,
        job_id: jobId,
        round: o.round,
        severity: o.severity,
        title: o.title,
        body: o.body,
        status: o.status,
        created_at: o.createdAt,
      })),
      { onConflict: "id" },
    );
  }

  // 3) Checks — upsert by a deterministic id.
  if (detail.checks?.length) {
    await db.from("forge_checks").upsert(
      detail.checks.map((c) => ({
        id: `${jobId}:${c.position}`,
        job_id: jobId,
        name: c.name,
        command: c.command,
        status: c.status,
        started_at: c.startedAt,
        completed_at: c.completedAt,
        duration_ms: c.durationMs,
        output_summary: c.outputSummary ?? null,
        failure_summary: c.failureSummary ?? null,
        position: c.position,
      })),
      { onConflict: "id" },
    );
  }

  // 4) Events — insert only the ones we haven't mirrored yet, keyed by the
  //    worker timestamp we stash in `detail.workerTs`.
  if (detail.events?.length) {
    const { data: existing } = await db.from("forge_events").select("detail").eq("job_id", jobId);
    const seen = new Set(
      (existing ?? [])
        .map((r) => (r.detail as { workerTs?: string } | null)?.workerTs)
        .filter(Boolean),
    );
    const rows = detail.events
      .filter((e) => !seen.has(e.ts))
      .map((e) => ({
        job_id: jobId,
        kind: e.kind,
        level: e.level,
        role: e.role,
        message: e.message,
        detail: {
          workerTs: e.ts,
          ...(e.detail && typeof e.detail === "object" ? (e.detail as Record<string, unknown>) : {}),
        } as Json,
      }));
    if (rows.length) await db.from("forge_events").insert(rows);
  }
}
