/**
 * CONVICTION FORGE — the control room.
 *
 * One job, one screen, six stations. The whole interface lives inside the
 * viewport: the document never scrolls, the regions never move, and only a
 * panel's own body scrolls when its content outgrows it. Forge is a control
 * surface, not a page.
 *
 * The acceptance criterion has not changed, only the instrument: a person who
 * has never seen the current job should be able to answer, in ten seconds —
 * what are we building, what is happening, who is doing it, is anything wrong,
 * is Forge waiting for me, what happens next. The NOW band answers all six
 * above the stations; the stations hold the evidence behind each answer.
 *
 * Nothing here drives the pipeline. Every value on screen is persisted Forge
 * state, mapped through `src/lib/forge/stations.ts`. Where the worker has
 * reported nothing, the screen says so rather than filling the space.
 *
 * Lives beside /admin (flat, non-nested) so the moderation console keeps its
 * exact behaviour and shares its session gate.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminStatus } from "@/lib/admin.functions";
import {
  forgeApprovePlan,
  forgeCancelJob,
  forgeCreateJob,
  forgeCreatePullRequest,
  forgeEnvironment,
  forgeGetDiff,
  forgeGetJob,
  forgeListJobs,
  forgePreview,
  forgeRequestRevision,
  forgeRunReview,
} from "@/lib/forge.functions";
import {
  FORGE_MODES,
  MODE_BLURB,
  MODE_PIPELINE,
  blocksImplementation,
  isTerminal,
  type ForgeJob,
  type ForgeMode,
} from "@/lib/forge/types";
import {
  HUMAN_STATE_LABEL,
  currentAction,
  elapsed,
  humanState,
  jobTitle,
  whyMode,
  type HumanState,
} from "@/lib/forge/narrative";
import {
  PHASE_LABEL,
  STATION_KEYS,
  STATION_META,
  activeStation,
  fault,
  orchestration,
  planAwaitsHuman,
  semanticEvents,
  stationStates,
  type Fault,
  type Orchestration,
  type StationKey,
} from "@/lib/forge/stations";
import { MODEL_REGISTRY } from "@/lib/forge/models";
import {
  Action,
  ActivityRow,
  Dot,
  Empty,
  FocusRailRow,
  LinkAction,
  RailRow,
  Why,
} from "@/components/forge/ForgePanels";
import { STATE_TONE, TONE_COLOR } from "@/components/forge/tone";
import {
  BuilderStation,
  ChallengerStation,
  GstackStation,
  ImplementationStation,
  LogsStation,
  ShipStation,
  VerifyStation,
  type FocusKey,
  type RoomContext,
  type Station,
} from "@/components/forge/ForgeStations";

/**
 * Position is meaning in this room, so the six stations are declared once, in
 * order, and both the grid and the focus rail read the same map. Builder is
 * always top-left; Ship is always bottom-right.
 */
const STATION_COMPONENT: Record<StationKey, Station> = {
  builder: BuilderStation,
  challenger: ChallengerStation,
  gstack: GstackStation,
  implementation: ImplementationStation,
  verify: VerifyStation,
  ship: ShipStation,
};

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

  if (isPending) return <Locked>{null}</Locked>;
  if (status?.unlocked !== true) {
    return (
      <Locked>
        <p className="text-[13px] text-[var(--text-muted)]">
          Forge is locked.{" "}
          <Link to="/admin" className="underline">
            Unlock the moderation console
          </Link>{" "}
          first — Forge uses the same session.
        </p>
      </Locked>
    );
  }
  return <ControlRoom />;
}

function Locked({ children }: { children: React.ReactNode }) {
  return (
    <main className="forge-room flex h-[100dvh] w-full items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <div className="max-w-[46ch] px-6">
        <Lockup />
        <div className="mt-4">{children}</div>
      </div>
    </main>
  );
}

function Lockup() {
  return (
    <span className="whitespace-nowrap text-[11px] uppercase tracking-[0.3em]">
      <span className="text-[var(--text-muted)]">Conviction</span>{" "}
      <span className="font-semibold text-[var(--text)]">Forge</span>
    </span>
  );
}

