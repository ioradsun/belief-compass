/**
 * The pipeline — one job as six stages read left to right.
 *
 * A horizontal rail of stage nodes (BRIEF · PLAN · BUILD · VERIFY · REVIEW ·
 * SHIP) sits above one detail panel. Selecting a node opens that stage; the
 * live stage is selected by default, so the screen always opens on what is
 * happening now. Each stage names the gstack operation that runs it — gstack is
 * the process, drawn on the stage it belongs to, never as a separate panel.
 *
 * The detail panel is where the work is legible: the plan and its critique, the
 * diff, the deterministic checks, and — the thing that used to hide — the
 * engineering review, shown as the reviewer's own output against the diff.
 */
import { useState } from "react";
import type {
  ForgeCheck,
  ForgeEvent,
  ForgeJob,
  ForgeModelRun,
  ForgeObjection,
} from "@/lib/forge/types";
import { VERIFICATION_PROFILES } from "@/lib/forge/types";
import {
  STAGE_KEYS,
  STAGE_META,
  type StageKey,
  type StageProgress,
  type StageState,
} from "@/lib/forge/pipeline";
import {
  SEVERITY_ORDER,
  checkTally,
  debateRound,
  gstackStates,
  severityCounts,
  type GstackReport,
  type StationTone,
} from "@/lib/forge/stations";
import { elapsed, whyMode, whyProfile } from "@/lib/forge/narrative";
import {
  Action,
  Body,
  CheckRow,
  Empty,
  Group,
  Lede,
  LinkAction,
  ObjectionRow,
  RawLog,
  Stat,
  Waiting,
  Why,
} from "./ForgePanels";
import { TONE_COLOR, timeOf } from "./tone";

/* ── Shared context ───────────────────────────────────────────────────────
 * One object, derived once by the route, handed to the rail and the detail.
 * They can never disagree about who is working because they read the same map.
 */

export type SelectedView = StageKey | "logs";

export type RoomContext = {
  job: ForgeJob;
  objections: ForgeObjection[];
  checks: ForgeCheck[];
  events: ForgeEvent[];
  modelRuns: ForgeModelRun[];
  stages: Record<StageKey, StageState>;
  live: StageKey | null;
  selected: SelectedView;
  setSelected: (v: SelectedView) => void;
  approvePlan: (() => void) | null;
  createPullRequest: (() => void) | null;
  /** The human's way into the debate: push the plan back with a note. */
  requestRevision: ((note: string) => void) | null;
  revising: boolean;
  /** Re-run a gstack review operation against the job. */
  runGstack: (operation: string) => void;
  gstackBusy: string | null;
  gstackDisabled: boolean;
  preview: string | null;
  diff: { patch: string | null; pending: boolean; error: string | null };
};

/* ── Tone ─────────────────────────────────────────────────────────────── */

const PROGRESS_TONE: Record<StageProgress, StationTone> = {
  done: "pass",
  live: "active",
  attention: "attention",
  fail: "fail",
  pending: "idle",
};

const PROGRESS_BADGE: Record<StageProgress, string> = {
  done: "Done",
  live: "Live",
  attention: "Needs you",
  fail: "Failed",
  pending: "Pending",
};

/* ── The rail ─────────────────────────────────────────────────────────────
 * Six nodes on one track. Position is the sequence; colour is the state. The
 * selected node is underlined, the live node pulses.
 */

