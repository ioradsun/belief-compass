/**
 * CONVICTION FORGE — the engineering control center.
 *
 * Request → Debate → Build → Verify → Review → PR. One screen to start work,
 * one screen to watch it. Everything shown here comes from persisted rows; if a
 * thing has not happened, it is not drawn as having happened.
 *
 * Lives beside /admin (flat, non-nested) so the moderation console keeps its
 * exact current behaviour and shares its session gate.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminStatus } from "@/lib/admin.functions";
import {
  forgeApprovePlan,
  forgeCancelJob,
  forgeCreateJob,
  forgeCreatePullRequest,
  forgeEnvironment,
  forgeGetJob,
  forgeListJobs,
  forgeRequestRevision,
} from "@/lib/forge.functions";
import {
  FORGE_MODES,
  MODE_BLURB,
  MODE_PIPELINE,
  blocksImplementation,
  isTerminal,
  type ForgeMode,
} from "@/lib/forge/types";
import { MODEL_REGISTRY } from "@/lib/forge/models";
import {
  Activity,
  Checks,
  CostLedger,
  Empty,
  Objections,
  Pipeline,
  Section,
} from "@/components/forge/ForgePanels";

export const Route = createFileRoute("/admin_/forge")({
  ssr: false,
  // The open job lives in the URL, so a refresh returns to the same job.
  validateSearch: (search: Record<string, unknown>) => ({
    job: typeof search.job === "string" ? search.job : (undefined as string | undefined),
  }),
  head: () => ({
    meta: [
      { title: "Forge — Conviction" },
      { name: "description", content: "Internal engineering control center for Conviction." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Forge — Conviction" },
      { property: "og:description", content: "Internal engineering control center." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgeRoute,
});

function ForgeRoute() {
  const { data: status, isPending } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => adminStatus(),
  });

  if (isPending) return <Shell>{null}</Shell>;

  if (status?.unlocked !== true) {
    return (
      <Shell>
        <p className="text-[13px] text-[var(--text-muted)]">
          Forge is locked.{" "}
          <Link to="/admin" className="underline">
            Unlock the moderation console
          </Link>{" "}
          first — Forge uses the same session.
        </p>
      </Shell>
    );
  }
  return <Forge />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-[100dvh] max-w-[980px] bg-[var(--bg)] px-6 py-10 text-[var(--text)]">
      <header className="flex items-baseline justify-between">
        <h1 className="text-[13px] font-semibold uppercase tracking-[0.2em]">Conviction Forge</h1>
        <Link to="/admin" className="text-[12px] text-[var(--text-muted)] underline">
          Moderation
        </Link>
      </header>
      <div className="mt-8">{children}</div>
    </main>
  );
}

function Forge() {
  const { job: openJob } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/forge" });
  const setOpenJob = (id: string | undefined) =>
    navigate({ to: "/admin/forge", search: { job: id } });
  const { data: env } = useQuery({ queryKey: ["forge-env"], queryFn: () => forgeEnvironment() });

  return (
    <Shell>
      <WorkerBanner env={env} />
      {openJob ? (
        <JobView id={openJob} onBack={() => setOpenJob(undefined)} />
      ) : (
        <NewJob onOpen={setOpenJob} />
      )}
    </Shell>
  );
}

type Env = Awaited<ReturnType<typeof forgeEnvironment>> | undefined;

function WorkerBanner({ env }: { env: Env }) {
  if (!env) return null;
  const { worker, openRouterConfigured } = env;
  const ok = worker.configured && worker.reachable;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-[var(--surface)] px-3 py-2 text-[12px]">
      <span className={ok ? undefined : "text-[var(--loss)]"}>
        {ok
          ? `Forge Worker connected${worker.version ? ` · ${worker.version}` : ""}`
          : worker.configured
            ? `Forge Worker unreachable${worker.error ? ` — ${worker.error}` : ""}`
            : "Forge Worker not connected"}
      </span>
      <span className={openRouterConfigured ? "text-[var(--text-muted)]" : "text-[var(--loss)]"}>
        OpenRouter {openRouterConfigured ? "configured" : "key missing"}
      </span>
      {!worker.configured && (
        <span className="text-[var(--text-muted)]">
          Set FORGE_WORKER_URL and FORGE_WORKER_SECRET to enable execution.
        </span>
      )}
    </div>
  );
}

/* ── New job ──────────────────────────────────────────────────────────── */

