/**
 * The six stations.
 *
 * Each one is a place in the engineering system, not a tab: BUILDER creates,
 * CHALLENGER questions, GSTACK enforces the process, IMPLEMENTATION carries
 * the change, VERIFY produces objective evidence, SHIP holds delivery and the
 * human gate. They never move and never reorder — the operator should be able
 * to find the Challenger by muscle memory.
 *
 * Every station renders twice: compact, in the grid, and expanded, in Focus
 * Mode. The expanded form adds evidence (plan steps, full objection bodies,
 * raw check output, the diff) — never a different story.
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
  GSTACK_BLURB,
  GSTACK_LABEL,
  SEVERITY_ORDER,
  checkTally,
  debateRound,
  gstackStates,
  planAwaitsHuman,
  severityCounts,
  type GstackState,
  type StationKey,
  type StationState,
} from "@/lib/forge/stations";
import { currentAction, elapsed, whyProfile } from "@/lib/forge/narrative";
import {
  Action,
  Body,
  CheckRow,
  Empty,
  Group,
  Lede,
  LinkAction,
  ObjectionRow,
  Panel,
  Path,
  RawLog,
  Stat,
  Waiting,
  Why,
} from "./ForgePanels";
import { TONE_COLOR, timeOf } from "./tone";

/* ── Shared context ───────────────────────────────────────────────────────
 * One object, derived once by the route, handed to every station. Two panels
 * disagreeing about who is working would be worse than either being wrong.
 */

export type FocusKey = StationKey | "logs";

export type RoomContext = {
  job: ForgeJob;
  objections: ForgeObjection[];
  checks: ForgeCheck[];
  events: ForgeEvent[];
  modelRuns: ForgeModelRun[];
  states: Record<StationKey, StationState>;
  live: StationKey | null;
  focus: FocusKey | null;
  setFocus: (key: FocusKey | null) => void;
  approvePlan: (() => void) | null;
  createPullRequest: (() => void) | null;
  /** The human's way into the debate: push the plan back with a note. */
  requestRevision: ((note: string) => void) | null;
  revising: boolean;
  runGstack: (operation: string) => void;
  gstackBusy: string | null;
  gstackDisabled: boolean;
  preview: string | null;
  /** The file whose patch is open. Lifted here so the route knows to fetch it. */
  diffFile: string | null;
  setDiffFile: (path: string | null) => void;
  diff: { patch: string | null; pending: boolean; error: string | null };
};

type StationProps = { ctx: RoomContext; expanded?: boolean };

function spend(runs: readonly ForgeModelRun[], role: ForgeModelRun["role"]) {
  const mine = runs.filter((r) => r.role === role);
  return { runs: mine.length, cost: mine.reduce((s, r) => s + r.costUsd, 0) };
}

function panelProps(ctx: RoomContext, key: StationKey) {
  const state = ctx.states[key];
  return {
    status: state.status,
    tone: state.tone,
    subtitle: state.subtitle,
    active: ctx.live === key,
    focused: ctx.focus === key,
    onFocus: () => ctx.setFocus(ctx.focus === key ? null : key),
  };
}

/* ── 1. Builder ───────────────────────────────────────────────────────── */