/* ── The room ─────────────────────────────────────────────────────────────
 * Three fixed regions: the command bar across the top, the job rail down the
 * left, the current job filling everything else. None of them scroll, and
 * none of them move when the job changes.
 */

/**
 * Composing lives in the rail, so it is state of the inbox rather than state
 * of the canvas: starting a job never costs you the instrument you are
 * watching. The rail widens to give the request room to be written, and
 * snaps back when the job is filed.
 */
type Compose = { open: boolean; request: string; mode: ForgeMode };

const RAIL_LIST = "grid-cols-[212px_minmax(0,1fr)] xl:grid-cols-[264px_minmax(0,1fr)]";
const RAIL_COMPOSE = "grid-cols-[380px_minmax(0,1fr)]";

function ControlRoom() {
  const { job: openJob } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/forge" });
  const setOpenJob = (id: string | undefined) =>
    navigate({ to: "/admin/forge", search: { job: id } });
  const [compose, setCompose] = useState<Compose>({
    open: false,
    request: "",
    mode: "DEBATE",
  });

  const { data: env } = useQuery({
    queryKey: ["forge-env"],
    queryFn: () => forgeEnvironment(),
    refetchInterval: 60_000,
  });
  const { data: jobs } = useQuery({
    queryKey: ["forge-jobs"],
    queryFn: () => forgeListJobs(),
    refetchInterval: 10_000,
  });

  // Escape has one meaning at a time: close the composer if it is open,
  // otherwise leave Focus Mode. The canvas keeps its focus while you type.
  const room = useJobRoom(openJob, { escapeCaptured: compose.open });
  useEffect(() => {
    if (!compose.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCompose((c) => ({ ...c, open: false }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compose.open]);

  return (
    <main className="forge-room grid h-[100dvh] w-full grid-rows-[58px_minmax(0,1fr)] overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <CommandBar room={room} composing={compose.open} />
      <div
        className={`grid min-h-0 transition-[grid-template-columns] duration-200 ease-out ${
          compose.open ? RAIL_COMPOSE : RAIL_LIST
        }`}
      >
        <JobRail
          jobs={jobs ?? []}
          openJob={openJob}
          onOpen={setOpenJob}
          env={env}
          compose={compose}
          setCompose={setCompose}
        />
        {room.kind === "ready" ? (
          // Keyed by job: a different job is a different board, so per-panel
          // selections (open objection, open check, open gstack op) reset.
          <JobCanvas key={room.job.id} room={room} />
        ) : compose.open ? (
          // Nothing to watch, so the canvas shows what the chosen mode will
          // cost: the pipeline it walks and the models it will pay for.
          <ModeCanvas mode={compose.mode} />
        ) : room.kind === "none" ? (
          <IdleCanvas onNew={() => setCompose((c) => ({ ...c, open: true }))} />
        ) : (
          <Placeholder
            text={room.kind === "loading" ? "Loading job" : "That job no longer exists"}
            action={
              room.kind === "missing" ? (
                <Action onClick={() => setOpenJob(undefined)}>Back to jobs</Action>
              ) : null
            }
          />
        )}
      </div>
    </main>
  );
}

function Placeholder({ text, action }: { text: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text}</p>
      {action}
    </div>
  );
}

/** No job selected. Say so, and say what to do about it. Nothing else. */
function IdleCanvas({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
        No job selected
      </p>
      <p className="max-w-[44ch] text-center text-[13px] leading-[1.6] text-[var(--text-secondary)]">
        Choose a job from the rail to open its board, or start a new one.
      </p>
      <Action weight="primary" onClick={onNew}>
        New job
      </Action>
    </div>
  );
}

/* ── The job, assembled once ──────────────────────────────────────────────
 * Every region reads the same derived state, so the command bar, the NOW
 * band and the stations can never disagree about what Forge is doing.
 */

type Room =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "missing" }
  | {
      kind: "ready";
      job: ForgeJob;
      ctx: RoomContext;
      now: Orchestration;
      stop: Fault | null;
      state: HumanState;
      cancel: () => void;
      busy: boolean;
      error: string | null;
    };

function useJobRoom(id: string | undefined, { escapeCaptured }: { escapeCaptured: boolean }): Room {
  const qc = useQueryClient();
  const [focus, setFocus] = useState<FocusKey | null>(null);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A new job is a new board: never inherit the last one's focus.
  useEffect(() => {
    setFocus(null);
    setDiffFile(null);
    setError(null);
  }, [id]);

  // Escape returns to the whole board — unless something nearer the operator
  // has claimed the key, in which case the canvas keeps its focus.
  useEffect(() => {
    if (!focus || escapeCaptured) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, escapeCaptured]);

  const { data, isPending } = useQuery({
    queryKey: ["forge-job", id],
    queryFn: () => forgeGetJob({ data: { id: id as string } }),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });

  // The diff is a live call into the worker, so it is only fetched when the
  // operator has actually asked to look at code.
  const wantsDiff = focus === "implementation" || diffFile !== null;
  const diffQuery = useQuery({
    queryKey: ["forge-diff", id],
    queryFn: () => forgeGetDiff({ data: { id: id as string } }),
    enabled: Boolean(id) && wantsDiff && Boolean(data?.job.workerJobId),
    staleTime: 60_000,
  });
  const previewQuery = useQuery({
    queryKey: ["forge-preview", id],
    queryFn: () => forgePreview({ data: { id: id as string } }),
    enabled: Boolean(id) && Boolean(data?.job.workerJobId),
    refetchInterval: 60_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["forge-job", id] });
    qc.invalidateQueries({ queryKey: ["forge-jobs"] });
  };
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Action failed.");

  const cancel = useMutation({
    mutationFn: async () => await forgeCancelJob({ data: { id: id as string } }),
    onSuccess: refresh,
    onError: fail,
  });
  const approve = useMutation({
    mutationFn: async () => await forgeApprovePlan({ data: { id: id as string } }),
    onSuccess: refresh,
    onError: fail,
  });
  const pr = useMutation({
    mutationFn: async () => await forgeCreatePullRequest({ data: { id: id as string } }),
    onSuccess: refresh,
    onError: fail,
  });
  const review = useMutation({
    mutationFn: async (v: { operation: string }) =>
      await forgeRunReview({ data: { id: id as string, operation: v.operation } }),
    onSuccess: refresh,
    onError: fail,
  });
  const revise = useMutation({
    mutationFn: async (note: string) =>
      await forgeRequestRevision({ data: { id: id as string, note } }),
    onSuccess: refresh,
    onError: fail,
  });

  if (!id) return { kind: "none" };
  if (isPending) return { kind: "loading" };
  if (!data) return { kind: "missing" };

  const { job, events, objections, checks, modelRuns } = data;
  const done = isTerminal(job.status);
  const busy = cancel.isPending || approve.isPending || pr.isPending;

  const ctx: RoomContext = {
    job,
    events,
    objections,
    checks,
    modelRuns,
    states: stationStates({ job, objections, checks, events }),
    live: activeStation(job.status),
    focus,
    setFocus,
    diffFile,
    setDiffFile,
    approvePlan:
      planAwaitsHuman(job) && !blocksImplementation(job.mode, objections) && !busy
        ? () => approve.mutate()
        : null,
    createPullRequest: job.status === "READY_FOR_HUMAN" && !busy ? () => pr.mutate() : null,
    requestRevision:
      planAwaitsHuman(job) && !done && !revise.isPending ? (note) => revise.mutate(note) : null,
    revising: revise.isPending,
    runGstack: (operation) => review.mutate({ operation }),
    gstackBusy: review.isPending ? (review.variables?.operation ?? null) : null,
    gstackDisabled: !job.workerJobId || done || review.isPending,
    preview: previewQuery.data?.url ?? null,
    diff: {
      patch: diffQuery.data?.patch ?? null,
      pending: diffQuery.isFetching,
      error:
        diffQuery.error instanceof Error
          ? diffQuery.error.message
          : diffQuery.isError
            ? "The worker did not return a diff."
            : null,
    },
  };

  return {
    kind: "ready",
    job,
    ctx,
    now: orchestration(job, objections, checks),
    stop: fault(job, checks),
    state: humanState(job, objections, checks),
    cancel: () => cancel.mutate(),
    busy,
    error,
  };
}