function NewJob({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<ForgeMode>("DEBATE");
  const [error, setError] = useState<string | null>(null);

  const { data: jobs } = useQuery({ queryKey: ["forge-jobs"], queryFn: () => forgeListJobs() });

  const build = useMutation({
    mutationFn: async () => await forgeCreateJob({ data: { request, mode } }),
    onSuccess: (r) => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["forge-jobs"] });
      onOpen(r.id);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not create the job."),
  });

  return (
    <div>
      <h2 className="text-[20px] font-semibold tracking-[-0.01em]">
        What should Conviction become next?
      </h2>
      <textarea
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        rows={6}
        placeholder="Describe the change. Name the behaviour, not the file."
        className="mt-4 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[14px] leading-[1.6] outline-none focus:border-[var(--border-strong)]"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        {FORGE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 text-[12px] font-medium uppercase tracking-[0.08em] ${
              mode === m
                ? "bg-[var(--text)] text-[var(--bg)]"
                : "border border-[var(--border-strong)] text-[var(--text-muted)]"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-[var(--text-muted)]">{MODE_BLURB[mode]}</p>

      <Section label="Pipeline">
        <Pipeline phases={MODE_PIPELINE[mode]} status="DRAFT" currentPhase={null} />
      </Section>

      <Section label="Models">
        <ul className="space-y-1 text-[12px]">
          {(["builder", "challenger", "escalation"] as const).map((role) => {
            const m = MODEL_REGISTRY[role];
            return (
              <li key={role} className="flex flex-wrap gap-x-3">
                <span className="w-[92px] shrink-0 capitalize">{role}</span>
                <span className="font-mono">{m.modelId}</span>
                <span className="text-[var(--text-muted)]">
                  {m.provider} · {m.metadata.invocation} · ${m.inputCost}/${m.outputCost} per 1M
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      {error && <p className="mt-4 text-[12px] text-[var(--loss)]">{error}</p>}

      <button
        type="button"
        disabled={build.isPending || request.trim().length < 8}
        onClick={() => build.mutate()}
        className="mt-6 rounded-md bg-[var(--text)] px-5 py-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--bg)] disabled:opacity-40"
      >
        {build.isPending ? "Creating…" : "Build"}
      </button>

      <Section label="Recent jobs">
        {(jobs ?? []).length === 0 ? (
          <Empty>No jobs yet.</Empty>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {(jobs ?? []).map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => onOpen(j.id)}
                  className="flex w-full items-baseline gap-3 py-2 text-left"
                >
                  <span className="w-[86px] shrink-0 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    {j.mode}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{j.request}</span>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                    {j.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/* ── Job view ─────────────────────────────────────────────────────────── */

function JobView({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data, isPending } = useQuery({
    queryKey: ["forge-job", id],
    queryFn: () => forgeGetJob({ data: { id } }),
    refetchInterval: 5000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["forge-job", id] });
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Action failed.");

  const cancel = useMutation({
    mutationFn: async () => await forgeCancelJob({ data: { id } }),
    onSuccess: refresh,
    onError: fail,
  });
  const approve = useMutation({
    mutationFn: async () => await forgeApprovePlan({ data: { id } }),
    onSuccess: refresh,
    onError: fail,
  });
  const revise = useMutation({
    mutationFn: async () => await forgeRequestRevision({ data: { id, note } }),
    onSuccess: () => {
      setNote("");
      refresh();
    },
    onError: fail,
  });
  const pr = useMutation({
    mutationFn: async () => await forgeCreatePullRequest({ data: { id } }),
    onSuccess: refresh,
    onError: fail,
  });

  if (isPending) return <p className="text-[13px] text-[var(--text-muted)]">Loading job…</p>;
  if (!data) return <Empty>That job no longer exists.</Empty>;

  const { job, events, objections, checks, modelRuns } = data;
  const blocked = blocksImplementation(job.mode, objections);
  const done = isTerminal(job.status);

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="text-[12px] text-[var(--text-muted)] underline"
      >
        ← All jobs
      </button>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {job.mode}
        </span>
        <span className="font-mono text-[12px]">{job.status}</span>
        {job.branchName && (
          <span className="font-mono text-[12px] text-[var(--text-muted)]">{job.branchName}</span>
        )}
        <span className="ml-auto text-[12px] text-[var(--text-muted)]">
          {new Date(job.createdAt).toLocaleString()}
        </span>
      </div>

      {job.error && <p className="mt-3 text-[12px] text-[var(--loss)]">{job.error}</p>}
      {error && <p className="mt-3 text-[12px] text-[var(--loss)]">{error}</p>}

      <Section label="Request">
        <p className="whitespace-pre-wrap text-[14px] leading-[1.6]">{job.request}</p>
      </Section>

      <Section label="Pipeline">
        <Pipeline
          phases={MODE_PIPELINE[job.mode]}
          status={job.status}
          currentPhase={job.currentPhase}
        />
      </Section>

      <Section label="Plan">
        {job.plan ? (
          <div className="text-[13px] leading-[1.6]">
            <p>{job.plan.summary}</p>
            {job.plan.steps?.length ? (
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                {job.plan.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            ) : null}
            {job.plan.acceptanceCriteria?.length ? (
              <>
                <p className="mt-3 text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                  Acceptance criteria
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {job.plan.acceptanceCriteria.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {job.plan.filesTouched?.length ? (
              <p className="mt-3 font-mono text-[12px] text-[var(--text-muted)]">
                {job.plan.filesTouched.join(", ")}
              </p>
            ) : null}
          </div>
        ) : (
          <Empty>No plan yet — the Builder has not reported one.</Empty>
        )}
      </Section>

      <Section label="Debate">
        <Objections objections={objections} />
        {blocked && (
          <p className="mt-2 text-[12px] text-[var(--loss)]">
            Implementation is blocked until every CRITICAL and HIGH objection is resolved.
          </p>
        )}
      </Section>

      <Section label="Activity">
        <Activity events={events} />
      </Section>

      <Section label="Checks">
        <Checks checks={checks} profileKey={job.verificationProfile} />
      </Section>

      <Section label="Changes">
        {job.diffSummary ? (
          <p className="font-mono text-[12px]">
            {job.diffSummary.filesChanged} files · +{job.diffSummary.additions} −
            {job.diffSummary.deletions}
          </p>
        ) : (
          <Empty>No diff reported.</Empty>
        )}
      </Section>

      <Section label="Cost">
        <CostLedger runs={modelRuns} job={job} />
      </Section>

      <Section label="Actions">
        <div className="flex flex-wrap items-center gap-2">
          {job.status === "BUILDER_PLAN" ||
          job.status === "CHALLENGER_REVIEW" ||
          job.status === "BUILDER_REVISION" ? (
            <button
              type="button"
              disabled={blocked || approve.isPending}
              onClick={() => approve.mutate()}
              className="rounded-md bg-[var(--text)] px-3 py-1.5 text-[12px] font-medium text-[var(--bg)] disabled:opacity-40"
            >
              Approve plan
            </button>
          ) : null}
          {job.status === "READY_FOR_HUMAN" && (
            <button
              type="button"
              disabled={pr.isPending}
              onClick={() => pr.mutate()}
              className="rounded-md bg-[var(--text)] px-3 py-1.5 text-[12px] font-medium text-[var(--bg)] disabled:opacity-40"
            >
              Create pull request
            </button>
          )}
          {job.prUrl && (
            <a
              href={job.prUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px]"
            >
              Open PR
            </a>
          )}
          {!done && (
            <button
              type="button"
              onClick={() => cancel.mutate()}
              className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px]"
            >
              Cancel
            </button>
          )}
        </div>
        {!done && (
          <div className="mt-3 flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Request a revision…"
              className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--border-strong)]"
            />
            <button
              type="button"
              disabled={!note.trim() || revise.isPending}
              onClick={() => revise.mutate()}
              className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px] disabled:opacity-40"
            >
              Send
            </button>
          </div>
        )}
        <p className="mt-3 text-[12px] text-[var(--text-muted)]">
          Forge never merges. A human reviews and merges the pull request on GitHub.
        </p>
      </Section>
    </div>
  );
}