export function BuilderStation({ ctx, expanded = false }: StationProps) {
  const { job, objections, modelRuns } = ctx;
  const state = ctx.states.builder;
  const action = currentAction(job);
  const working = job.plan?.filesTouched ?? job.diffSummary?.files?.map((f) => f.path) ?? [];
  const decided = [...objections].reverse().find((o) => o.resolution)?.resolution ?? null;
  const ledger = spend(modelRuns, "builder");

  return (
    <Panel title="Builder" {...panelProps(ctx, "builder")}>
      {state.waiting ? (
        <Waiting {...state.waiting} />
      ) : (
        <>
          <Group label="Current task">
            <Lede>{action.headline}</Lede>
            {job.plan?.summary && <Body>{job.plan.summary}</Body>}
          </Group>

          {job.diffSummary && (
            <Group label="Changed">
              <p className="num text-[13px] text-[var(--text-secondary)]">
                {job.diffSummary.filesChanged} files · +{job.diffSummary.additions} / −
                {job.diffSummary.deletions}
              </p>
            </Group>
          )}

          {working.length > 0 && (
            <Group label="Working set">
              <ul className="space-y-px">
                {(expanded ? working : working.slice(0, 5)).map((p) => (
                  <li key={p} className="truncate">
                    <Path>{p}</Path>
                  </li>
                ))}
                {!expanded && working.length > 5 && (
                  <li className="text-[11px] text-[var(--text-muted)]">
                    +{working.length - 5} more
                  </li>
                )}
              </ul>
            </Group>
          )}

          {decided && (
            <Group label="Latest decision">
              <Body>{decided}</Body>
            </Group>
          )}

          {expanded && job.plan?.steps?.length ? (
            <Group label="Plan">
              <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-[1.55] text-[var(--text-secondary)]">
                {job.plan.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </Group>
          ) : null}

          {expanded && job.plan?.acceptanceCriteria?.length ? (
            <Group label="Acceptance criteria">
              <ul className="list-disc space-y-1 pl-4 text-[12px] leading-[1.55] text-[var(--text-secondary)]">
                {job.plan.acceptanceCriteria.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Group>
          ) : null}

          {expanded && job.plan?.risks?.length ? (
            <Group label="Risks the Builder named">
              <ul className="list-disc space-y-1 pl-4 text-[12px] leading-[1.55] text-[var(--text-secondary)]">
                {job.plan.risks.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Group>
          ) : null}

          {action.next && (
            <Group label="Next">
              <Body>{action.next}</Body>
            </Group>
          )}
        </>
      )}

      <div className="mt-3 flex items-baseline gap-3 border-t border-[var(--hairline)] pt-2">
        <Stat
          label="Runs"
          value={ledger.runs === 0 ? "none" : `${ledger.runs} · $${ledger.cost.toFixed(4)}`}
        />
        {job.plan?.confidence != null && (
          <Stat label="Confidence" value={`${Math.round(job.plan.confidence * 100)}%`} />
        )}
      </div>
    </Panel>
  );
}

/* ── 2. Challenger ────────────────────────────────────────────────────── */

export function ChallengerStation({ ctx, expanded = false }: StationProps) {
  const [note, setNote] = useState("");
  const { objections, modelRuns } = ctx;
  const state = ctx.states.challenger;
  const counts = severityCounts(objections);
  const round = debateRound(objections);
  const ledger = spend(modelRuns, "challenger");

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
    <Panel
      title="Challenger"
      {...panelProps(ctx, "challenger")}
      footer={
        ctx.requestRevision ? (
          <div className="flex items-center gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
              placeholder="Object to the plan yourself…"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--text-muted)]"
            />
            <Action disabled={!note.trim() || ctx.revising} onClick={send}>
              {ctx.revising ? "Sending" : "Send"}
            </Action>
          </div>
        ) : undefined
      }
    >
      {state.waiting ? (
        <Waiting {...state.waiting} />
      ) : (
        <>
          <div className="flex items-baseline gap-3 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              Round {round || 1}
            </span>
            <span className="ml-auto flex items-baseline gap-2">
              {SEVERITY_ORDER.map((s) => (
                <span
                  key={s}
                  className="num text-[10px] uppercase tracking-[0.08em]"
                  style={{
                    color:
                      counts[s] === 0
                        ? "var(--text-muted)"
                        : s === "CRITICAL" || s === "HIGH"
                          ? TONE_COLOR.fail
                          : s === "MEDIUM"
                            ? TONE_COLOR.attention
                            : "var(--text-secondary)",
                  }}
                >
                  {s.slice(0, 4)} {counts[s]}
                </span>
              ))}
            </span>
          </div>
          {ordered.length === 0 ? (
            <Empty>No objection has been raised in this round.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {ordered.map((o) => (
                <ObjectionRow key={o.id} objection={o} expanded={expanded} />
              ))}
            </ul>
          )}
        </>
      )}
      <div className="mt-3 border-t border-[var(--hairline)] pt-2">
        <Stat
          label="Runs"
          value={ledger.runs === 0 ? "none" : `${ledger.runs} · $${ledger.cost.toFixed(4)}`}
        />
      </div>
    </Panel>
  );
}

/* ── 3. gstack ────────────────────────────────────────────────────────────
 * The process layer. Not a third competing agent — a discipline the job is
 * held to, whose operations either reported or did not.
 */

const GSTACK_GLYPH: Record<GstackState, string> = {
  passed: "✓",
  failed: "✕",
  running: "●",
  requested: "◐",
  idle: "○",
};

const GSTACK_TONE: Record<GstackState, keyof typeof TONE_COLOR> = {
  passed: "pass",
  failed: "fail",
  running: "active",
  requested: "attention",
  idle: "idle",
};

