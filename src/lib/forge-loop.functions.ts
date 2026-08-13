/**
 * Forge autonomous loop — the queue, the on/off switch, and the driver.
 *
 * When the loop is ON, `forgeLoopTick` takes the next queued item and turns it
 * into a Forge job whose output is a PULL REQUEST. It never deploys and never
 * merges — a human approves every change. One job runs at a time.
 *
 * The driver is admin-gated (the console drives it, or a manual "Run next").
 * Unattended scheduling (a cron calling a secret-gated tick) is a later slice.
 */
import { createServerFn } from "@tanstack/react-start";
import type { ForgeMode, ForgeStatus } from "./forge/types";
import { createForgeJobInternal } from "./forge.functions";

/**
 * The agent's operating constitution for loop jobs — prepended to the request
 * so the engineer (OpenCode + gstack) works under it. Condensed from the
 * product-improvement spec; the guardrails are load-bearing.
 */
export const CORE_LOOP_DIRECTIVE = `You are the autonomous product-improvement agent for Conviction.
Objective: maximize matched challenges per active user while protecting retention, quality, trust, performance, and simplicity.

Work the SINGLE task below as the smallest reasonable, reversible, verifiable change. Before coding, state Problem / Evidence / Hypothesis / Primary Metric / Guardrail Metrics / Verification. Investigate first, then implement using existing conventions and the gstack workflow. Add or update tests for the behavior you change; do not weaken existing tests or remove safeguards to make something pass. Then run /review and fix what it finds.

Prioritize: broken functionality > critical friction > challenge creation > challenge acceptance > feed quality > retention > mobile > performance > accessibility > tests. Do NOT change unrelated code.

Product constitution: Conviction is challenge → match → resolve → reputation → repeat. Keep challenges fast to understand and low-friction to accept. Simpler mechanic over complex. Do NOT add token economics, pricing, gambling/lottery mechanics, new major features, auth/authz changes, irreversible DB changes, or architectural rewrites — if one is required, stop and describe a recommendation instead. Never deploy to production; a human approves the PR.

If there is no safe, high-confidence change for this task, make NO change and say why. Making no change beats a low-confidence change.`;

const MODE_FOR_KIND: Record<string, ForgeMode> = {
  bug: "DEBATE",
  feature: "DEBATE",
  friction: "DEBATE",
  chore: "FAST",
};

/* ── queue ────────────────────────────────────────────────────────────────*/

export const forgeEnqueue = createServerFn({ method: "POST" })
  .inputValidator((data: { kind: string; title: string; body?: string; priority?: number }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const kind = ["bug", "feature", "friction", "chore"].includes(data.kind) ? data.kind : "bug";
    const title = String(data.title ?? "").trim();
    if (title.length < 3) throw new Error("Give the item a title.");
    const { serviceClient } = await import("./supabase-clients");
    const { data: row, error } = await serviceClient()
      .from("forge_queue")
      .insert({
        kind,
        title,
        body: data.body?.trim() || null,
        source: "admin",
        priority: Number.isFinite(data.priority) ? Number(data.priority) : 0,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const forgeListQueue = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const { serviceClient } = await import("./supabase-clients");
  const { data, error } = await serviceClient()
    .from("forge_queue")
    .select("*")
    .order("status", { ascending: true })
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
});

/* ── loop switch ──────────────────────────────────────────────────────────*/

export const forgeGetLoop = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const { serviceClient } = await import("./supabase-clients");
  const { data } = await serviceClient()
    .from("forge_settings")
    .select("value")
    .eq("key", "loop")
    .maybeSingle();
  const value = (data?.value ?? {}) as { enabled?: boolean };
  return { enabled: value.enabled === true };
});

export const forgeSetLoop = createServerFn({ method: "POST" })
  .inputValidator((data: { enabled: boolean }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("./supabase-clients");
    const { error } = await serviceClient()
      .from("forge_settings")
      .upsert({ key: "loop", value: { enabled: data.enabled === true } }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { enabled: data.enabled === true };
  });

/* ── the driver ───────────────────────────────────────────────────────────*/

type QueueRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  status: string;
  job_id: string | null;
};

/**
 * One tick: reconcile the in-flight item, then — if the loop is on and nothing
 * is running — start the next one. Safe to call repeatedly (idempotent-ish).
 */
export const forgeLoopTick = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const { serviceClient } = await import("./supabase-clients");
  const db = serviceClient();

  // 1. Reconcile any running item against its job's status.
  const { data: runningRows } = await db
    .from("forge_queue")
    .select("id, kind, title, body, status, job_id")
    .eq("status", "running");
  const running = (runningRows ?? []) as QueueRow[];
  for (const item of running) {
    if (!item.job_id) continue;
    const { data: job } = await db
      .from("forge_jobs")
      .select("status")
      .eq("id", item.job_id)
      .maybeSingle();
    const s = job?.status as ForgeStatus | undefined;
    if (s === "PR_CREATED" || s === "COMPLETED") {
      await db.from("forge_queue").update({ status: "pr_open" }).eq("id", item.id);
    } else if (s === "FAILED" || s === "CANCELLED") {
      await db.from("forge_queue").update({ status: "rejected" }).eq("id", item.id);
    }
  }

  // 2. Loop off? Nothing more to do.
  const { data: setting } = await db
    .from("forge_settings")
    .select("value")
    .eq("key", "loop")
    .maybeSingle();
  const enabled = ((setting?.value ?? {}) as { enabled?: boolean }).enabled === true;
  if (!enabled) return { ran: false as const, reason: "loop is off" };

  // 3. Still busy (an item running whose job is not terminal)? One at a time.
  const { data: stillRunning } = await db
    .from("forge_queue")
    .select("id")
    .eq("status", "running")
    .limit(1);
  if ((stillRunning ?? []).length > 0) return { ran: false as const, reason: "a job is running" };

  // 4. Take the next pending item.
  const { data: nextRows } = await db
    .from("forge_queue")
    .select("id, kind, title, body, status, job_id")
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);
  const next = (nextRows ?? [])[0] as QueueRow | undefined;
  if (!next) return { ran: false as const, reason: "queue empty" };

  // 5. Turn it into a Forge job under the CORE LOOP constitution.
  const mode = MODE_FOR_KIND[next.kind] ?? "DEBATE";
  const request = `${CORE_LOOP_DIRECTIVE}\n\n## Task (${next.kind})\n${next.title}\n${next.body ?? ""}`.trim();
  try {
    const job = await createForgeJobInternal({ request, mode, createdBy: "loop" });
    await db.from("forge_queue").update({ status: "running", job_id: job.id }).eq("id", next.id);
    return { ran: true as const, itemId: next.id, jobId: job.id, title: next.title };
  } catch (e) {
    const message = e instanceof Error ? e.message : "job creation failed";
    await db.from("forge_queue").update({ status: "rejected" }).eq("id", next.id);
    return { ran: false as const, reason: message };
  }
});