export function PipelineRail({ ctx }: { ctx: RoomContext }) {
  return (
    <div className="shrink-0 border-b border-[var(--hairline)] bg-[var(--surface)] px-5 pb-3 pt-3.5">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Pipeline · {ctx.job.mode}
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">
          Each stage names the gstack operation that runs it — gstack is the process, not a panel.
        </span>
      </div>
      <div className="relative grid grid-cols-6">
        {/* the track sits behind the nodes, between the first and last dot */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-[6px] h-px"
          style={{ left: "8.333%", right: "8.333%", backgroundColor: "var(--border)" }}
        />
        {STAGE_KEYS.map((key) => (
          <RailNode key={key} ctx={ctx} stageKey={key} />
        ))}
      </div>
    </div>
  );
}

function RailNode({ ctx, stageKey }: { ctx: RoomContext; stageKey: StageKey }) {
  const meta = STAGE_META[stageKey];
  const state = ctx.stages[stageKey];
  const tone = PROGRESS_TONE[state.progress];
  const color = TONE_COLOR[tone];
  const selected = ctx.selected === stageKey;
  const live = state.progress === "live" || state.progress === "attention";

  return (
    <button
      type="button"
      onClick={() => ctx.setSelected(stageKey)}
      aria-current={selected ? "true" : undefined}
      className="group flex min-w-0 flex-col items-center gap-0 px-1 text-center"
    >
      <span
        aria-hidden
        className={`relative z-[1] mb-2 size-[14px] rounded-full border-2 ${live ? "forge-pulse" : ""}`}
        style={{
          backgroundColor: state.progress === "pending" ? "var(--surface)" : color,
          borderColor: state.progress === "pending" ? "var(--border)" : color,
          boxShadow: live ? `0 0 0 4px color-mix(in srgb, ${color} 22%, transparent)` : undefined,
        }}
      />
      <span
        className={`text-[12px] font-semibold leading-tight ${
          selected ? "underline decoration-[var(--border-strong)] underline-offset-4" : ""
        }`}
        style={{
          color:
            state.progress === "pending" && !selected ? "var(--text-secondary)" : "var(--text)",
        }}
      >
        {meta.title}
      </span>
      <span className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)]">
        {meta.gstack}
      </span>
      <span className="mt-1 text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {meta.owner}
      </span>
      <span
        className="num mt-1 text-[10px] font-semibold"
        style={{ color: state.progress === "pending" ? "var(--text-muted)" : color }}
      >
        {state.status}
      </span>
    </button>
  );
}

/* ── The detail panel ─────────────────────────────────────────────────────
 * One stage at a time, at full size. The route gives this the scroll region;
 * every renderer shares the same head, then lays out its own evidence.
 */

export function StageDetail({ ctx }: { ctx: RoomContext }) {
  return (
    <div className="min-h-0 overflow-y-auto overscroll-contain bg-[var(--bg)]">
      <div className="mx-auto max-w-[1080px] px-6 py-6">
        {ctx.selected === "logs" ? <LogsDetail ctx={ctx} /> : <StageBody ctx={ctx} />}
      </div>
    </div>
  );
}

function StageBody({ ctx }: { ctx: RoomContext }) {
  switch (ctx.selected as StageKey) {
    case "brief":
      return <BriefDetail ctx={ctx} />;
    case "plan":
      return <PlanDetail ctx={ctx} />;
    case "build":
      return <BuildDetail ctx={ctx} />;
    case "verify":
      return <VerifyDetail ctx={ctx} />;
    case "review":
      return <ReviewDetail ctx={ctx} />;
    case "ship":
      return <ShipDetail ctx={ctx} />;
  }
}

function StageHead({ title, op, state }: { title: string; op: string; state: StageState }) {
  const tone = PROGRESS_TONE[state.progress];
  const meta = STAGE_META[state.key];
  return (
    <header className="mb-5">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[19px] font-semibold tracking-[-0.01em]">{title}</h2>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">{op}</span>
        <span
          className="ml-auto shrink-0 rounded-[3px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{
            color: state.progress === "pending" ? "var(--text-muted)" : TONE_COLOR[tone],
            borderColor:
              state.progress === "pending"
                ? "var(--border)"
                : `color-mix(in srgb, ${TONE_COLOR[tone]} 45%, transparent)`,
          }}
        >
          {PROGRESS_BADGE[state.progress]}
        </span>
      </div>
      <p className="mt-2 max-w-[76ch] text-[13.5px] leading-[1.6] text-[var(--text)]">
        {state.description}
      </p>
      <p className="mt-1.5 max-w-[76ch] text-[12px] leading-[1.6] text-[var(--text-muted)]">
        {meta.blurb} · <span className="uppercase tracking-[0.1em]">{meta.owner}</span>
      </p>
    </header>
  );
}

function Columns({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">{children}</div>;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[4px] border border-[var(--hairline)] bg-[var(--panel)] px-3.5 py-3">
      {children}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-[var(--hairline)] py-1.5 last:border-b-0">
      <dt className="w-[104px] shrink-0 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {k}
      </dt>
      <dd className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-[var(--text)]">{v}</dd>
    </div>
  );
}

