/**
 * CONVICTION FORGE — mission control for one engineering job at a time.
 *
 * The acceptance criterion for this screen: a person unfamiliar with the
 * current job should understand its state in under ten seconds. So the page is
 * ordered by the five questions a human actually has — what is Forge doing,
 * why, what already happened, is anything blocked, what do I do next — and
 * nothing is drawn that does not answer one of them.
 *
 * Raw logs are evidence, not the interface: they live behind their own tab.
 *
 * Lives beside /admin (flat, non-nested) so the moderation console keeps its
 * exact current behaviour and shares its session gate.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  forgeRunReview,
} from "@/lib/forge.functions";
import {
  FORGE_MODES,
  GSTACK_OPERATIONS,
  MODE_BLURB,
  MODE_PIPELINE,
  blocksImplementation,
  isTerminal,
  type ForgeJob,
  type ForgeMode,
} from "@/lib/forge/types";
import {
  HUMAN_STATES,
  HUMAN_STATE_LABEL,
  blocker as blockerFor,
  currentAction,
  elapsed,
  humanState,
  isFinished,
  jobTitle,
  pipelineProgress,
  whyMode,
  whyProfile,
  type HumanState,
} from "@/lib/forge/narrative";
import { MODEL_REGISTRY } from "@/lib/forge/models";
import {
  Activity,
  BlockerBanner,
  Changes,
  Checks,
  CostLedger,
  CurrentPhaseCard,
  Empty,
  GstackBoard,
  JobRow,
  Objections,
  Pipeline,
  PipelineRail,
  RawLog,
  Receipt,
  Section,
  StatePill,
  Why,
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
    <main className="h-[100dvh] overflow-y-auto bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-[1240px] px-6 py-8 pb-[max(32px,env(safe-area-inset-bottom))]">
      <header className="flex items-baseline justify-between">
        <h1 className="text-[13px] font-semibold uppercase tracking-[0.2em]">Conviction Forge</h1>
        <Link to="/admin" className="text-[12px] text-[var(--text-muted)] underline">
          Moderation
        </Link>
      </header>
        <div className="mt-6">{children}</div>
      </div>
    </main>

  );
}

function Forge() {
  const { job: openJob } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/forge" });
  const setOpenJob = (id: string | undefined) =>
    navigate({ to: "/admin/forge", search: { job: id } });
  const { data: env } = useQuery({ queryKey: ["forge-env"], queryFn: () => forgeEnvironment() });
  const { data: jobs } = useQuery({
    queryKey: ["forge-jobs"],
    queryFn: () => forgeListJobs(),
    refetchInterval: 10000,
  });

  return (
    <Shell>
      <WorkerBanner env={env} />
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Inbox jobs={jobs ?? []} openJob={openJob} onOpen={setOpenJob} />
        <div className="min-w-0">
          {openJob ? (
            <JobView id={openJob} />
          ) : (
            <NewJob onOpen={(id) => setOpenJob(id)} />
          )}
        </div>
      </div>
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

/* ── Inbox ────────────────────────────────────────────────────────────── */