/* ── Global command bar ───────────────────────────────────────────────────
 * The lockup, the job, its vital signs, and only the actions that are
 * actually available. One primary action at most.
 */

function CommandBar({ room, composing }: { room: Room; composing: boolean }) {
  return (
    <header className="flex h-[58px] shrink-0 items-center border-b border-[var(--hairline)] bg-[var(--panel)]">
      {/* The lockup block tracks the rail's width, so the seam runs straight
          down the screen whether the rail is listing or composing. */}
      <div
        className={`flex shrink-0 items-center border-r border-[var(--hairline)] px-5 transition-[width] duration-200 ease-out ${
          composing ? "w-[380px]" : "w-[212px] xl:w-[264px]"
        }`}
      >
        <Lockup />
      </div>
      {room.kind === "ready" ? (
        <JobVitals room={room} />
      ) : (
        <IdleBar room={room} composing={composing} />
      )}
    </header>
  );
}

function IdleBar({ room, composing }: { room: Room; composing: boolean }) {
  const title =
    room.kind === "loading"
      ? "Loading"
      : room.kind === "missing"
        ? "Not found"
        : composing
          ? "New job"
          : "Forge";
  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-3 px-5">
      <h1 className="text-[22px] font-medium leading-[1.2] tracking-[-0.015em]">{title}</h1>
      {room.kind === "none" && (
        <span className="text-[11px] text-[var(--text-muted)]">
          {composing ? "Name the behaviour, not the file." : "No job open."}
        </span>
      )}
    </div>
  );
}

