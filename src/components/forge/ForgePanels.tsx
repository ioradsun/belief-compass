/**
 * Forge display primitives — mission control, not AI chat.
 *
 * The rule every component here obeys: never make the operator reconstruct the
 * story from logs. Machine activity is converted into what happened, why it
 * happened, what was decided and what happens next. Raw logs still exist, but
 * they are evidence sitting behind a disclosure, not the interface.
 */
import { useState } from "react";
import type {
  ForgeCheck,
  ForgeEvent,
  ForgeJob,
  ForgeModelRun,
  ForgeObjection,
  ForgePhase,
  ObjectionSeverity,
} from "@/lib/forge/types";
import { MODEL_REGISTRY } from "@/lib/forge/models";
import { VERIFICATION_PROFILES } from "@/lib/forge/types";
import {
  HUMAN_STATE_GLYPH,
  HUMAN_STATE_LABEL,
  elapsed,
  jobTitle,
  type Blocker,
  type CurrentAction,
  type HumanState,
} from "@/lib/forge/narrative";

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-[var(--text-muted)]">{children}</p>;
}

function time(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ── Why? ─────────────────────────────────────────────────────────────────
 * A system that explains its own choices stops being magical. Every selection
 * Forge makes on the operator's behalf carries one of these.
 */

export function Why({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-[var(--text-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)]"
      >
        {label}
      </button>
      {open && (
        <span className="mt-1 block max-w-[60ch] text-[12px] leading-[1.6] text-[var(--text-muted)]">
          {children}
        </span>
      )}
    </span>
  );
}

/* ── Jobs inbox ───────────────────────────────────────────────────────── */

const STATE_TONE: Record<HumanState, string> = {
  running: "text-[var(--text)]",
  "needs-you": "text-[var(--warn,#F5A623)]",
  failed: "text-[var(--loss)]",
  ready: "text-[var(--text)]",
  completed: "text-[var(--text-muted)]",
};

export function JobRow({
  job,
  state,
  detail,
  active,
  onOpen,
}: {
  job: ForgeJob;
  state: HumanState;
  detail: string;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full items-baseline gap-2 rounded px-2 py-2 text-left ${
          active ? "bg-[var(--surface)]" : "hover:bg-[var(--surface)]"
        }`}
      >
        <span className={`w-[12px] shrink-0 text-[12px] ${STATE_TONE[state]}`}>
          {HUMAN_STATE_GLYPH[state]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-[1.4]">{jobTitle(job.request)}</span>
          <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">
            {detail}
          </span>
        </span>
      </button>
    </li>
  );
}

/* ── The dominant answer: what is happening right now ─────────────────── */

export function CurrentPhaseCard({
  action,
  progress,
  phaseLabel,
}: {
  action: CurrentAction;
  progress: { index: number; total: number };
  phaseLabel: string | null;
}) {
  const pct = progress.total > 0 ? Math.round((progress.index / progress.total) * 100) : 0;
  return (
    <div className="rounded-md bg-[var(--surface)] p-4">
      {phaseLabel && (
        <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {progress.index}. {phaseLabel}
        </p>
      )}
      <p className="mt-1 text-[20px] font-semibold leading-[1.25] tracking-[-0.01em]">
        {action.headline}
      </p>
      <p className="mt-2 max-w-[64ch] text-[13px] leading-[1.6] text-[var(--text-muted)]">
        {action.why}
      </p>
      <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-[var(--border)]">
        <div className="h-full rounded-full bg-[var(--text)]" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-[12px] text-[var(--text-muted)]">
        <span>
          {progress.index} of {progress.total} phases
        </span>
        {action.next && <span>Next: {action.next}</span>}
      </div>
    </div>
  );
}

/* ── Blockers: impossible to miss ─────────────────────────────────────── */

export function BlockerBanner({
  blocker,
  children,
}: {
  blocker: Blocker;
  children?: React.ReactNode;
}) {
  const alarming = blocker.kind === "check" || blocker.kind === "failed";
  return (
    <div
      className={`rounded-md border p-4 ${
        alarming
          ? "border-[var(--loss)] bg-[var(--surface)]"
          : "border-[var(--border-strong)] bg-[var(--surface)]"
      }`}
    >
      <p
        className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${
          alarming ? "text-[var(--loss)]" : "text-[var(--text)]"
        }`}
      >
        {blocker.title}
      </p>
      <p className="mt-1 max-w-[64ch] text-[13px] leading-[1.6]">{blocker.body}</p>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/* ── Pipeline: the whole journey, always ──────────────────────────────── */

export function PipelineRail({
  phases,
  status,
  currentPhase,
  selected,
  onSelect,
}: {
  phases: readonly ForgePhase[];
  status: ForgeJob["status"];
  currentPhase: string | null;
  selected?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const liveIndex = phases.findIndex(
    (p) => p.key === currentPhase || p.statuses.includes(status),
  );
  return (
    <ol className="space-y-0.5">
      {phases.map((p, i) => {
        const live = i === liveIndex;
        const done = liveIndex >= 0 && i < liveIndex;
        const glyph = done ? "✓" : live ? "●" : "○";
        const isSelected = selected === p.key;
        return (
          <li key={p.key}>
            <button
              type="button"
              onClick={() => onSelect?.(isSelected ? null : p.key)}
              disabled={!onSelect}
              className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-[12px] ${
                isSelected ? "bg-[var(--surface)]" : onSelect ? "hover:bg-[var(--surface)]" : ""
              }`}
            >
              <span className="w-[12px] shrink-0">{glyph}</span>
              <span
                className={
                  live
                    ? "font-medium text-[var(--text)]"
                    : done
                      ? "text-[var(--text)]"
                      : "text-[var(--text-muted)]"
                }
              >
                {p.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Compact horizontal pipeline, for the pre-flight view where nothing is live. */
export function Pipeline({
  phases,
  status,
  currentPhase,
}: {
  phases: readonly ForgePhase[];
  status: ForgeJob["status"];
  currentPhase: string | null;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
      {phases.map((p, i) => {
        const live = currentPhase === p.key || p.statuses.includes(status);
        return (
          <li key={p.key} className="flex items-center gap-2">
            <span
              className={
                live
                  ? "rounded border border-[var(--border-strong)] px-1.5 py-0.5 font-medium text-[var(--text)]"
                  : "px-1.5 py-0.5 text-[var(--text-muted)]"
              }
            >
              {p.label}
            </span>
            {i < phases.length - 1 && <span className="text-[var(--text-muted)]">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* ── Activity: semantic first, raw underneath ─────────────────────────── */

const GLYPH: Record<ForgeEvent["level"], string> = {
  success: "✓",
  info: "●",
  warn: "⚠",
  error: "✕",
};

export function Activity({ events }: { events: ForgeEvent[] }) {
  if (events.length === 0) return <Empty>No activity yet.</Empty>;
  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <ActivityRow key={e.id} event={e} />
      ))}
    </ul>
  );
}

function ActivityRow({ event }: { event: ForgeEvent }) {
  const [open, setOpen] = useState(false);
  const hasDetail = event.detail != null;
  return (
    <li className="flex gap-3">
      <span className="w-[64px] shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
        {time(event.createdAt)}
      </span>
      <span className="w-[14px] shrink-0 text-[12px]">{GLYPH[event.level]}</span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[13px] leading-[1.5] ${
            event.level === "error" ? "text-[var(--loss)]" : ""
          }`}
        >
          {event.role && event.role !== "system" && (
            <span className="mr-2 text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
              {event.role}
            </span>
          )}
          {event.message}
        </span>
        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 text-[11px] text-[var(--text-muted)] underline decoration-dotted underline-offset-2"
          >
            {open ? "Hide detail" : "Detail"}
          </button>
        )}
        {open && hasDetail && (
          <pre className="mt-1 overflow-x-auto rounded bg-[var(--surface)] p-2 font-mono text-[11px] leading-[1.5] text-[var(--text-muted)]">
            {JSON.stringify(event.detail, null, 2)}
          </pre>
        )}
      </span>
    </li>
  );
}

/** The debugging view of Forge itself. Timestamps, kinds, payloads, nothing kind. */
export function RawLog({ events }: { events: ForgeEvent[] }) {
  if (events.length === 0) return <Empty>No events recorded.</Empty>;
  return (
    <pre className="overflow-x-auto rounded bg-[var(--surface)] p-3 font-mono text-[11px] leading-[1.6] text-[var(--text-muted)]">
      {events
        .map(
          (e) =>
            `${e.createdAt} [${e.level}] ${e.role ?? "system"} ${e.kind} — ${e.message}` +
            (e.detail == null ? "" : `\n  ${JSON.stringify(e.detail)}`),
        )
        .join("\n")}
    </pre>
  );
}

/* ── Debate as a decision record ──────────────────────────────────────── */

const SEVERITY_TONE: Record<ObjectionSeverity, string> = {
  CRITICAL: "text-[var(--loss)]",
  HIGH: "text-[var(--loss)]",
  MEDIUM: "text-[var(--text)]",
  LOW: "text-[var(--text-muted)]",
};

export function Objections({ objections }: { objections: ForgeObjection[] }) {
  if (objections.length === 0) return <Empty>No objections raised.</Empty>;
  return (
    <ul className="space-y-4">
      {objections.map((o) => (
        <li key={o.id} className="rounded-md bg-[var(--surface)] p-4">
          <div className="flex items-baseline gap-2 text-[11px] uppercase tracking-[0.12em]">
            <span className="text-[var(--text-muted)]">Challenger</span>
            <span className={SEVERITY_TONE[o.severity]}>{o.severity}</span>
            <span className="ml-auto text-[var(--text-muted)]">round {o.round}</span>
          </div>
          <p className="mt-1 text-[14px] font-medium leading-[1.45]">{o.title}</p>
          {o.body && (
            <p className="mt-1 max-w-[64ch] text-[13px] leading-[1.6] text-[var(--text-muted)]">
              {o.body}
            </p>
          )}
          {o.resolution && (
            <div className="mt-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Builder response
              </p>
              <p className="mt-1 max-w-[64ch] text-[13px] leading-[1.6]">{o.resolution}</p>
            </div>
          )}
          <p
            className={`mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] ${
              o.status === "resolved"
                ? "text-[var(--text)]"
                : o.status === "open"
                  ? SEVERITY_TONE[o.severity]
                  : "text-[var(--text-muted)]"
            }`}
          >
            {o.status === "resolved"
              ? "✓ Resolved"
              : o.status === "open"
                ? "Open"
                : o.status === "waived"
                  ? "Waived"
                  : "Maintained"}
          </p>
        </li>
      ))}
    </ul>
  );
}

/* ── Checks as evidence ───────────────────────────────────────────────── */

const CHECK_GLYPH: Record<ForgeCheck["status"], string> = {
  pending: "·",
  running: "●",
  passed: "✓",
  failed: "✕",
  skipped: "–",
};

export function Checks({
  checks,
  profileKey,
}: {
  checks: ForgeCheck[];
  profileKey: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const profile = profileKey
    ? VERIFICATION_PROFILES[profileKey as keyof typeof VERIFICATION_PROFILES]
    : null;

  // Before the worker has reported anything, the profile itself is the honest
  // answer to "what will be run" — shown as pending, never as passed.
  const rows: {
    key: string;
    name: string;
    command: string | null;
    status: ForgeCheck["status"];
    duration: number | null;
    note: string | null;
  }[] =
    checks.length > 0
      ? checks.map((c) => ({
          key: c.id,
          name: c.name,
          command: c.command,
          status: c.status,
          duration: c.durationMs,
          note: c.failureSummary ?? c.outputSummary,
        }))
      : (profile?.checks ?? []).map((name) => ({
          key: name,
          name,
          command: `bun run ${name}`,
          status: "pending" as const,
          duration: null,
          note: null,
        }));

  if (rows.length === 0) return <Empty>No verification profile selected.</Empty>;

  const passed = rows.filter((r) => r.status === "passed").length;
  const ran = rows.filter((r) => r.status !== "pending" && r.status !== "skipped").length;

  return (
    <div>
      {profile && (
        <p className="mb-3 text-[12px] text-[var(--text-muted)]">
          {profile.label} profile — {profile.description}
        </p>
      )}
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => setOpenId(openId === r.key ? null : r.key)}
              className="flex w-full items-baseline gap-3 py-2 text-left"
            >
              <span className="w-[14px] shrink-0 text-[12px]">{CHECK_GLYPH[r.status]}</span>
              <span
                className={`min-w-0 flex-1 truncate text-[13px] ${
                  r.status === "failed" ? "text-[var(--loss)]" : ""
                }`}
              >
                {r.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                {r.duration != null ? `${(r.duration / 1000).toFixed(1)}s` : r.status}
              </span>
            </button>
            {openId === r.key && (
              <div className="pb-3 pl-[26px] text-[12px] leading-[1.6] text-[var(--text-muted)]">
                <p>Status: {r.status}</p>
                {r.command && <p className="font-mono">{r.command}</p>}
                {r.note && <p className="mt-1 text-[var(--text)]">{r.note}</p>}
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-[var(--text-muted)]">
        {ran > 0 ? `${passed} / ${rows.length} passed` : `${rows.length} checks queued`}
      </p>
      {profile?.gates?.length ? (
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          Additional gates: {profile.gates.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

/* ── Changes ──────────────────────────────────────────────────────────── */

export function Changes({ job }: { job: ForgeJob }) {
  const d = job.diffSummary;
  if (!d) return <Empty>No diff reported yet.</Empty>;
  return (
    <div>
      <p className="text-[14px]">
        {d.filesChanged} {d.filesChanged === 1 ? "file" : "files"} changed{" "}
        <span className="font-mono text-[13px] text-[var(--text-muted)]">
          +{d.additions} / −{d.deletions}
        </span>
      </p>
      {d.files?.length ? (
        <ul className="mt-3 divide-y divide-[var(--border)] font-mono text-[12px]">
          {d.files.map((f) => (
            <li key={f.path} className="flex items-baseline gap-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{f.path}</span>
              <span className="shrink-0 text-[var(--text-muted)]">
                +{f.additions} / −{f.deletions}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {job.branchName && (
        <p className="mt-3 font-mono text-[12px] text-[var(--text-muted)]">{job.branchName}</p>
      )}
    </div>
  );
}

/* ── Models and cost: useful, secondary ───────────────────────────────── */

export function CostLedger({ runs, job }: { runs: ForgeModelRun[]; job: ForgeJob }) {
  const roles = ["builder", "challenger", "escalation"] as const;
  const money = (n: number) => `$${n.toFixed(4)}`;
  return (
    <table className="w-full text-[12px]">
      <thead className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
        <tr>
          <th className="py-1 text-left font-medium">Role</th>
          <th className="py-1 text-left font-medium">Model</th>
          <th className="py-1 text-right font-medium">In</th>
          <th className="py-1 text-right font-medium">Out</th>
          <th className="py-1 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {roles.map((role) => {
          const mine = runs.filter((r) => r.role === role);
          const cfg = MODEL_REGISTRY[role];
          return (
            <tr key={role} className="border-t border-[var(--border)]">
              <td className="py-1 capitalize">{role}</td>
              <td className="py-1 font-mono text-[var(--text-muted)]">
                {cfg.modelId}
                {role === "escalation" && mine.length === 0 ? " · not used" : ""}
              </td>
              <td className="py-1 text-right">{mine.reduce((s, r) => s + r.inputTokens, 0)}</td>
              <td className="py-1 text-right">{mine.reduce((s, r) => s + r.outputTokens, 0)}</td>
              <td className="py-1 text-right">{money(mine.reduce((s, r) => s + r.costUsd, 0))}</td>
            </tr>
          );
        })}
        <tr className="border-t border-[var(--border-strong)] font-medium">
          <td className="py-1" colSpan={2}>
            Total
          </td>
          <td className="py-1 text-right">{job.inputTokens}</td>
          <td className="py-1 text-right">{job.outputTokens}</td>
          <td className="py-1 text-right">{money(job.totalCostUsd)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/* ── Receipt ──────────────────────────────────────────────────────────── */

export function Receipt({
  job,
  objections,
  checks,
}: {
  job: ForgeJob;
  objections: ForgeObjection[];
  checks: ForgeCheck[];
}) {
  const d = job.diffSummary;
  const passed = checks.filter((c) => c.status === "passed").length;
  const resolved = objections.filter((o) => o.status === "resolved").length;
  const line = (label: string, value: React.ReactNode) => (
    <div className="border-t border-[var(--border)] py-2">
      <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</p>
      <div className="mt-0.5 text-[13px] leading-[1.6]">{value}</div>
    </div>
  );
  return (
    <div className="rounded-md bg-[var(--surface)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {job.status === "FAILED"
          ? "Job failed"
          : job.status === "CANCELLED"
            ? "Job cancelled"
            : "Job complete"}
      </p>
      <p className="mt-1 text-[18px] font-semibold leading-[1.3]">{jobTitle(job.request)}</p>
      <div className="mt-3">
        {job.plan?.summary ? line("Outcome", job.plan.summary) : null}
        {d
          ? line(
              "Changed",
              `${d.filesChanged} files · +${d.additions} / −${d.deletions}`,
            )
          : null}
        {objections.length > 0
          ? line("Debate", `${objections.length} objections · ${resolved} resolved`)
          : null}
        {checks.length > 0 ? line("Verification", `${passed} / ${checks.length} passed`) : null}
        {line("Cost", `$${job.totalCostUsd.toFixed(4)} · ${elapsed(job.createdAt, job.updatedAt)}`)}
        {job.prUrl
          ? line(
              "Pull request",
              <a href={job.prUrl} target="_blank" rel="noreferrer" className="underline">
                {job.prUrl}
              </a>,
            )
          : null}
        {job.error ? line("Error", <span className="text-[var(--loss)]">{job.error}</span>) : null}
      </div>
    </div>
  );
}

export function StatePill({ state }: { state: HumanState }) {
  return (
    <span className={`text-[12px] font-medium ${STATE_TONE[state]}`}>
      {HUMAN_STATE_GLYPH[state]} {HUMAN_STATE_LABEL[state]}
    </span>
  );
}

/* ── gstack board ──────────────────────────────────────────────────────────
 * "Is gstack even being used?" was unanswerable from this screen, because the
 * methodology runs inside the worker and only leaked into the raw log. The
 * board names every department once and reads the job's own events for proof:
 * requested, running, passed, failed, or never run. No department is inferred
 * from optimism — absence is shown as absence.
 */
const GSTACK_BLURB: Record<string, string> = {
  "office-hours": "Open questions put to the stack before a plan exists.",
  "plan review": "The plan itself is critiqued before any code is written.",
  "engineering review": "Implementation read for correctness and structure.",
  review: "General pass over the change as a whole.",
  investigate: "Root-cause dig when something failed or looks wrong.",
  qa: "Behaviour exercised against the running app.",
  cso: "Security and money-risk gate.",
  ship: "Final readiness call before a pull request.",
};

type GstackState = "passed" | "failed" | "running" | "requested" | "idle";

const GSTACK_TONE: Record<GstackState, string> = {
  passed: "text-[var(--gain)]",
  failed: "text-[var(--loss)]",
  running: "text-[var(--notice)]",
  requested: "text-[var(--text-secondary)]",
  idle: "text-[var(--text-muted)]",
};
const GSTACK_LABEL: Record<GstackState, string> = {
  passed: "Passed",
  failed: "Failed",
  running: "Running",
  requested: "Requested",
  idle: "Not run",
};

function eventOperation(e: ForgeEvent): string | null {
  const d = e.detail;
  const op = d && typeof d === "object" && !Array.isArray(d) ? d["operation"] : null;
  return typeof op === "string" ? op : null;
}

function stateFor(op: string, events: ForgeEvent[]) {
  const mine = events.filter((e) => {
    const tagged = eventOperation(e);
    if (tagged) return tagged === op;
    const hay = `${e.kind} ${e.message}`.toLowerCase();
    return hay.includes(op.toLowerCase());
  });
  const last = mine[mine.length - 1] ?? null;
  let state: GstackState = "idle";
  if (last) {
    const k = `${last.kind}`.toLowerCase();
    if (last.level === "error" || k.includes("failed")) state = "failed";
    else if (last.level === "success" || k.includes("done") || k.includes("passed"))
      state = "passed";
    else if (k.includes("start") || k.includes("running")) state = "running";
    else state = "requested";
  }
  return { state, last, count: mine.length };
}

export function GstackBoard({
  operations,
  events,
  onRun,
  busy,
  disabled,
}: {
  operations: readonly string[];
  events: ForgeEvent[];
  onRun: (operation: string) => void;
  busy: string | null;
  disabled: boolean;
}) {
  const anyRan = operations.some((op) => stateFor(op, events).state !== "idle");
  return (
    <div>
      <p className="mb-3 text-[12px] text-[var(--text-muted)]">
        {anyRan
          ? "Departments that have reported on this job. Each state is read from the job's own events."
          : "No gstack department has reported on this job yet — the pipeline ran without one."}
      </p>
      <ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
        {operations.map((op) => {
          const { state, last, count } = stateFor(op, events);
          return (
            <li key={op} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-3">
              <span className="min-w-[150px] text-[13px] font-medium capitalize">{op}</span>
              <span className={`text-[12px] font-medium ${GSTACK_TONE[state]}`}>
                {GSTACK_LABEL[state]}
              </span>
              <span className="min-w-0 flex-1 text-[12px] text-[var(--text-muted)]">
                {last ? last.message : GSTACK_BLURB[op]}
                {count > 1 ? ` · ${count} events` : ""}
              </span>
              <button
                type="button"
                disabled={disabled || busy === op}
                onClick={() => onRun(op)}
                className="rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-[12px] disabled:opacity-40"
              >
                {busy === op ? "Sending…" : state === "idle" ? "Run" : "Run again"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
