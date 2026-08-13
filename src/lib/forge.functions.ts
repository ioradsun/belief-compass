/**
 * Forge — server functions.
 *
 * Thin wrappers only. Every one of them is gated by the SAME admin session the
 * moderation console already uses; Forge does not introduce a second identity
 * system. The service-role client is loaded inside handlers so nothing
 * server-only reaches a client bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  branchNameFor,
  defaultProfileForMode,
  type ForgeMode,
  type ForgeStatus,
} from "./forge/types";
import { toCheck, toEvent, toJob, toModelRun, toObjection } from "./forge/mappers";
import { MODEL_REGISTRY } from "./forge/models";

export const forgeEnvironment = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const { forgeWorker } = await import("./forge/worker.server");
  const { openRouterConfigured } = await import("./forge/openrouter.server");
  return {
    worker: await forgeWorker.status(),
    openRouterConfigured: openRouterConfigured(),
  };
});

export const forgeListJobs = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const { serviceClient } = await import("./supabase-clients");
  const { data, error } = await serviceClient()
    .from("forge_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toJob);
});

/* ── Model configuration ─────────────────────────────────────────────────────
 * Which OpenRouter model plays each role is a setting, not a code constant. The
 * catalog (with pricing) comes live from OpenRouter; the per-role choice is
 * stored in forge_model_config and overrides the MODEL_REGISTRY defaults.
 */

export type OpenRouterModel = {
  id: string;
  name: string;
  contextLength: number;
  /** USD per 1M tokens. */
  promptPer1M: number;
  completionPer1M: number;
};

let modelsCache: { at: number; data: OpenRouterModel[] } | null = null;
const MODELS_TTL_MS = 10 * 60 * 1000;