function Inbox({
  jobs,
  openJob,
  onOpen,
}: {
  jobs: ForgeJob[];
  openJob: string | undefined;
  onOpen: (id: string | undefined) => void;
}) {
  const [filter, setFilter] = useState<HumanState | null>(null);

  // The list only has job rows, not their objections or checks — so the state
  // here is derived from status alone. It is the same collapse, with less
  // evidence, and it never claims more than it knows.
  const rows = useMemo(
    () => jobs.map((j) => ({ job: j, state: humanState(j) })),
    [jobs],
  );
  const shown = filter ? rows.filter((r) => r.state === filter) : rows;

  return (
    <aside className="lg:sticky lg:top-8 lg:self-start">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Jobs
        </h2>
        <button
          type="button"
          onClick={() => onOpen(undefined)}
          className="text-[12px] underline"
        >
          New
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {HUMAN_STATES.map((s) => {
          const n = rows.filter((r) => r.state === s).length;
          if (n === 0 && filter !== s) return null;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(filter === s ? null : s)}
              className={`rounded px-2 py-0.5 text-[11px] ${
                filter === s
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {HUMAN_STATE_LABEL[s]} {n}
            </button>
          );
        })}
      </div>

      <ul className="mt-2 space-y-0.5">
        {shown.length === 0 ? (
          <li className="px-2 py-2">
            <Empty>No jobs here.</Empty>
          </li>
        ) : (
          shown.map(({ job, state }) => (
            <JobRow
              key={job.id}
              job={job}
              state={state}
              detail={`${job.mode} · ${currentAction(job).headline}`}
              active={job.id === openJob}
              onOpen={() => onOpen(job.id)}
            />
          ))
        )}
      </ul>
    </aside>
  );
}

/* ── New job ──────────────────────────────────────────────────────────── */

function NewJob({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<ForgeMode>("DEBATE");
  const [error, setError] = useState<string | null>(null);

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
      <p className="mt-2 max-w-[64ch] text-[12px] text-[var(--text-muted)]">{MODE_BLURB[mode]}</p>
      <p className="mt-1">
        <Why label={`Why ${mode}?`}>{whyMode(mode)}</Why>
      </p>

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
    </div>
  );
}

/* ── Job view ─────────────────────────────────────────────────────────── */

const TABS = ["Overview", "Debate", "Changes", "Checks", "gstack", "Logs"] as const;
type Tab = (typeof TABS)[number];

function JobView({ id }: { id: string }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("Overview");
  const [phase, setPhase] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data, isPending } = useQuery({
    queryKey: ["forge-job", id],
    queryFn: () => forgeGetJob({ data: { id } }),
    refetchInterval: 5000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["forge-job", id] });
    qc.invalidateQueries({ queryKey: ["forge-jobs"] });
  };
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
  const review = useMutation({
    mutationFn: async (v: { operation: string }) =>
      await forgeRunReview({ data: { id, operation: v.operation } }),
    onSuccess: refresh,
    onError: fail,
  });



  if (isPending) return <p className="text-[13px] text-[var(--text-muted)]">Loading job…</p>;
  if (!data) return <Empty>That job no longer exists.</Empty>;

  const { job, events, objections, checks, modelRuns } = data;
  const state = humanState(job, objections, checks);
  const action = currentAction(job);
  const progress = pipelineProgress(job);
  const phases = MODE_PIPELINE[job.mode];
  const livePhase =
    phases.find((p) => p.key === job.currentPhase || p.statuses.includes(job.status)) ?? null;
  const blocked = blocksImplementation(job.mode, objections);
  const stop = blockerFor(job, objections, checks);
  const done = isTerminal(job.status);
  const planApprovable =
    job.status === "BUILDER_PLAN" ||
    job.status === "CHALLENGER_REVIEW" ||
    job.status === "BUILDER_REVISION";

  const phaseEvents = phase
    ? events.filter((e) => {
        const d = e.detail;
        const p = d && typeof d === "object" && !Array.isArray(d) ? d["phase"] : null;
        return p === phase;
      })
    : events;

  return (
    <div>
      {/* Header — the whole job in one line. */}
      <div className="rounded-md border border-[var(--border)] p-4">
        <p className="text-[16px] font-semibold leading-[1.35]">{jobTitle(job.request)}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] text-[var(--text-muted)]">
          <span className="uppercase tracking-[0.12em]">{job.mode}</span>
          <StatePill state={state} />
          <span>${job.totalCostUsd.toFixed(2)}</span>
          <span>{elapsed(job.createdAt, done ? job.updatedAt : null)}</span>
          {job.branchName && <span className="font-mono">{job.branchName}</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {planApprovable && (
            <button
              type="button"
              disabled={blocked || approve.isPending}
              onClick={() => approve.mutate()}
              className="rounded-md bg-[var(--text)] px-3 py-1.5 text-[12px] font-medium text-[var(--bg)] disabled:opacity-40"
            >
              Approve plan
            </button>
          )}
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
        {error && <p className="mt-2 text-[12px] text-[var(--loss)]">{error}</p>}
      </div>

      {/* Blocker — never ambiguous about who Forge is waiting on. */}
      {stop && (
        <div className="mt-4">
          <BlockerBanner blocker={stop}>
            {stop.kind === "objections" && (
              <button
                type="button"
                onClick={() => setTab("Debate")}
                className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px]"
              >
                Review objections
              </button>
            )}
            {stop.kind === "check" && (
              <button
                type="button"
                onClick={() => setTab("Checks")}
                className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px]"
              >
                View failure
              </button>
            )}
            {stop.kind === "ready" && (
              <button
                type="button"
                onClick={() => setTab("Changes")}
                className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px]"
              >
                View changes
              </button>
            )}
          </BlockerBanner>
        </div>
      )}

      {/* Tabs */}
      <nav className="mt-6 flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-[12px] font-medium ${
              tab === t
                ? "border-[var(--text)] text-[var(--text)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Overview" && (
        <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_200px]">
          <div className="min-w-0">
            {isFinished(job) ? (
              <Receipt job={job} objections={objections} checks={checks} />
            ) : (
              <CurrentPhaseCard
                action={action}
                progress={progress}
                phaseLabel={livePhase?.label ?? null}
              />
            )}

            <Section label="Request">
              <p className="max-w-[70ch] whitespace-pre-wrap text-[14px] leading-[1.6]">
                {job.request}
              </p>
            </Section>

            <Section label="Plan">
              {job.plan ? (
                <div className="max-w-[70ch] text-[13px] leading-[1.6]">
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

            <Section label={phase ? `Activity — ${livePhaseLabel(phases, phase)}` : "Activity"}>
              {phase && (
                <button
                  type="button"
                  onClick={() => setPhase(null)}
                  className="mb-2 text-[11px] text-[var(--text-muted)] underline"
                >
                  Show all phases
                </button>
              )}
              {phaseEvents.length === 0 ? (
                <Empty>No recorded activity for this phase.</Empty>
              ) : (
                <Activity events={phaseEvents} />
              )}
            </Section>
          </div>

          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              Pipeline
            </h3>
            <div className="mt-2">
              <PipelineRail
                phases={phases}
                status={job.status}
                currentPhase={job.currentPhase}
                selected={phase}
                onSelect={setPhase}
              />
            </div>
            <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              Models
            </h3>
            <ul className="mt-2 space-y-2 text-[12px]">
              {(["builder", "challenger", "escalation"] as const).map((role) => {
                const runs = modelRuns.filter((r) => r.role === role);
                const spend = runs.reduce((s, r) => s + r.costUsd, 0);
                return (
                  <li key={role}>
                    <p className="capitalize">{role}</p>
                    <p className="font-mono text-[11px] text-[var(--text-muted)]">
                      {MODEL_REGISTRY[role].modelId}
                    </p>
                    <p className="text-[var(--text-muted)]">
                      {runs.length === 0 ? "not used" : `$${spend.toFixed(4)}`}
                    </p>
                  </li>
                );
              })}
              <li className="border-t border-[var(--border)] pt-2 font-medium">
                Total ${job.totalCostUsd.toFixed(4)}
              </li>
            </ul>
          </div>
        </div>
      )}

      {tab === "Debate" && (
        <div className="mt-6">
          {job.plan?.summary && (
            <div className="rounded-md bg-[var(--surface)] p-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Plan
              </p>
              <p className="mt-1 max-w-[64ch] text-[14px] leading-[1.6]">{job.plan.summary}</p>
            </div>
          )}
          <Section label="Objections and resolutions">
            <Objections objections={objections} />
            {blocked && (
              <p className="mt-3 text-[12px] text-[var(--loss)]">
                Implementation is blocked until every CRITICAL and HIGH objection is resolved.
              </p>
            )}
          </Section>
          {!done && (
            <Section label="Ask for a revision">
              <div className="flex gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What should change about the plan?"
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
            </Section>
          )}
        </div>
      )}

      {tab === "Changes" && (
        <div className="mt-6">
          <Changes job={job} />
          <p className="mt-4 text-[12px] text-[var(--text-muted)]">
            Forge never merges. A human reviews and merges the pull request on GitHub.
          </p>
        </div>
      )}

      {tab === "Checks" && (
        <div className="mt-6">
          <Checks checks={checks} profileKey={job.verificationProfile} />
          {whyProfile(job) && (
            <p className="mt-3">
              <Why label="Why these checks?">{whyProfile(job)}</Why>
            </p>
          )}
          <Section label="Cost">
            <CostLedger runs={modelRuns} job={job} />
          </Section>
        </div>
      )}

      {tab === "gstack" && (
        <div className="mt-6">
          <GstackBoard
            operations={GSTACK_OPERATIONS}
            events={events}
            busy={review.isPending ? review.variables?.operation ?? null : null}
            disabled={!job.workerJobId || done || review.isPending}
            onRun={(operation) => review.mutate({ operation })}
          />
        </div>
      )}

      {tab === "Logs" && (
        <div className="mt-6">
          <p className="mb-3 text-[12px] text-[var(--text-muted)]">
            Raw events, for debugging Forge itself.
          </p>
          <RawLog events={events} />
        </div>
      )}
    </div>
  );
}

function livePhaseLabel(phases: readonly { key: string; label: string }[], key: string) {
  return phases.find((p) => p.key === key)?.label ?? key;
}