function JobVitals({ room }: { room: Extract<Room, { kind: "ready" }> }) {
  const { job, ctx, state, error, busy } = room;
  const done = isTerminal(job.status);
  const d = job.diffSummary;
  return (
    <>
      <div className="min-w-0 flex-1 px-5">
        <h1 className="truncate text-[22px] font-medium leading-[1.15] tracking-[-0.015em]">
          {jobTitle(job.request)}
        </h1>
        <div className="mt-0.5 flex items-baseline gap-3">
          <span className="flex items-baseline gap-1.5">
            <Dot tone={STATE_TONE[state]} pulse={state === "running"} />
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              {job.mode} · {HUMAN_STATE_LABEL[state]}
            </span>
          </span>
          <span className="num text-[11px] text-[var(--text-muted)]">
            ${job.totalCostUsd.toFixed(2)}
          </span>
          <Clock from={job.createdAt} to={done ? job.updatedAt : null} />
          {d && (
            <span className="num text-[11px] text-[var(--text-muted)]">
              {d.filesChanged} {d.filesChanged === 1 ? "file" : "files"}
            </span>
          )}
          {error && <span className="truncate text-[11px] text-[var(--loss)]">{error}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 px-5">
        {ctx.preview && <LinkAction href={ctx.preview}>Open preview</LinkAction>}
        {job.prUrl && <LinkAction href={job.prUrl}>View PR</LinkAction>}
        {!done && (
          <Action weight="danger" disabled={busy} onClick={room.cancel}>
            Cancel
          </Action>
        )}
        {ctx.approvePlan && (
          <Action weight="primary" onClick={ctx.approvePlan}>
            Approve plan
          </Action>
        )}
        {ctx.createPullRequest && (
          <Action weight="primary" onClick={ctx.createPullRequest}>
            Create pull request
          </Action>
        )}
      </div>
    </>
  );
}

/** A running job has a running clock. It ticks on its own, and alone. */
function Clock({ from, to }: { from: string; to: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (to) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [to]);
  return <span className="num text-[11px] text-[var(--text-muted)]">{elapsed(from, to)}</span>;
}

/* ── Job rail ─────────────────────────────────────────────────────────────
 * The operator's inbox, and the only place a job is created, found or
 * switched. Three sections in the order a person cares about them, and human
 * phase names only — no CHALLENGER_REVIEW leaks out of here.
 *
 * Composing is a state of the rail, not of the canvas. The rail's own shape
 * — header, body, system readout — is the same either way; only the body
 * changes, so the region never moves under the operator.
 */

type Env = Awaited<ReturnType<typeof forgeEnvironment>> | undefined;

const RAIL_SECTIONS: { label: string; states: readonly HumanState[] }[] = [
  { label: "Needs you", states: ["needs-you", "ready"] },
  { label: "Running", states: ["running"] },
  { label: "Recent", states: ["failed", "completed"] },
];

function JobRail({
  jobs,
  openJob,
  onOpen,
  env,
  compose,
  setCompose,
}: {
  jobs: ForgeJob[];
  openJob: string | undefined;
  onOpen: (id: string | undefined) => void;
  env: Env;
  compose: Compose;
  setCompose: React.Dispatch<React.SetStateAction<Compose>>;
}) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs
      .map((job) => ({ job, state: humanState(job) }))
      .filter((r) => (q ? r.job.request.toLowerCase().includes(q) : true));
  }, [jobs, query]);

  return (
    <aside className="flex min-h-0 flex-col border-r border-[var(--hairline)] bg-[var(--panel)]">
      <header className="flex h-[37px] shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search jobs"
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--text-muted)]"
        />
        {compose.open ? (
          <Action onClick={() => setCompose((c) => ({ ...c, open: false }))}>Close · Esc</Action>
        ) : (
          <Action weight="primary" onClick={() => setCompose((c) => ({ ...c, open: true }))}>
            New
          </Action>
        )}
      </header>

      {/* One scroll region: the composer sits above the inbox rather than
          replacing it, so a job can be written without losing sight of the
          jobs already running. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {compose.open && <Composer compose={compose} setCompose={setCompose} onCreated={onOpen} />}
        <div className="py-2">
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-[var(--text-muted)]">
              {query ? "No job matches that." : "No jobs yet."}
            </p>
          ) : (
            RAIL_SECTIONS.map(({ label, states }) => {
              const mine = rows.filter((r) => states.includes(r.state));
              if (mine.length === 0) return null;
              return (
                <section key={label} className="mb-3">
                  <h2 className="flex items-baseline justify-between px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {label}
                    <span className="num">{mine.length}</span>
                  </h2>
                  <ul>
                    {mine.map(({ job, state }) => (
                      <RailRow
                        key={job.id}
                        title={jobTitle(job.request)}
                        phase={PHASE_LABEL[job.status]}
                        meta={
                          isTerminal(job.status)
                            ? job.prUrl
                              ? "PR"
                              : HUMAN_STATE_LABEL[state]
                            : elapsed(job.createdAt)
                        }
                        state={state}
                        active={job.id === openJob}
                        onOpen={() => onOpen(job.id)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>

      <SystemReadout env={env} />
    </aside>
  );
}

/**
 * The composer. The only surface in Forge that asks the operator for prose,
 * so the request gets real room and the mode gets one honest line each. The
 * fuller consequence of a mode — its pipeline and what it will pay models —
 * renders on the canvas beside it whenever there is no job to watch.
 */
function Composer({
  compose,
  setCompose,
  onCreated,
}: {
  compose: Compose;
  setCompose: React.Dispatch<React.SetStateAction<Compose>>;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const build = useMutation({
    mutationFn: async () =>
      await forgeCreateJob({ data: { request: compose.request, mode: compose.mode } }),
    onSuccess: (r) => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["forge-jobs"] });
      setCompose({ open: false, request: "", mode: compose.mode });
      onCreated(r.id);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not create the job."),
  });

  const ready = compose.request.trim().length >= 8;

  return (
    <div className="scene-enter border-b border-[var(--hairline)] bg-[var(--surface)] px-3 py-3">
      <textarea
        value={compose.request}
        onChange={(e) => setCompose((c) => ({ ...c, request: e.target.value }))}
        rows={6}
        autoFocus
        placeholder="What should Conviction become next?"
        className="w-full resize-none border border-[var(--hairline)] bg-[var(--bg)] px-2.5 py-2 text-[13px] leading-[1.6] outline-none focus:border-[var(--border-strong)]"
      />

      <div className="mt-3 flex flex-col gap-px bg-[var(--hairline)]">
        {FORGE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setCompose((c) => ({ ...c, mode: m }))}
            className="px-2.5 py-1.5 text-left"
            style={{
              backgroundColor: compose.mode === m ? "var(--surface-2)" : "var(--panel)",
              boxShadow: compose.mode === m ? `inset 2px 0 0 ${TONE_COLOR.active}` : undefined,
            }}
          >
            <span
              className={`block text-[11px] font-semibold uppercase tracking-[0.16em] ${
                compose.mode === m ? "text-[var(--text)]" : "text-[var(--text-muted)]"
              }`}
            >
              {m}
            </span>
            <span className="mt-0.5 block text-[11px] leading-[1.45] text-[var(--text-muted)]">
              {MODE_BLURB[m]}
            </span>
          </button>
        ))}
      </div>

      {error && <p className="mt-2 text-[12px] text-[var(--loss)]">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!ready || build.isPending}
          onClick={() => build.mutate()}
          className="rounded-[3px] bg-[var(--text)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--bg)] disabled:opacity-35"
        >
          {build.isPending ? "Creating" : "Build"}
        </button>
        <span className="min-w-0 flex-1 text-[10px] leading-[1.4] text-[var(--text-muted)]">
          {ready
            ? "Filed, then handed to the worker."
            : "Describe the change in a sentence or more."}
        </span>
      </div>
    </div>
  );
}