export function GstackStation({ ctx, expanded = false }: StationProps) {
  const [open, setOpen] = useState<string | null>(null);
  const reports = gstackStates(ctx.events);
  const state = ctx.states.gstack;

  return (
    <Panel title="gstack" {...panelProps(ctx, "gstack")}>
      {state.waiting && <Waiting {...state.waiting} />}
      <ul className={state.waiting ? "mt-3" : "mt-1"}>
        {reports.map((r) => {
          const selected = open === r.operation;
          return (
            <li key={r.operation}>
              <button
                type="button"
                onClick={() => setOpen(selected ? null : r.operation)}
                className="flex w-full items-baseline gap-2 py-[3px] text-left"
              >
                <span
                  className="w-[11px] shrink-0 text-[11px]"
                  style={{ color: TONE_COLOR[GSTACK_TONE[r.state]] }}
                >
                  {GSTACK_GLYPH[r.state]}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-[12px] capitalize leading-[1.5] ${
                    r.state === "idle" ? "text-[var(--text-muted)]" : "text-[var(--text-secondary)]"
                  }`}
                >
                  {r.operation}
                </span>
                <span
                  className="shrink-0 text-[10px] uppercase tracking-[0.1em]"
                  style={{ color: TONE_COLOR[GSTACK_TONE[r.state]] }}
                >
                  {r.state === "idle" ? "" : GSTACK_LABEL[r.state]}
                </span>
              </button>
              {selected && (
                <div className="pb-2 pl-[19px]">
                  <p className="text-[12px] leading-[1.55] text-[var(--text-muted)]">
                    {GSTACK_BLURB[r.operation]}
                  </p>
                  {r.events.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {(expanded ? r.events : r.events.slice(-4)).map((e) => (
                        <li key={e.id} className="flex gap-2">
                          <span className="num shrink-0 text-[10px] text-[var(--text-muted)]">
                            {timeOf(e.createdAt)}
                          </span>
                          <span
                            className="min-w-0 flex-1 text-[12px] leading-[1.5]"
                            style={{
                              color:
                                e.level === "error" ? TONE_COLOR.fail : "var(--text-secondary)",
                            }}
                          >
                            {e.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2">
                    <Action
                      disabled={ctx.gstackDisabled || ctx.gstackBusy === r.operation}
                      onClick={() => ctx.runGstack(r.operation)}
                    >
                      {ctx.gstackBusy === r.operation
                        ? "Sending"
                        : r.state === "idle"
                          ? "Run"
                          : "Run again"}
                    </Action>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ── 4. Implementation ────────────────────────────────────────────────────
 * The code-change station. What changed, where, how much — not an IDE.
 */

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
    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.55]">
      {patch.split("\n").map((line, i) => {
        // File headers are structure, not change; only the actual +/- lines
        // are allowed to carry the added/removed colour.
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

export function ImplementationStation({ ctx, expanded = false }: StationProps) {
  const { job, diff } = ctx;
  const state = ctx.states.implementation;
  const d = job.diffSummary;
  const file = ctx.diffFile;
  const hunks = diff.patch ? patchByFile(diff.patch) : null;

  // In the grid a file press is a request to look closely, so it opens Focus
  // Mode on this station rather than growing a panel that cannot grow.
  const openFile = (path: string) => {
    ctx.setDiffFile(file === path ? null : path);
    if (!expanded) ctx.setFocus("implementation");
  };

  return (
    <Panel
      title="Implementation"
      {...panelProps(ctx, "implementation")}
      footer={
        d ? (
          <div className="flex gap-2">
            <Action
              onClick={() => {
                ctx.setDiffFile(null);
                ctx.setFocus("implementation");
              }}
            >
              View full diff
            </Action>
          </div>
        ) : undefined
      }
    >
      {state.waiting ? (
        <Waiting {...state.waiting} />
      ) : (
        d && (
          <>
            <div className="grid grid-cols-3 gap-2 pb-2">
              <Stat label="Files" value={d.filesChanged} />
              <Stat label="Added" value={`+${d.additions}`} tone="pass" />
              <Stat label="Removed" value={`−${d.deletions}`} tone="fail" />
            </div>
            {d.files?.length ? (
              <ul className="divide-y divide-[var(--hairline)]">
                {d.files.map((f) => {
                  const selected = file === f.path;
                  return (
                    <li key={f.path}>
                      <button
                        type="button"
                        onClick={() => openFile(f.path)}
                        className="flex w-full items-baseline gap-2 py-[3px] text-left"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-secondary)]">
                          {f.path}
                        </span>
                        <span className="num shrink-0 text-[10px]">
                          <span style={{ color: TONE_COLOR.pass }}>+{f.additions}</span>{" "}
                          <span style={{ color: TONE_COLOR.fail }}>−{f.deletions}</span>
                        </span>
                      </button>
                      {selected && expanded && (
                        <div className="overflow-x-auto bg-[var(--bg)] p-2">
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
            {expanded && !file && (
              <div className="mt-3 border-t border-[var(--hairline)] pt-2">
                <Group label="Full diff">
                  {diff.pending ? (
                    <Empty>Reading the diff from the worker…</Empty>
                  ) : diff.error ? (
                    <Empty>{diff.error}</Empty>
                  ) : diff.patch ? (
                    <DiffBody patch={diff.patch} />
                  ) : (
                    <Empty>The worker has not returned a patch for this change.</Empty>
                  )}
                </Group>
              </div>
            )}
          </>
        )
      )}
    </Panel>
  );
}

/* ── 5. Verify ────────────────────────────────────────────────────────── */

export function VerifyStation({ ctx, expanded = false }: StationProps) {
  const [open, setOpen] = useState<string | null>(null);
  const { job, checks } = ctx;
  const state = ctx.states.verify;
  const tally = checkTally(checks);
  const profile = job.verificationProfile ? VERIFICATION_PROFILES[job.verificationProfile] : null;
  const failed = checks.find((c) => c.status === "failed");

  // Before the worker reports, the profile itself is the honest answer to
  // "what will run" — shown as pending, never as passed.
  const rows =
    checks.length > 0
      ? checks.map((c) => ({
          key: c.id,
          name: c.name,
          status: c.status,
          durationMs: c.durationMs,
          detail: c.failureSummary ?? c.outputSummary,
        }))
      : (profile?.checks ?? []).map((name) => ({
          key: name,
          name,
          status: "pending" as const,
          durationMs: null,
          detail: null,
        }));

  return (
    <Panel title="Verify" {...panelProps(ctx, "verify")}>
      {checks.length === 0 && state.waiting ? (
        <Waiting {...state.waiting} />
      ) : (
        <p className="num pb-1 text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
          {tally.settled} / {tally.total} complete
          {tally.failed > 0 && (
            <span style={{ color: TONE_COLOR.fail }}> · {tally.failed} failed</span>
          )}
        </p>
      )}

      {failed && (
        <div className="mb-2 border-l-2 py-1.5 pl-2" style={{ borderColor: TONE_COLOR.fail }}>
          <p className="font-mono text-[11px]" style={{ color: TONE_COLOR.fail }}>
            {failed.name}
          </p>
          <p className="mt-0.5 text-[12px] leading-[1.55] text-[var(--text)]">
            {failed.failureSummary ?? "The check failed without a summary."}
          </p>
        </div>
      )}

      <ul>
        {rows.map((r) => (
          <CheckRow
            key={r.key}
            name={r.name}
            status={r.status}
            durationMs={r.durationMs}
            detail={r.detail}
            raw={expanded ? (checks.find((c) => c.id === r.key)?.outputSummary ?? null) : null}
            open={open === r.key || (expanded && r.status === "failed")}
            onToggle={() => setOpen(open === r.key ? null : r.key)}
          />
        ))}
      </ul>

      {profile?.gates?.length ? (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          Additional gates: {profile.gates.join(", ")}.
        </p>
      ) : null}
      {expanded && whyProfile(job) && (
        <div className="mt-2">
          <Why label="Why these checks?">{whyProfile(job)}</Why>
        </div>
      )}
    </Panel>
  );
}

/* ── 6. Ship ──────────────────────────────────────────────────────────────
 * Delivery and human authority. Forge never merges — there is no button for
 * it, and there never will be.
 */

export function ShipStation({ ctx, expanded = false }: StationProps) {
  const { job, objections, checks } = ctx;
  const tally = checkTally(checks);
  const resolved = objections.filter((o) => o.status === "resolved").length;
  const highResolved = objections.filter(
    (o) => (o.severity === "HIGH" || o.severity === "CRITICAL") && o.status === "resolved",
  ).length;
  const noted = objections.filter((o) => o.severity === "MEDIUM").length;
  const ready = job.status === "READY_FOR_HUMAN";
  const planGate = planAwaitsHuman(job) && ctx.approvePlan !== null;

  return (
    <Panel
      title="Ship"
      {...panelProps(ctx, "ship")}
      footer={
        <div className="flex flex-wrap gap-2">
          {planGate && (
            <Action weight="primary" onClick={() => ctx.approvePlan?.()}>
              Approve plan
            </Action>
          )}
          {job.diffSummary && (
            <Action onClick={() => ctx.setFocus("implementation")}>View diff</Action>
          )}
          {ctx.preview && <LinkAction href={ctx.preview}>Open preview</LinkAction>}
          {ctx.createPullRequest && (
            <Action weight="primary" onClick={() => ctx.createPullRequest?.()}>
              Create PR
            </Action>
          )}
          {job.prUrl && <LinkAction href={job.prUrl}>Open PR</LinkAction>}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 pb-2">
        <Stat label="Branch" value={job.branchName ?? "not created"} />
        <Stat
          label="Preview"
          value={ctx.preview ? "available" : "none"}
          tone={ctx.preview ? "pass" : undefined}
        />
        <Stat label="Pull request" value={job.prUrl ? "open" : "not created"} />
        <Stat
          label="Human approval"
          value={ready || planGate ? "required" : job.prUrl ? "given" : "not yet"}
          tone={ready || planGate ? "attention" : undefined}
        />
      </div>

      {ready ? (
        <div className="border-t border-[var(--hairline)] pt-2">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: TONE_COLOR.attention }}
          >
            Ready for you
          </p>
          <p className="mt-1 text-[12px] leading-[1.55] text-[var(--text-secondary)]">
            Everything Forge can judge has passed. A human decides whether this ships.
          </p>
          <dl className="mt-2 space-y-1 text-[12px]">
            {job.diffSummary && (
              <ShipLine
                label="Changed"
                value={`${job.diffSummary.filesChanged} files · +${job.diffSummary.additions} / −${job.diffSummary.deletions}`}
              />
            )}
            {objections.length > 0 && (
              <ShipLine
                label="Debate"
                value={`${highResolved} blocking resolved${noted > 0 ? ` · ${noted} medium noted` : ""}`}
              />
            )}
            {tally.total > 0 && (
              <ShipLine label="Verification" value={`${tally.passed} / ${tally.total} passed`} />
            )}
            <ShipLine
              label="Cost"
              value={`$${job.totalCostUsd.toFixed(2)} · ${elapsed(job.createdAt)}`}
            />
          </dl>
        </div>
      ) : planGate ? (
        <div className="border-t border-[var(--hairline)] pt-2">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: TONE_COLOR.attention }}
          >
            Plan approval
          </p>
          <p className="mt-1 text-[12px] leading-[1.55] text-[var(--text-secondary)]">
            The plan is yours to lock. Nothing is written until you do.
          </p>
        </div>
      ) : (
        <div className="border-t border-[var(--hairline)] pt-2">
          <Waiting
            title={job.prUrl ? "Delivered" : "Not ready"}
            body={
              job.prUrl
                ? "Forge never merges. Review and merge the pull request on GitHub."
                : "Delivery unlocks when the change has been implemented, verified and reviewed."
            }
          />
        </div>
      )}

      {expanded && (
        <div className="mt-3 border-t border-[var(--hairline)] pt-2">
          <Group label="Receipt">
            <dl className="space-y-1 text-[12px]">
              <ShipLine label="Request" value={job.request} />
              <ShipLine label="Mode" value={job.mode} />
              <ShipLine
                label="Objections"
                value={`${objections.length} raised · ${resolved} resolved`}
              />
              <ShipLine
                label="Tokens"
                value={`${job.inputTokens.toLocaleString()} in · ${job.outputTokens.toLocaleString()} out`}
              />
              {job.error && <ShipLine label="Error" value={job.error} />}
            </dl>
          </Group>
        </div>
      )}
    </Panel>
  );
}

function ShipLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-[92px] shrink-0 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="num min-w-0 flex-1 text-[12px] leading-[1.5] text-[var(--text-secondary)]">
        {value}
      </dd>
    </div>
  );
}

/* ── Technical logs ───────────────────────────────────────────────────────
 * Evidence, reachable in one press from the activity strip, and never the
 * thing the operator has to read to know what is happening.
 */

export function LogsStation({ ctx }: { ctx: RoomContext }) {
  return (
    <Panel
      title="Technical logs"
      status={`${ctx.events.length} events`}
      tone="idle"
      subtitle="Raw event stream, for debugging Forge itself"
      focused
      onFocus={() => ctx.setFocus(null)}
    >
      <RawLog events={ctx.events} />
    </Panel>
  );
}

/** The signature every station shares, so the room can hold them in a map. */
export type Station = (props: StationProps) => React.ReactElement;
