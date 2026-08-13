/**
 * Forge Discovery — the office-hours planning session, server side.
 *
 * Before a job exists, the business and the AI (CTO) talk until there is a
 * structured brief. The worker reads the repo once (the digest) and produces
 * each turn; this module holds the session in `forge_discovery` and, on
 * Proceed, turns the finished plan into a normal Forge job.
 *
 * Admin-gated, like the rest of Forge. The heavy lifting (clone, model calls)
 * happens on the worker; here we orchestrate and persist.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  EMPTY_DISCOVERY_PLAN,
  FORGE_MODES,
  type DiscoveryMessage,
  type DiscoveryPlan,
  type DiscoverySession,
  type ForgeMode,
} from "./forge/types";
import { createForgeJobInternal, resolveModelConfig } from "./forge.functions";
import { workerDiscoveryContext, workerDiscoveryTurn } from "./forge/worker.server";

type Row = {
  id: string;
  request: string;
  mode: string;
  digest: unknown;
  messages: unknown;
  plan: unknown;
  ready: boolean;
  status: string;
  job_id: string | null;
};

function toSession(row: Row): DiscoverySession {
  return {
    id: row.id,
    request: row.request,
    mode: (FORGE_MODES as readonly string[]).includes(row.mode)
      ? (row.mode as ForgeMode)
      : "DEBATE",
    messages: Array.isArray(row.messages) ? (row.messages as DiscoveryMessage[]) : [],
    plan: {
      ...EMPTY_DISCOVERY_PLAN,
      ...(row.plan && typeof row.plan === "object" ? row.plan : {}),
    },
    ready: row.ready === true,
    status: (["active", "proceeded", "abandoned"] as const).includes(row.status as never)
      ? (row.status as DiscoverySession["status"])
      : "active",
    jobId: row.job_id,
  };
}

const SELECT = "id, request, mode, digest, messages, plan, ready, status, job_id";

/** The CTO is the reviewer persona — the critical thinker, not the builder. */
async function ctoModel(): Promise<string> {
  return (await resolveModelConfig()).challenger;
}

/** Turn the finished plan into the rich brief the pipeline's Brief stage reads. */
function briefFromPlan(plan: DiscoveryPlan, request: string): string {
  const list = (h: string, items: string[]) =>
    items.length ? `## ${h}\n${items.map((i) => `- ${i}`).join("\n")}` : "";
  return [
    `# ${plan.title || request}`,
    plan.problem && `## Problem\n${plan.problem}`,
    plan.behavior && `## Desired behavior\n${plan.behavior}`,
    list("Edge cases", plan.edgeCases),
    list("Constraints", plan.constraints),
    list("Acceptance criteria", plan.acceptanceCriteria),
    list("Relevant files (found during discovery)", plan.relevantFiles),
    "_Planned in a Discovery session with the CTO. Build the smallest change that satisfies the above._",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ── start ────────────────────────────────────────────────────────────────*/

export const forgeDiscoveryStart = createServerFn({ method: "POST" })
  .inputValidator((data: { request: string; mode?: string }) => data)
  .handler(async ({ data }): Promise<DiscoverySession> => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const request = String(data.request ?? "").trim();
    if (request.length < 8) throw new Error("Describe what you want in a sentence or more.");
    const mode: ForgeMode = (FORGE_MODES as readonly string[]).includes(data.mode ?? "")
      ? (data.mode as ForgeMode)
      : "DEBATE";

    // One code read, then the CTO's opening question.
    const { digest } = await workerDiscoveryContext(request);
    const turn = await workerDiscoveryTurn({
      request,
      model: await ctoModel(),
      digest,
      messages: [],
    });
    const messages: DiscoveryMessage[] = [
      { role: "ai", content: turn.message, suggestedAnswers: turn.suggestedAnswers },
    ];

    const { serviceClient } = await import("./supabase-clients");
    const { data: row, error } = await serviceClient()
      .from("forge_discovery")
      .insert({
        request,
        mode,
        digest: digest as never,
        messages: messages as never,
        plan: turn.plan as never,
        ready: turn.ready,
        status: "active",
        created_by: "admin",
      })
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);
    return toSession(row as Row);
  });