/** Instrumentation, not decoration: can Forge execute anything at all? */
function SystemReadout({ env }: { env: Env }) {
  const worker = env?.worker;
  const workerOk = Boolean(worker?.configured && worker?.reachable);
  const keyOk = env?.openRouterConfigured ?? false;
  return (
    <footer className="shrink-0 border-t border-[var(--hairline)] px-3 py-2">
      <div className="flex items-center gap-2" title={worker?.error ?? worker?.url ?? undefined}>
        <Dot tone={workerOk ? "pass" : worker?.configured ? "fail" : "idle"} />
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Worker
        </span>
        <span className="ml-auto truncate text-[10px] text-[var(--text-secondary)]">
          {workerOk
            ? (worker?.version ?? "connected")
            : worker?.configured
              ? "unreachable"
              : "not connected"}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Dot tone={keyOk ? "pass" : "fail"} />
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
          OpenRouter
        </span>
        <span className="ml-auto text-[10px] text-[var(--text-secondary)]">
          {keyOk ? "configured" : "key missing"}
        </span>
      </div>
      <Link
        to="/admin"
        className="mt-1.5 block text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        Moderation console
      </Link>
    </footer>
  );
}

/* ── The current job ──────────────────────────────────────────────────── */

function JobCanvas({ room }: { room: Extract<Room, { kind: "ready" }> }) {
  const { ctx, now, stop } = room;
  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
      <NowBand
        now={now}
        stop={stop}
        onOpenFault={() => ctx.setFocus(stop?.subject ? "verify" : "builder")}
      />
      {ctx.focus ? <FocusView ctx={ctx} /> : <StationGrid ctx={ctx} />}
      <ActivityStrip ctx={ctx} />
    </div>
  );
}