/** gstack operation output, shown as the reviewer's own words. */
function EventLines({ events }: { events: readonly ForgeEvent[] }) {
  if (events.length === 0) return <Empty>No output recorded yet.</Empty>;
  return (
    <ul className="space-y-1.5">
      {events.map((e) => (
        <li key={e.id} className="flex gap-2.5">
          <span className="num shrink-0 text-[10px] leading-[1.6] text-[var(--text-muted)]">
            {timeOf(e.createdAt)}
          </span>
          <span
            className="min-w-0 flex-1 text-[12.5px] leading-[1.55]"
            style={{ color: e.level === "error" ? TONE_COLOR.fail : "var(--text-secondary)" }}
          >
            {e.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function opReport(reports: readonly GstackReport[], operation: string): GstackReport | null {
  return reports.find((r) => r.operation === operation) ?? null;
}

function spend(runs: readonly ForgeModelRun[], role: ForgeModelRun["role"]) {
  const mine = runs.filter((r) => r.role === role);
  return { runs: mine.length, cost: mine.reduce((s, r) => s + r.costUsd, 0) };
}

/* ── 1. Brief ─────────────────────────────────────────────────────────── */

function BriefDetail({ ctx }: { ctx: RoomContext }) {
  const { job } = ctx;
  const office = opReport(gstackStates(ctx.events), "office-hours");
  return (
    <>
      <StageHead title="Brief" op={STAGE_META.brief.gstack} state={ctx.stages.brief} />
      <Columns>
        <div className="space-y-5">
          <Group label="Request">
            <Card>
              <p className="text-[13px] leading-[1.6] text-[var(--text)]">{job.request}</p>
            </Card>
          </Group>
          <Group label="Framing · /office-hours">
            <Card>
              {office && office.events.length > 0 ? (
                <EventLines events={office.events} />
              ) : (
                <Body>{whyMode(job.mode)}</Body>
              )}
            </Card>
          </Group>
        </div>
        <div className="space-y-5">
          <Group label="Frame">
            <Card>
              <dl>
                <Fact k="Mode" v={job.mode} />
                <Fact
                  k="Profile"
                  v={
                    job.verificationProfile
                      ? VERIFICATION_PROFILES[job.verificationProfile].label
                      : "selected after the plan"
                  }
                />
                <Fact k="Owner" v={STAGE_META.brief.owner} />
              </dl>
            </Card>
          </Group>
        </div>
      </Columns>
    </>
  );
}

/* ── 2. Plan ──────────────────────────────────────────────────────────── */

function PlanDetail({ ctx }: { ctx: RoomContext }) {
  const [note, setNote] = useState("");
  const { job, objections, modelRuns } = ctx;
  const plan = job.plan;
  const round = debateRound(objections);
  const ledger = spend(modelRuns, "builder");

  const ordered = [...objections].sort((a, b) => {
    const settled = (o: ForgeObjection) =>
      o.status === "open" || o.status === "maintained" ? 0 : 1;
    return (
      settled(a) - settled(b) ||
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      b.round - a.round
    );
  });

  const send = () => {
    if (!note.trim() || !ctx.requestRevision) return;
    ctx.requestRevision(note.trim());
    setNote("");
  };

  return (
    <>
      <StageHead title="Plan" op={STAGE_META.plan.gstack} state={ctx.stages.plan} />
      {!plan ? (
        <Waiting
          title="No plan yet"
          body="The engineer reports a plan once it has read the repository and found the mechanism that already owns this behaviour."
        />
      ) : (
        <Columns>
          <div className="space-y-5">
            <Group label="Plan · the engineer">
              <Card>
                <Lede>{plan.summary}</Lede>
              </Card>
            </Group>
            {plan.steps?.length ? (
              <Group label="Steps">
                <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">
                  {plan.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </Group>
            ) : null}
            {plan.acceptanceCriteria?.length ? (
              <Group label="Acceptance criteria">
                <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">
                  {plan.acceptanceCriteria.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </Group>
            ) : null}
          </div>
          <div className="space-y-5">
            <Group label="Shape">
              <Card>
                <dl>
                  {plan.filesTouched?.length ? (
                    <Fact
                      k="Files"
                      v={
                        <span className="font-mono text-[11px]">
                          {plan.filesTouched.join(" · ")}
                        </span>
                      }
                    />
                  ) : null}
                  {plan.risks?.length ? <Fact k="Risk" v={plan.risks.join("; ")} /> : null}
                  {plan.confidence != null ? (
                    <Fact k="Confidence" v={`${Math.round(plan.confidence * 100)}%`} />
                  ) : null}
                  <Fact
                    k="Reviewer runs"
                    v={
                      ledger.runs === 0 ? "none yet" : `${ledger.runs} · $${ledger.cost.toFixed(4)}`
                    }
                  />
                </dl>
              </Card>
            </Group>
            <Group
              label={`Plan critique · /plan-eng-review${round > 1 ? ` · round ${round}` : ""}`}
            >
              {ordered.length === 0 ? (
                <Empty>No objection has been raised against the plan.</Empty>
              ) : (
                <ul className="divide-y divide-[var(--hairline)]">
                  {ordered.map((o) => (
                    <ObjectionRow key={o.id} objection={o} expanded />
                  ))}
                </ul>
              )}
            </Group>
            {job.planLockedAt && (
              <div className="flex items-center gap-2.5 rounded-[4px] border border-[var(--hairline)] bg-[var(--surface)] px-3.5 py-3">
                <span
                  aria-hidden
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ backgroundColor: TONE_COLOR.pass }}
                />
                <p className="text-[12.5px] text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--text)]">Plan locked.</span>{" "}
                  Implementation works only from here.
                </p>
              </div>
            )}
          </div>
        </Columns>
      )}

      {(ctx.approvePlan || ctx.requestRevision) && (
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--hairline)] pt-4">
          {ctx.approvePlan && (
            <Action weight="primary" onClick={() => ctx.approvePlan?.()}>
              Lock the plan
            </Action>
          )}
          {ctx.requestRevision && (
            <div className="flex min-w-[280px] flex-1 items-center gap-2 rounded-[3px] border border-[var(--hairline)] px-2.5 py-1">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
                placeholder="Object to the plan yourself, and send it back…"
                className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--text-muted)]"
              />
              <Action disabled={!note.trim() || ctx.revising} onClick={send}>
                {ctx.revising ? "Sending" : "Send back"}
              </Action>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ── 3. Build ─────────────────────────────────────────────────────────── */

/** Split a unified patch into per-file bodies, keyed by the post-image path. */
function patchByFile(patch: string): Map<string, string> {
  const byFile = new Map<string, string>();
  let path: string | null = null;
  let lines: string[] = [];
  for (const line of patch.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      if (path) byFile.set(path, lines.join("\n"));
      path = header[2];
      lines = [];
      continue;
    }
    if (path) lines.push(line);
  }
  if (path) byFile.set(path, lines.join("\n"));
  return byFile;
}

function DiffBody({ patch }: { patch: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.55]">
      {patch.split("\n").map((line, i) => {
        const header = line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@");
        const tone = header
          ? "var(--text-secondary)"
          : line.startsWith("+")
            ? TONE_COLOR.pass
            : line.startsWith("-")
              ? TONE_COLOR.fail
              : "var(--text-muted)";
        return (
          <span key={i} style={{ color: tone, display: "block" }}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

function BuildDetail({ ctx }: { ctx: RoomContext }) {
  const { job, diff } = ctx;
  const [openFile, setOpenFile] = useState<string | null>(null);
  const d = job.diffSummary;
  const hunks = diff.patch ? patchByFile(diff.patch) : null;

  return (
    <>
      <StageHead title="Build" op={STAGE_META.build.gstack} state={ctx.stages.build} />
      {!d ? (
        <Waiting
          title={job.planLockedAt ? "Implementation queued" : "Plan not locked"}
          body={
            job.planLockedAt
              ? "The plan is locked. Changed files appear here as the engineer writes them."
              : "Nothing is written until the plan survives review and you lock it."
          }
        />
      ) : (
        <Columns>
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Files" value={d.filesChanged} />
              <Stat label="Added" value={`+${d.additions}`} tone="pass" />
              <Stat label="Removed" value={`−${d.deletions}`} tone="fail" />
            </div>
            <Group label="Changed files">
              {d.files?.length ? (
                <ul className="divide-y divide-[var(--hairline)]">
                  {d.files.map((f) => {
                    const selected = openFile === f.path;
                    return (
                      <li key={f.path}>
                        <button
                          type="button"
                          onClick={() => setOpenFile(selected ? null : f.path)}
                          className="flex w-full items-baseline gap-2 py-[5px] text-left"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[var(--text-secondary)]">
                            {f.path}
                          </span>
                          <span className="num shrink-0 text-[10px]">
                            <span style={{ color: TONE_COLOR.pass }}>+{f.additions}</span>{" "}
                            <span style={{ color: TONE_COLOR.fail }}>−{f.deletions}</span>
                          </span>
                        </button>
                        {selected && (
                          <div className="mb-2 overflow-x-auto rounded-[3px] bg-[var(--bg)] p-2">
                            {diff.pending ? (
                              <Empty>Reading the diff from the worker…</Empty>
                            ) : diff.error ? (
                              <Empty>{diff.error}</Empty>
                            ) : hunks?.get(f.path) ? (
                              <DiffBody patch={hunks.get(f.path) as string} />
                            ) : (
                              <Empty>The worker did not return a patch for this file.</Empty>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>The worker reported totals but no per-file breakdown.</Empty>
              )}
            </Group>
          </div>
          <div className="space-y-5">
            <Group label="Branch">
              <Card>
                <dl>
                  <Fact
                    k="Name"
                    v={
                      <span className="font-mono text-[11px]">
                        {job.branchName ?? "not created"}
                      </span>
                    }
                  />
                  <Fact k="Base" v={<span className="font-mono text-[11px]">main</span>} />
                  <Fact k="Rule" v="Never main, never force-push, never merges itself." />
                </dl>
              </Card>
            </Group>
            {ctx.preview && (
              <Group label="Preview">
                <LinkAction href={ctx.preview}>Open preview</LinkAction>
              </Group>
            )}
          </div>
        </Columns>
      )}
    </>
  );
}

/* ── 4. Verify ────────────────────────────────────────────────────────── */

function VerifyDetail({ ctx }: { ctx: RoomContext }) {
  const [open, setOpen] = useState<string | null>(null);
  const { job, checks } = ctx;
  const tally = checkTally(checks);
  const profile = job.verificationProfile ? VERIFICATION_PROFILES[job.verificationProfile] : null;
  const failed = checks.find((c) => c.status === "failed");

  const rows =
    checks.length > 0
      ? checks.map((c) => ({
          key: c.id,
          name: c.name,
          status: c.status,
          durationMs: c.durationMs,
          detail: c.failureSummary ?? c.outputSummary,
          raw: c.outputSummary,
        }))
      : (profile?.checks ?? []).map((name) => ({
          key: name,
          name,
          status: "pending" as const,
          durationMs: null,
          detail: null,
          raw: null,
        }));

  return (
    <>
      <StageHead title="Verify" op={STAGE_META.verify.gstack} state={ctx.stages.verify} />
      <Columns>
        <div className="space-y-4">
          {failed && (
            <div className="border-l-2 py-1.5 pl-3" style={{ borderColor: TONE_COLOR.fail }}>
              <p className="font-mono text-[11.5px]" style={{ color: TONE_COLOR.fail }}>
                {failed.name}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-[1.55] text-[var(--text)]">
                {failed.failureSummary ?? "The check failed without a summary."}
              </p>
            </div>
          )}
          <Group
            label={
              checks.length > 0
                ? `Checks · ${tally.settled}/${tally.total} complete`
                : `Queued · ${profile?.label ?? "selected"} profile`
            }
          >
            <ul>
              {rows.map((r) => (
                <CheckRow
                  key={r.key}
                  name={r.name}
                  status={r.status}
                  durationMs={r.durationMs}
                  detail={r.detail}
                  raw={r.raw}
                  open={open === r.key || (r.status === "failed" && open === null)}
                  onToggle={() => setOpen(open === r.key ? null : r.key)}
                />
              ))}
            </ul>
          </Group>
        </div>
        <div className="space-y-4">
          {profile?.gates?.length ? (
            <Group label="Extra gates">
              <Card>
                <p className="text-[12.5px] leading-[1.55] text-[var(--text-secondary)]">
                  {profile.gates.join(", ")}.
                </p>
              </Card>
            </Group>
          ) : null}
          {whyProfile(job) && (
            <Group label="Why these checks">
              <Card>
                <p className="text-[12.5px] leading-[1.6] text-[var(--text-muted)]">
                  {whyProfile(job)}
                </p>
              </Card>
            </Group>
          )}
        </div>
      </Columns>
    </>
  );
}

/* ── 5. Review — the engineering review ───────────────────────────────────
 * The reviewer that attacked the plan now reads the diff. This panel is the
 * whole point of the rework: the engineering review is shown here, in the
 * reviewer's own output, against the change it is reading.
 */

function ReviewDetail({ ctx }: { ctx: RoomContext }) {
  const { job, objections } = ctx;
  const reports = gstackStates(ctx.events);
  const review = opReport(reports, "review");
  const engReview = opReport(reports, "engineering review");
  const qa = opReport(reports, "qa");
  const cso = opReport(reports, "cso");
  const reviewEvents = [...(engReview?.events ?? []), ...(review?.events ?? [])].sort(
    (a, b) => a.id - b.id,
  );
  const noted = severityCounts(objections);
  const d = job.diffSummary;
  const rerunnable = !ctx.gstackDisabled;

  return (
    <>
      <StageHead
        title="Engineering review"
        op={STAGE_META.review.gstack}
        state={ctx.stages.review}
      />
      <Columns>
        <div className="space-y-5">
          <Group label="Engineering review · /review">
            <Card>
              {reviewEvents.length > 0 ? (
                <EventLines events={reviewEvents} />
              ) : (
                <Body>
                  {ctx.stages.review.progress === "pending"
                    ? "The reviewer reads the diff once the checks are in. Its output appears here."
                    : "The reviewer is reading the diff. Its findings appear here as it works."}
                </Body>
              )}
              {rerunnable && (
                <div className="mt-3">
                  <Action
                    disabled={ctx.gstackBusy === "engineering review"}
                    onClick={() => ctx.runGstack("engineering review")}
                  >
                    {ctx.gstackBusy === "engineering review"
                      ? "Running…"
                      : "Run engineering review"}
                  </Action>
                </div>
              )}
            </Card>
          </Group>
          {qa && qa.events.length > 0 && (
            <Group label="Browser QA · /qa">
              <Card>
                <EventLines events={qa.events} />
              </Card>
            </Group>
          )}
          {cso && cso.events.length > 0 && (
            <Group label="Security · /cso">
              <Card>
                <EventLines events={cso.events} />
              </Card>
            </Group>
          )}
        </div>
        <div className="space-y-5">
          <Group label="Reviewing against">
            <Card>
              {d?.files?.length ? (
                <ul className="space-y-1">
                  {d.files.slice(0, 8).map((f) => (
                    <li key={f.path} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-secondary)]">
                        {f.path}
                      </span>
                      <span className="num shrink-0 text-[10px]">
                        <span style={{ color: TONE_COLOR.pass }}>+{f.additions}</span>{" "}
                        <span style={{ color: TONE_COLOR.fail }}>−{f.deletions}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No diff to review yet.</Empty>
              )}
              <div className="mt-2">
                <Action onClick={() => ctx.setSelected("build")}>See the full diff</Action>
              </div>
            </Card>
          </Group>
          <Group label="Verdict">
            <Card>
              <p className="text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">
                {job.mode === "FAST"
                  ? "In FAST, the diff review is the safeguard the plan debate would otherwise be."
                  : "In DEBATE, a MEDIUM suggestion does not block — it rides to your approval as a note."}
                {noted.MEDIUM > 0
                  ? ` ${noted.MEDIUM} medium note${noted.MEDIUM === 1 ? "" : "s"} recorded in the plan debate.`
                  : ""}
              </p>
            </Card>
          </Group>
        </div>
      </Columns>
    </>
  );
}

/* ── 6. Ship ──────────────────────────────────────────────────────────────
 * Delivery and human authority. Forge never merges — there is no button for
 * it, and there never will be.
 */

function ShipDetail({ ctx }: { ctx: RoomContext }) {
  const { job, objections, checks } = ctx;
  const tally = checkTally(checks);
  const resolved = objections.filter((o) => o.status === "resolved").length;
  const ready = job.status === "READY_FOR_HUMAN";

  return (
    <>
      <StageHead title="Ship" op={STAGE_META.ship.gstack} state={ctx.stages.ship} />
      <Columns>
        <div className="space-y-5">
          {ready ? (
            <div className="rounded-[4px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-3.5">
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: TONE_COLOR.attention }}
              >
                Ready for you
              </p>
              <p className="mt-1 text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">
                Everything Forge can judge has passed. A human decides whether this ships.
              </p>
              <dl className="mt-3">
                {job.diffSummary && (
                  <Fact
                    k="Changed"
                    v={`${job.diffSummary.filesChanged} files · +${job.diffSummary.additions} / −${job.diffSummary.deletions}`}
                  />
                )}
                {tally.total > 0 && (
                  <Fact k="Verification" v={`${tally.passed} / ${tally.total} passed`} />
                )}
                {objections.length > 0 && (
                  <Fact k="Debate" v={`${objections.length} raised · ${resolved} resolved`} />
                )}
                <Fact k="Cost" v={`$${job.totalCostUsd.toFixed(2)} · ${elapsed(job.createdAt)}`} />
              </dl>
            </div>
          ) : (
            <Waiting
              title={job.prUrl ? "Delivered" : "Not ready"}
              body={
                job.prUrl
                  ? "Forge never merges. Review and merge the pull request on GitHub."
                  : "Delivery unlocks when the change has been implemented, verified and reviewed."
              }
            />
          )}
          <Group label="Receipt">
            <Card>
              <dl>
                <Fact k="Request" v={job.request} />
                <Fact k="Mode" v={job.mode} />
                <Fact k="Objections" v={`${objections.length} raised · ${resolved} resolved`} />
                <Fact
                  k="Tokens"
                  v={`${job.inputTokens.toLocaleString()} in · ${job.outputTokens.toLocaleString()} out`}
                />
                {job.error && <Fact k="Error" v={job.error} />}
              </dl>
            </Card>
          </Group>
        </div>
        <div className="space-y-5">
          <Group label="Delivery">
            <Card>
              <dl>
                <Fact
                  k="Branch"
                  v={
                    <span className="font-mono text-[11px]">{job.branchName ?? "not created"}</span>
                  }
                />
                <Fact k="Preview" v={ctx.preview ? "available" : "none"} />
                <Fact k="Pull request" v={job.prUrl ? "open" : "not created"} />
                <Fact
                  k="Target"
                  v={<span className="font-mono text-[11px]">ioradsun/belief-compass</span>}
                />
              </dl>
            </Card>
          </Group>
          <div className="flex flex-wrap gap-2">
            {ctx.preview && <LinkAction href={ctx.preview}>Open preview</LinkAction>}
            {ctx.createPullRequest && (
              <Action weight="primary" onClick={() => ctx.createPullRequest?.()}>
                Create pull request
              </Action>
            )}
            {job.prUrl && <LinkAction href={job.prUrl}>Open PR</LinkAction>}
          </div>
          <Why label="Why doesn't Forge merge?">
            Delivery is where a human takes responsibility. Forge readies the change and stops; you
            merge on GitHub. There is no auto-merge, in any mode.
          </Why>
        </div>
      </Columns>
    </>
  );
}

/* ── Technical logs ───────────────────────────────────────────────────────
 * Evidence, one press from the activity strip, never the thing the operator
 * has to read to know what is happening.
 */

function LogsDetail({ ctx }: { ctx: RoomContext }) {
  return (
    <>
      <header className="mb-4 flex items-baseline gap-3">
        <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Technical logs</h2>
        <span className="num text-[11px] text-[var(--text-muted)]">{ctx.events.length} events</span>
        <span className="ml-auto">
          <Action onClick={() => ctx.setSelected(ctx.live ?? "brief")}>Back to the stage</Action>
        </span>
      </header>
      <p className="mb-4 text-[12px] text-[var(--text-muted)]">
        The raw event stream, for debugging Forge itself — not the interface.
      </p>
      <RawLog events={ctx.events} />
    </>
  );
}