/* ── send ─────────────────────────────────────────────────────────────────*/

export const forgeDiscoverySend = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; message: string }) => data)
  .handler(async ({ data }): Promise<DiscoverySession> => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const message = String(data.message ?? "").trim();
    if (!message) throw new Error("Say something first.");

    const { serviceClient } = await import("./supabase-clients");
    const db = serviceClient();
    const { data: row, error } = await db
      .from("forge_discovery")
      .select(`${SELECT}, digest`)
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Session not found.");
    const session = toSession(row as Row);
    if (session.status !== "active") throw new Error("This session is already closed.");

    const history: DiscoveryMessage[] = [...session.messages, { role: "you", content: message }];
    const turn = await workerDiscoveryTurn({
      request: session.request,
      model: await ctoModel(),
      digest: (row as { digest: unknown }).digest as never,
      messages: history,
    });
    const messages: DiscoveryMessage[] = [
      ...history,
      { role: "ai", content: turn.message, suggestedAnswers: turn.suggestedAnswers },
    ];

    const { data: updated, error: upErr } = await db
      .from("forge_discovery")
      .update({ messages: messages as never, plan: turn.plan as never, ready: turn.ready })
      .eq("id", data.id)
      .select(SELECT)
      .single();
    if (upErr) throw new Error(upErr.message);
    return toSession(updated as Row);
  });

/* ── list (the rail's "Planning" section) ──────────────────────────────────*/

export type DiscoverySummary = {
  id: string;
  title: string;
  ready: boolean;
  status: string;
  jobId: string | null;
  updatedAt: string;
};

export const forgeDiscoveryList = createServerFn({ method: "GET" }).handler(
  async (): Promise<DiscoverySummary[]> => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("./supabase-clients");
    const { data } = await serviceClient()
      .from("forge_discovery")
      .select("id, request, plan, ready, status, job_id, updated_at")
      .order("updated_at", { ascending: false })
      .limit(30);
    const rows = (data ?? []) as Array<{
      id: string;
      request: string | null;
      plan: unknown;
      ready: boolean | null;
      status: string | null;
      job_id: string | null;
      updated_at: string | null;
    }>;
    return rows.map((r) => {
      const plan = (r.plan && typeof r.plan === "object" ? r.plan : {}) as { title?: string };
      const title = plan.title?.trim() || String(r.request ?? "Untitled");
      return {
        id: r.id as string,
        title,
        ready: r.ready === true,
        status: String(r.status ?? "active"),
        jobId: (r.job_id as string | null) ?? null,
        updatedAt: String(r.updated_at ?? ""),
      };
    });
  },
);

/* ── get (resume after a refresh) ──────────────────────────────────────────*/

export const forgeDiscoveryGet = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<DiscoverySession | null> => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("./supabase-clients");
    const { data: row } = await serviceClient()
      .from("forge_discovery")
      .select(SELECT)
      .eq("id", data.id)
      .maybeSingle();
    return row ? toSession(row as Row) : null;
  });

/* ── proceed → create the job ──────────────────────────────────────────────*/

export const forgeDiscoveryProceed = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<{ jobId: string }> => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("./supabase-clients");
    const db = serviceClient();
    const { data: row, error } = await db
      .from("forge_discovery")
      .select(SELECT)
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Session not found.");
    const session = toSession(row as Row);
    if (session.status === "proceeded" && session.jobId) return { jobId: session.jobId };

    const brief = briefFromPlan(session.plan, session.request);
    const job = await createForgeJobInternal({
      request: brief,
      mode: session.mode,
      createdBy: "discovery",
    });
    await db
      .from("forge_discovery")
      .update({ status: "proceeded", job_id: job.id })
      .eq("id", data.id);
    return { jobId: job.id };
  });