/* ── The NOW band ─────────────────────────────────────────────────────────
 * The most important element on the screen. Four answers, always in the same
 * four places, so they are read by position rather than by label.
 */

function NowBand({
  now,
  stop,
  onOpenFault,
}: {
  now: Orchestration;
  stop: Fault | null;
  onOpenFault: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-[var(--hairline)] bg-[var(--panel)]">
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_172px] gap-4 px-5 py-3 xl:gap-8">
        <Readout label="Now">
          <span className="line-clamp-2 text-[16px] font-medium leading-[1.35] text-[var(--text)]">
            {now.now}
          </span>
        </Readout>
        <Readout label="Why">
          <span className="line-clamp-2 text-[12px] leading-[1.45] text-[var(--text-secondary)]">
            {now.why}
          </span>
        </Readout>
        <Readout label="Next">
          <span className="line-clamp-2 text-[12px] leading-[1.45] text-[var(--text-secondary)]">
            {now.next ?? "Nothing — this job is finished."}
          </span>
        </Readout>
        <Readout label="Needs you">
          <span
            className="text-[16px] font-medium leading-[1.3]"
            style={{ color: now.needsYou ? TONE_COLOR.attention : "var(--text-muted)" }}
          >
            {now.needsYou ? "Yes" : "No"}
          </span>
          {now.ask && (
            <span className="line-clamp-2 text-[11px] leading-[1.4] text-[var(--text-muted)]">
              {now.ask}
            </span>
          )}
        </Readout>
      </div>

      {stop && (
        <div
          className="flex items-baseline gap-4 border-t px-5 py-2"
          style={{ borderColor: TONE_COLOR.fail, backgroundColor: "var(--surface)" }}
        >
          <span
            className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: TONE_COLOR.fail }}
          >
            {stop.title}
          </span>
          {stop.subject && (
            <span className="shrink-0 font-mono text-[11px] text-[var(--text-secondary)]">
              {stop.subject}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text)]">
            {stop.body}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{stop.remedy}</span>
          <span
            className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: stop.needsYou ? TONE_COLOR.attention : "var(--text-muted)" }}
          >
            Needs you · {stop.needsYou ? "Yes" : "No"}
          </span>
          <Action onClick={onOpenFault}>View failure</Action>
        </div>
      )}
    </div>
  );
}