/** The full OpenRouter catalog, normalised to per-1M pricing. Cached 10 min. */
export const forgeOpenRouterModels = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.data;

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OpenRouter models ${res.status}`);
  const json = (await res.json()) as {
    data?: {
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
    }[];
  };
  const data: OpenRouterModel[] = (json.data ?? [])
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      contextLength: m.context_length ?? 0,
      promptPer1M: Number(m.pricing?.prompt ?? 0) * 1e6,
      completionPer1M: Number(m.pricing?.completion ?? 0) * 1e6,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  modelsCache = { at: Date.now(), data };
  return data;
});

export type ForgeModelConfig = { builder: string; challenger: string; escalation: string };

/** Per-role model ids, with MODEL_REGISTRY defaults where unset. */
export async function resolveModelConfig(): Promise<ForgeModelConfig> {
  const { serviceClient } = await import("./supabase-clients");
  const { data } = await serviceClient().from("forge_model_config").select("role, model_id");
  const rows = (data ?? []) as { role: string; model_id: string }[];
  const byRole = new Map<string, string>(rows.map((r) => [r.role, r.model_id]));
  return {
    builder: byRole.get("builder") ?? MODEL_REGISTRY.builder.modelId,
    challenger: byRole.get("challenger") ?? MODEL_REGISTRY.challenger.modelId,
    escalation: byRole.get("escalation") ?? MODEL_REGISTRY.escalation.modelId,
  };
}

export const forgeGetModelConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  return resolveModelConfig();
});

export const forgeSetModelConfig = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { role: "builder" | "challenger" | "escalation"; modelId: string }) => data,
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    if (!["builder", "challenger", "escalation"].includes(data.role)) {
      throw new Error(`Invalid role: ${data.role}`);
    }
    const modelId = String(data.modelId ?? "").trim();
    if (!modelId) throw new Error("A model id is required.");
    const { serviceClient } = await import("./supabase-clients");
    const { error } = await serviceClient()
      .from("forge_model_config")
      .upsert({ role: data.role, model_id: modelId }, { onConflict: "role" });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const forgeGetJob = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();

    // Mirror the worker's live progress into our tables before we read them, so
    // the 5-second UI poll reflects the autonomous pipeline. Non-fatal: if the
    // worker is unreachable we fall back to whatever is already persisted.
    try {
      const { syncForgeJobFromWorker } = await import("./forge/forge-sync.server");
      await syncForgeJobFromWorker(data.id);
    } catch {
      /* keep the last known state */
    }

    const { serviceClient } = await import("./supabase-clients");
    const db = serviceClient();
    const [job, events, objections, checks, runs] = await Promise.all([
      db.from("forge_jobs").select("*").eq("id", data.id).maybeSingle(),
      db.from("forge_events").select("*").eq("job_id", data.id).order("id", { ascending: true }),
      db
        .from("forge_objections")
        .select("*")
        .eq("job_id", data.id)
        .order("created_at", { ascending: true }),
      db
        .from("forge_checks")
        .select("*")
        .eq("job_id", data.id)
        .order("position", { ascending: true }),
      db
        .from("forge_model_runs")
        .select("*")
        .eq("job_id", data.id)
        .order("created_at", { ascending: true }),
    ]);
    if (!job.data) return null;
    return {
      job: toJob(job.data),
      events: (events.data ?? []).map(toEvent),
      objections: (objections.data ?? []).map(toObjection),
      checks: (checks.data ?? []).map(toCheck),
      modelRuns: (runs.data ?? []).map(toModelRun),
    };
  });

/**
 * Creates the job record and hands it to the worker when one is connected.
 * When no worker is configured the job is still persisted — in DRAFT, honestly
 * stalled — rather than pretending work began.
 */
/**
 * The guts of job creation — persist the job, cut a branch, hand it to the
 * worker. Reused by the manual creator (below) and the autonomous loop driver
 * (`forge-loop.functions.ts`). NOT admin-gated itself; callers gate.
 */
export async function createForgeJobInternal(input: {
  request: string;
  mode: ForgeMode;
  createdBy?: string;
}): Promise<{ id: string; started: boolean }> {
  const request = String(input.request ?? "").trim();
  if (request.length < 8) throw new Error("Describe the change in a sentence or more.");

  const { serviceClient } = await import("./supabase-clients");
  const db = serviceClient();
  const profile = defaultProfileForMode(input.mode);
  const models = await resolveModelConfig();

  const { data: row, error } = await db
    .from("forge_jobs")
    .insert({
      request,
      mode: input.mode,
      status: "DRAFT" satisfies ForgeStatus,
      builder_model: models.builder,
      challenger_model: models.challenger,
      escalation_model: models.escalation,
      verification_profile: profile,
      created_by: input.createdBy ?? "admin",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const job = toJob(row);
  const branch = branchNameFor(request, job.id);
  await db.from("forge_jobs").update({ branch_name: branch }).eq("id", job.id);
  await db.from("forge_events").insert({
    job_id: job.id,
    kind: "job.created",
    level: "info",
    role: "human",
    message: `Request received — ${input.mode} mode, ${profile} verification profile.`,
  });

  const { forgeWorker, workerConfigured } = await import("./forge/worker.server");
  if (!workerConfigured()) {
    await db.from("forge_events").insert({
      job_id: job.id,
      kind: "worker.missing",
      level: "warn",
      role: "system",
      message: "Forge Worker not connected — job persisted, execution not started.",
    });
    return { id: job.id, started: false };
  }

  try {
    const ref = await forgeWorker.createJob({
      jobId: job.id,
      request,
      mode: input.mode,
      branchName: branch,
      verificationProfile: profile,
      builderModel: job.builderModel,
      challengerModel: job.challengerModel,
      escalationModel: job.escalationModel,
    });
    await db
      .from("forge_jobs")
      .update({ worker_job_id: ref.workerJobId, status: "ANALYZING", current_phase: "analyze" })
      .eq("id", job.id);
    await db.from("forge_events").insert({
      job_id: job.id,
      kind: "worker.accepted",
      level: "success",
      role: "system",
      message: "Forge Worker accepted the job.",
    });
    return { id: job.id, started: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Worker call failed.";
    await db.from("forge_jobs").update({ status: "FAILED", error: message }).eq("id", job.id);
    await db.from("forge_events").insert({
      job_id: job.id,
      kind: "worker.failed",
      level: "error",
      role: "system",
      message,
    });
    return { id: job.id, started: false };
  }
}

export const forgeCreateJob = createServerFn({ method: "POST" })
  .inputValidator((data: { request: string; mode: ForgeMode }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    return createForgeJobInternal(data);
  });

export const forgeCancelJob = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("./supabase-clients");
    const db = serviceClient();
    const { data: row } = await db
      .from("forge_jobs")
      .select("worker_job_id")
      .eq("id", data.id)
      .maybeSingle();

    const { forgeWorker, workerConfigured } = await import("./forge/worker.server");
    if (row?.worker_job_id && workerConfigured()) {
      try {
        await forgeWorker.cancelJob(row.worker_job_id);
      } catch {
        // The local record is still cancelled; the worker is reconciled on poll.
      }
    }
    await db.from("forge_jobs").update({ status: "CANCELLED" }).eq("id", data.id);
    await db.from("forge_events").insert({
      job_id: data.id,
      kind: "job.cancelled",
      level: "warn",
      role: "human",
      message: "Cancelled by operator.",
    });
    return { ok: true as const };
  });

/** Human gate: the plan is locked by a person, never by a model. */
export const forgeApprovePlan = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("./supabase-clients");
    const db = serviceClient();
    const { data: row } = await db
      .from("forge_jobs")
      .select("status, worker_job_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Job not found.");

    const { canTransition } = await import("./forge/types");
    if (!canTransition(row.status as ForgeStatus, "PLAN_LOCKED")) {
      throw new Error(`Plan cannot be locked from ${row.status}.`);
    }

    const { forgeWorker, workerConfigured } = await import("./forge/worker.server");
    if (row.worker_job_id && workerConfigured()) await forgeWorker.lockPlan(row.worker_job_id);

    await db
      .from("forge_jobs")
      .update({
        status: "PLAN_LOCKED",
        plan_locked_at: new Date().toISOString(),
        current_phase: "lock",
      })
      .eq("id", data.id);
    await db.from("forge_events").insert({
      job_id: data.id,
      kind: "plan.locked",
      level: "success",
      role: "human",
      message: "Plan approved and locked.",
    });
    return { ok: true as const };
  });

export const forgeRequestRevision = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; note: string }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("./supabase-clients");
    const db = serviceClient();
    const { data: row } = await db
      .from("forge_jobs")
      .select("worker_job_id")
      .eq("id", data.id)
      .maybeSingle();

    const { forgeWorker, workerConfigured } = await import("./forge/worker.server");
    if (row?.worker_job_id && workerConfigured()) {
      await forgeWorker.runBuilder(row.worker_job_id, data.note);
    }
    await db.from("forge_jobs").update({ status: "BUILDER_REVISION" }).eq("id", data.id);
    await db.from("forge_events").insert({
      job_id: data.id,
      kind: "revision.requested",
      level: "info",
      role: "human",
      message: data.note?.trim() || "Revision requested.",
    });
    return { ok: true as const };
  });

/** Explicit, human-initiated. Phase 1 never auto-ships. */
export const forgeCreatePullRequest = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("./supabase-clients");
    const db = serviceClient();
    const { data: row } = await db
      .from("forge_jobs")
      .select("worker_job_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!row?.worker_job_id) throw new Error("No worker job — nothing has been implemented.");

    const { forgeWorker, workerConfigured } = await import("./forge/worker.server");
    if (!workerConfigured()) throw new Error("Forge Worker not connected.");

    const { url } = await forgeWorker.createPullRequest(row.worker_job_id);
    await db
      .from("forge_jobs")
      .update({ pr_url: url, status: "PR_CREATED", current_phase: "pr" })
      .eq("id", data.id);
    await db.from("forge_events").insert({
      job_id: data.id,
      kind: "pr.created",
      level: "success",
      role: "system",
      message: `Pull request opened: ${url}`,
    });
    return { url };
  });

/**
 * The deploy preview for a job's branch, when the worker publishes one.
 *
 * Read-only and forgiving: a worker that does not implement `/preview` is not
 * an error the operator needs to see, it simply means there is no preview. The
 * Ship station renders that absence honestly rather than offering a dead link.
 */
export const forgePreview = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<{ url: string | null }> => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("./supabase-clients");
    const { data: row } = await serviceClient()
      .from("forge_jobs")
      .select("worker_job_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!row?.worker_job_id) return { url: null };
    const { forgeWorker, workerConfigured } = await import("./forge/worker.server");
    if (!workerConfigured()) return { url: null };
    try {
      return await forgeWorker.getPreview(row.worker_job_id);
    } catch {
      return { url: null };
    }
  });

export const forgeGetDiff = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("./supabase-clients");
    const { data: row } = await serviceClient()
      .from("forge_jobs")
      .select("worker_job_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!row?.worker_job_id) return null;
    const { forgeWorker, workerConfigured } = await import("./forge/worker.server");
    if (!workerConfigured()) return null;
    return await forgeWorker.getDiff(row.worker_job_id);
  });

/**
 * gstack, made visible and requestable.
 *
 * gstack runs inside the worker under OpenCode, which meant the operator had no
 * way to tell whether a department (plan review, engineering review, qa, cso,
 * ship…) had actually run. This asks the worker for one named pass and records
 * the request, so the board on /admin/forge is answering from evidence.
 */
export const forgeRunReview = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; operation: string }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { GSTACK_OPERATIONS } = await import("./forge/types");
    const operation = GSTACK_OPERATIONS.find((o) => o === data.operation);
    if (!operation) throw new Error(`Unknown gstack operation: ${data.operation}`);

    const { serviceClient } = await import("./supabase-clients");
    const db = serviceClient();
    const { data: row } = await db
      .from("forge_jobs")
      .select("worker_job_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!row?.worker_job_id) throw new Error("No worker job — nothing to review yet.");

    const { forgeWorker, workerConfigured } = await import("./forge/worker.server");
    if (!workerConfigured()) throw new Error("Forge Worker not connected.");

    await db.from("forge_events").insert({
      job_id: data.id,
      kind: "gstack.requested",
      level: "info",
      role: "human",
      message: `Requested gstack ${operation}.`,
      detail: { operation },
    });
    if (operation === "qa") await forgeWorker.runQA(row.worker_job_id);
    else await forgeWorker.runReview(row.worker_job_id, operation);
    return { ok: true as const };
  });