function Readout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </span>
      <span className="mt-1 flex min-w-0 flex-col gap-0.5">{children}</span>
    </div>
  );
}

/* ── The grid ─────────────────────────────────────────────────────────────
 * Three columns, two rows, hairline seams. Builder is always top-left and
 * Ship is always bottom-right; the operator navigates by memory, not labels.
 */

// Below xl the board folds to two columns and three rows. Reading order is
// preserved, so a station is still found where the eye expects it.
function StationGrid({ ctx }: { ctx: RoomContext }) {
  return (
    <div className="grid min-h-0 grid-cols-2 grid-rows-3 gap-px bg-[var(--hairline)] xl:grid-cols-3 xl:grid-rows-2">
      {STATION_KEYS.map((key) => {
        const Station = STATION_COMPONENT[key];
        return <Station key={key} ctx={ctx} />;
      })}
    </div>
  );
}

/* ── Focus mode ───────────────────────────────────────────────────────────
 * One station takes the canvas; the other five collapse into a slim rail
 * that keeps its order and its live status. The job never changes — this is
 * a change of magnification, not of place.
 */

function FocusView({ ctx }: { ctx: RoomContext }) {
  const key = ctx.focus;
  if (!key) return null;
  const Station = key === "logs" ? null : STATION_COMPONENT[key];
  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_200px] gap-px bg-[var(--hairline)]">
      <div className="scene-enter grid min-h-0">
        {Station ? <Station ctx={ctx} expanded /> : <LogsStation ctx={ctx} />}
      </div>
      <div className="flex min-h-0 flex-col bg-[var(--panel)]">
        <div className="shrink-0 border-b border-[var(--hairline)] px-3 py-2">
          <Action onClick={() => ctx.setFocus(null)}>Exit focus · Esc</Action>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {STATION_KEYS.map((k) => (
            <FocusRailRow
              key={k}
              label={STATION_META[k].title}
              status={ctx.states[k].status}
              tone={ctx.states[k].tone}
              active={ctx.live === k}
              selected={key === k}
              onSelect={() => ctx.setFocus(k)}
            />
          ))}
          <div className="mt-2 border-t border-[var(--hairline)] pt-2">
            <FocusRailRow
              label="Technical logs"
              status={`${ctx.events.length} events`}
              tone="idle"
              active={false}
              selected={key === "logs"}
              onSelect={() => ctx.setFocus("logs")}
            />
          </div>
        </div>
        <div className="shrink-0 border-t border-[var(--hairline)] px-3 py-2">
          <p className="text-[10px] leading-[1.5] text-[var(--text-muted)]">
            {key === "logs"
              ? "Evidence, not the interface."
              : `${STATION_META[key].title} ${STATION_META[key].verb}.`}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Live activity ────────────────────────────────────────────────────────
 * The story of the job in semantic events, newest first so the latest line
 * is always the one in view. Transport chatter is not welcome here; it lives
 * one press away under Technical logs.
 */

function ActivityStrip({ ctx }: { ctx: RoomContext }) {
  const rows = useMemo(() => semanticEvents(ctx.events).slice().reverse(), [ctx.events]);
  const seen = useRef<number>(-1);
  const newestId = rows[0]?.id ?? -1;
  const freshFloor = seen.current;
  useEffect(() => {
    seen.current = newestId;
  }, [newestId]);

  return (
    <section className="grid h-[136px] shrink-0 grid-rows-[auto_minmax(0,1fr)] border-t border-[var(--hairline)] bg-[var(--panel)]">
      <header className="flex items-baseline gap-3 px-5 pb-1 pt-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          Live activity
        </h2>
        <span className="num text-[10px] text-[var(--text-muted)]">{rows.length}</span>
        <span className="ml-auto">
          <Action onClick={() => ctx.setFocus("logs")}>Technical logs</Action>
        </span>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-2">
        {rows.length === 0 ? (
          <Empty>Nothing has happened yet. Events appear here as Forge works.</Empty>
        ) : (
          <ul>
            {rows.map((e) => (
              <ActivityRow key={e.id} event={e} fresh={freshFloor >= 0 && e.id > freshFloor} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ── Mode consequence ─────────────────────────────────────────────────────
 * Shown on the canvas while the operator composes, and only when there is no
 * job to watch. Choosing a mode is choosing what Forge will spend and how
 * hard it will argue, so the pipeline it walks and the models it pays are
 * stated before the request is filed — not after.
 */

function ModeCanvas({ mode }: { mode: ForgeMode }) {
  const phases = MODE_PIPELINE[mode];
  return (
    <div className="min-h-0 overflow-y-auto px-8 py-7">
      <div className="max-w-[760px]">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          {mode}
        </h2>
        <p className="mt-1 max-w-[62ch] text-[14px] leading-[1.55] text-[var(--text)]">
          {MODE_BLURB[mode]}
        </p>
        <p className="mt-1 max-w-[62ch] text-[12px] leading-[1.6] text-[var(--text-muted)]">
          {whyMode(mode)}
        </p>

        <div className="mt-7 grid grid-cols-[minmax(0,1fr)_300px] gap-10">
          <section>
            <h3 className="flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Pipeline
              <span className="num">{phases.length} phases</span>
            </h3>
            <ol className="mt-2 divide-y divide-[var(--hairline)]">
              {phases.map((p, i) => (
                <li key={p.key} className="flex items-baseline gap-3 py-[5px]">
                  <span className="num w-[18px] shrink-0 text-[10px] text-[var(--text-muted)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 text-[12px] text-[var(--text-secondary)]">
                    {p.label}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    {p.role}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Models
            </h3>
            <ul className="mt-2 divide-y divide-[var(--hairline)]">
              {(["builder", "challenger", "escalation"] as const).map((role) => {
                const m = MODEL_REGISTRY[role];
                return (
                  <li key={role} className="py-2">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                      {role}
                    </p>
                    <p className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                      {m.modelId}
                    </p>
                    <p className="num text-[10px] text-[var(--text-muted)]">
                      ${m.inputCost} / ${m.outputCost} per 1M · {m.metadata.invocation}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <p className="mt-7 max-w-[62ch] border-t border-[var(--hairline)] pt-3 text-[12px] leading-[1.6] text-[var(--text-muted)]">
          {currentAction({ status: "DRAFT" }).why}
        </p>
      </div>
    </div>
  );
}
