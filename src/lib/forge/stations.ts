/**
 * Forge stations — the control room's model of one engineering job.
 *
 * The screen is six fixed stations, not a scrolling report: BUILDER creates,
 * CHALLENGER questions, GSTACK enforces process, IMPLEMENTATION carries the
 * change, VERIFY produces evidence, SHIP holds delivery and the human gate.
 * A station never moves, so the operator builds spatial memory; only its
 * STATE changes.
 *
 * This module is the single place that turns persisted job state (status,
 * objections, checks, events, diff) into what each station is doing right
 * now. Pure — no React, no network — so the words and the state machine can
 * be reasoned about, and every panel reads the same answer.
 *
 * It invents nothing. If the worker has not reported a thing, the station
 * says so; absence is shown as absence.
 */
import {
  VERIFICATION_PROFILES,
  blocksImplementation,
  isTerminal,
  type ForgeCheck,
  type ForgeEvent,
  type ForgeJob,
  type ForgeObjection,
  type ForgeStatus,
  type ObjectionSeverity,
} from "./types";
import { blocker, currentAction, humanState } from "./narrative";

/* ── The six stations ──────────────────────────────────────────────────── */

export const STATION_KEYS = [
  "builder",
  "challenger",
  "gstack",
  "implementation",
  "verify",
  "ship",
] as const;
export type StationKey = (typeof STATION_KEYS)[number];

/** What each station IS, in the operating model. Never re-ordered. */
export const STATION_META: Record<StationKey, { title: string; verb: string; caption: string }> = {
  builder: { title: "Builder", verb: "creates", caption: "Model" },
  challenger: { title: "Challenger", verb: "questions", caption: "Model" },
  gstack: { title: "gstack", verb: "enforces process", caption: "Engineering process" },
  implementation: { title: "Implementation", verb: "carries the change", caption: "Branch" },
  verify: { title: "Verify", verb: "proves it", caption: "Deterministic checks" },
  ship: { title: "Ship", verb: "delivers", caption: "Human authority" },
};

/**
 * Tone is semantic, never decorative. `active` is the one station currently
 * doing work; `attention` and `fail` are the only tones allowed to shout.
 */
export type StationTone = "active" | "attention" | "fail" | "pass" | "idle";

export type StationState = {
  key: StationKey;
  /** Short, upper-cased, right of the panel title. Never a machine status. */
  status: string;
  tone: StationTone;
  /** The subtitle under the title — model id, profile, branch. */
  subtitle: string | null;
  /** Present when the station has nothing of its own to show yet. */
  waiting: { title: string; body: string } | null;
};

/** The single station that owns the job right now, or null when nothing runs. */
export function activeStation(status: ForgeStatus): StationKey | null {
  switch (status) {
    case "ANALYZING":
    case "BUILDER_PLAN":
    case "BUILDER_REVISION":
      return "builder";
    case "CHALLENGER_REVIEW":
    case "REVIEWING":
      return "challenger";
    case "PLAN_LOCKED":
    case "IMPLEMENTING":
      return "implementation";
    case "VERIFYING":
    case "QA":
      return "verify";
    case "READY_FOR_HUMAN":
    case "PR_CREATED":
    case "COMPLETED":
      return "ship";
    default:
      return null;
  }
}

/** A short human phase name — for the rail, where a sentence will not fit. */
export const PHASE_LABEL: Record<ForgeStatus, string> = {
  DRAFT: "Not started",
  ANALYZING: "Reading repository",
  BUILDER_PLAN: "Builder planning",
  CHALLENGER_REVIEW: "Challenger review",
  BUILDER_REVISION: "Builder revision",
  PLAN_LOCKED: "Plan locked",
  IMPLEMENTING: "Implementing",
  VERIFYING: "Verifying",
  REVIEWING: "Diff review",
  QA: "Browser QA",
  READY_FOR_HUMAN: "Human approval",
  PR_CREATED: "Pull request open",
  COMPLETED: "Complete",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/* ── Severity ──────────────────────────────────────────────────────────── */

export const SEVERITY_ORDER: readonly ObjectionSeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;

export function severityCounts(
  objections: readonly ForgeObjection[],
): Record<ObjectionSeverity, number> {
  const counts: Record<ObjectionSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const o of objections) counts[o.severity] += 1;
  return counts;
}

/** The highest round the Challenger has reached. Zero before it has spoken. */
export function debateRound(objections: readonly ForgeObjection[]): number {
  return objections.reduce((max, o) => Math.max(max, o.round), 0);
}

export function checkTally(checks: readonly ForgeCheck[]) {
  return {
    total: checks.length,
    passed: checks.filter((c) => c.status === "passed").length,
    failed: checks.filter((c) => c.status === "failed").length,
    running: checks.filter((c) => c.status === "running").length,
    settled: checks.filter((c) => c.status !== "pending" && c.status !== "running").length,
  };
}

/* ── Station states ────────────────────────────────────────────────────── */

type Input = {
  job: ForgeJob;
  objections: readonly ForgeObjection[];
  checks: readonly ForgeCheck[];
  events: readonly ForgeEvent[];
};

/**
 * Every station, in one pass. Callers read this once and hand each panel its
 * own slice, so two panels can never disagree about who is working.
 */
export function stationStates({
  job,
  objections,
  checks,
  events,
}: Input): Record<StationKey, StationState> {
  const live = activeStation(job.status);
  const done = isTerminal(job.status);
  const tally = checkTally(checks);
  const openBlocking = objections.filter(
    (o) => o.status === "open" && (o.severity === "CRITICAL" || o.severity === "HIGH"),
  ).length;
  const diff = job.diffSummary;
  const profile = job.verificationProfile ? VERIFICATION_PROFILES[job.verificationProfile] : null;
  const gstack = gstackStates(events);
  const reported = gstack.filter((g) => g.state !== "idle");

  const at = (key: StationKey) => live === key && !done;

  return {
    builder: {
      key: "builder",
      subtitle: job.builderModel,
      ...builderStatus(job, at("builder")),
      waiting:
        job.plan || at("builder")
          ? null
          : {
              title: "Waiting to plan",
              body: "The Builder reports a plan once it has read the repository and found the mechanism that already owns this behaviour.",
            },
    },
    challenger: {
      key: "challenger",
      subtitle: job.challengerModel,
      ...challengerStatus(job, at("challenger"), objections, openBlocking),
      waiting:
        objections.length > 0 || at("challenger")
          ? null
          : {
              title: "Waiting for the Builder",
              body:
                job.mode === "FAST"
                  ? "FAST skips the plan debate. The Challenger reviews the diff once implementation finishes."
                  : "The Challenger attacks the plan as soon as the Builder submits one.",
            },
    },
    gstack: {
      key: "gstack",
      subtitle: "Engineering process",
      status: gstackStatus(gstack),
      tone: gstack.some((g) => g.state === "failed")
        ? "fail"
        : gstack.some((g) => g.state === "running")
          ? "active"
          : reported.length > 0
            ? "pass"
            : "idle",
      waiting:
        reported.length > 0
          ? null
          : {
              title: "No department has reported",
              body: "gstack runs inside the worker. Ask for an operation and its output is recorded against this job.",
            },
    },
    implementation: {
      key: "implementation",
      subtitle: job.branchName,
      ...implementationStatus(job, at("implementation"), diff),
      waiting: diff
        ? null
        : {
            title: job.planLockedAt ? "Implementation queued" : "Plan not locked",
            body: job.planLockedAt
              ? "The plan is locked. Changed files appear here as the Builder writes them."
              : "Nothing is written until the plan survives review and a human locks it.",
          },
    },
    verify: {
      key: "verify",
      subtitle: profile ? `${profile.label} profile` : "No profile selected",
      ...verifyStatus(job, at("verify"), tally),
      waiting:
        checks.length > 0
          ? null
          : {
              title: "Not started",
              body: profile
                ? `Verification begins after implementation. ${profile.checks.length} checks are queued from the ${profile.label} profile.`
                : "Verification begins after implementation is complete.",
            },
    },
    ship: {
      key: "ship",
      subtitle: job.branchName,
      ...shipStatus(job, objections),
      waiting: null,
    },
  };
}

type Partial2 = { status: string; tone: StationTone };

function builderStatus(job: ForgeJob, live: boolean): Partial2 {
  if (live) {
    switch (job.status) {
      case "ANALYZING":
        return { status: "Reading repo", tone: "active" };
      case "BUILDER_PLAN":
        return { status: "Planning", tone: "active" };
      case "BUILDER_REVISION":
        return { status: "Revising plan", tone: "active" };
      case "IMPLEMENTING":
        return { status: "Implementing", tone: "active" };
      default:
        return { status: "Active", tone: "active" };
    }
  }
  if (job.status === "FAILED") return { status: "Stopped", tone: "fail" };
  if (job.plan) return { status: "Plan delivered", tone: "idle" };
  return { status: "Waiting", tone: "idle" };
}

function challengerStatus(
  job: ForgeJob,
  live: boolean,
  objections: readonly ForgeObjection[],
  openBlocking: number,
): Partial2 {
  if (live) {
    return {
      status: job.status === "REVIEWING" ? "Reviewing diff" : "Reviewing plan",
      tone: "active",
    };
  }
  if (openBlocking > 0 && blocksImplementation(job.mode, objections)) {
    return { status: `${openBlocking} open`, tone: "attention" };
  }
  if (objections.some((o) => o.status === "maintained")) {
    return { status: "Maintained", tone: "attention" };
  }
  if (objections.length > 0) return { status: "Cleared", tone: "pass" };
  return { status: "Waiting", tone: "idle" };
}

function implementationStatus(
  job: ForgeJob,
  live: boolean,
  diff: ForgeJob["diffSummary"],
): Partial2 {
  if (live && job.status === "IMPLEMENTING") return { status: "Writing", tone: "active" };
  if (diff) {
    return {
      status: `${diff.filesChanged} ${diff.filesChanged === 1 ? "file" : "files"}`,
      tone: "idle",
    };
  }
  if (job.planLockedAt) return { status: "Queued", tone: "idle" };
  return { status: "Not started", tone: "idle" };
}

function verifyStatus(
  job: ForgeJob,
  live: boolean,
  tally: ReturnType<typeof checkTally>,
): Partial2 {
  if (tally.failed > 0) return { status: `${tally.failed} failed`, tone: "fail" };
  if (job.status === "QA") return { status: "Browser QA", tone: "active" };
  if (tally.total === 0) return { status: "Not started", tone: "idle" };
  if (tally.settled === tally.total) {
    return { status: `${tally.passed} / ${tally.total} passed`, tone: "pass" };
  }
  return { status: `${tally.settled} / ${tally.total}`, tone: live ? "active" : "idle" };
}

function shipStatus(job: ForgeJob, objections: readonly ForgeObjection[]): Partial2 {
  switch (job.status) {
    case "PR_CREATED":
      return { status: "PR open", tone: "pass" };
    case "COMPLETED":
      return { status: "Complete", tone: "pass" };
    case "READY_FOR_HUMAN":
      return { status: "Ready for you", tone: "attention" };
    case "CANCELLED":
      return { status: "Cancelled", tone: "idle" };
    case "FAILED":
      return { status: "Stopped", tone: "fail" };
    default:
      break;
  }
  if (planAwaitsHuman(job) && !blocksImplementation(job.mode, objections)) {
    return { status: "Plan approval", tone: "attention" };
  }
  return { status: "Not ready", tone: "idle" };
}

/** The plan gate is a human one; these are the states where it can be taken. */
export function planAwaitsHuman(job: Pick<ForgeJob, "status">): boolean {
  return (
    job.status === "BUILDER_PLAN" ||
    job.status === "CHALLENGER_REVIEW" ||
    job.status === "BUILDER_REVISION"
  );
}

/* ── The orchestration sentence ────────────────────────────────────────────
 * The most important four lines on the screen. A person who has never seen
 * this job reads NOW / WHY / NEXT / NEEDS YOU and knows where it stands.
 */

export type Orchestration = {
  now: string;
  why: string;
  next: string | null;
  needsYou: boolean;
  /** What the human is being asked for, when they are being asked. */
  ask: string | null;
};

export function orchestration(
  job: ForgeJob,
  objections: readonly ForgeObjection[],
  checks: readonly ForgeCheck[],
): Orchestration {
  const action = currentAction(job);
  const stop = blocker(job, objections, checks);
  const state = humanState(job, objections, checks);
  const needsYou = state === "needs-you" || state === "ready";

  return {
    now: action.headline,
    why: stop ? stop.body : action.why,
    next: action.next,
    needsYou,
    ask: !needsYou
      ? null
      : stop?.kind === "objections"
        ? "Resolve the blocking objections, or approve the plan once they are answered."
        : stop?.kind === "check"
          ? "A check failed. Read the failure and decide whether Forge should keep repairing."
          : stop?.kind === "ready"
            ? "Review the change and open the pull request."
            : job.status === "DRAFT"
              ? "No worker has picked this job up."
              : "Forge is waiting on a decision.",
  };
}

/* ── Errors ────────────────────────────────────────────────────────────────
 * An error is only useful if it says what failed, why, what Forge is doing
 * about it, and whether the human has to move.
 */

export type Fault = {
  title: string;
  subject: string | null;
  body: string;
  remedy: string;
  needsYou: boolean;
};

export function fault(job: ForgeJob, checks: readonly ForgeCheck[]): Fault | null {
  if (job.status === "FAILED") {
    return {
      title: "Job stopped",
      subject: null,
      body: job.error ?? "Forge stopped rather than ship a change it could not prove.",
      remedy: "Forge will not continue on its own.",
      needsYou: true,
    };
  }
  const failed = checks.find((c) => c.status === "failed");
  if (!failed) return null;
  const repairing = job.status === "IMPLEMENTING" || job.status === "VERIFYING";
  return {
    title: "Verification failed",
    subject: failed.name,
    body: failed.failureSummary ?? `${failed.name} did not pass.`,
    remedy: repairing ? "The Builder is attempting a repair." : "Forge has stopped at the failure.",
    needsYou: !repairing,
  };
}

/* ── gstack ────────────────────────────────────────────────────────────────
 * gstack is the process layer, not a third personality. Its state is read from
 * the job's own events — never assumed, never optimistic.
 */

export type GstackState = "passed" | "failed" | "running" | "requested" | "idle";

export const GSTACK_BLURB: Record<string, string> = {
  "office-hours": "Product intent clarified before a plan exists.",
  "plan review": "The plan critiqued before any code is written.",
  "engineering review": "Implementation read for correctness and structure.",
  review: "General pass over the change as a whole.",
  investigate: "Root-cause dig when something failed or looks wrong.",
  qa: "Behaviour exercised against the running app.",
  cso: "Security and money-risk gate.",
  ship: "Final readiness call before a pull request.",
};

export const GSTACK_LABEL: Record<GstackState, string> = {
  passed: "Passed",
  failed: "Failed",
  running: "Running",
  requested: "Requested",
  idle: "Not run",
};

export type GstackReport = {
  operation: string;
  state: GstackState;
  /** Every event this operation produced, oldest first — the panel's output. */
  events: ForgeEvent[];
  last: ForgeEvent | null;
};

export function eventOperation(e: ForgeEvent): string | null {
  const d = e.detail;
  const op = d && typeof d === "object" && !Array.isArray(d) ? d["operation"] : null;
  return typeof op === "string" ? op : null;
}

const GSTACK_OPS = Object.keys(GSTACK_BLURB);

export function gstackStates(events: readonly ForgeEvent[]): GstackReport[] {
  return GSTACK_OPS.map((operation) => {
    const mine = events.filter((e) => {
      const tagged = eventOperation(e);
      if (tagged) return tagged === operation;
      const hay = `${e.kind} ${e.message}`.toLowerCase();
      return hay.includes(operation.toLowerCase());
    });
    const last = mine[mine.length - 1] ?? null;
    let state: GstackState = "idle";
    if (last) {
      const kind = last.kind.toLowerCase();
      if (last.level === "error" || kind.includes("failed")) state = "failed";
      else if (last.level === "success" || kind.includes("done") || kind.includes("passed"))
        state = "passed";
      else if (kind.includes("start") || kind.includes("running")) state = "running";
      else state = "requested";
    }
    return { operation, state, events: mine, last };
  });
}

function gstackStatus(reports: readonly GstackReport[]): string {
  const failed = reports.filter((r) => r.state === "failed").length;
  if (failed > 0) return `${failed} failed`;
  const running = reports.find((r) => r.state === "running");
  if (running) return running.operation;
  const reported = reports.filter((r) => r.state !== "idle").length;
  return reported === 0 ? "Not run" : `${reported} of ${reports.length}`;
}

/* ── Activity ──────────────────────────────────────────────────────────────
 * The live strip is a story, not a log. Transport chatter, tool invocations
 * and raw output are evidence and belong behind the technical view.
 */

const TECHNICAL_KIND =
  /^(http|https|tool|stdout|stderr|raw|trace|debug|token|usage|request|response|heartbeat|poll)\b/i;

export function isSemanticEvent(e: ForgeEvent): boolean {
  return !TECHNICAL_KIND.test(e.kind);
}

export function semanticEvents(events: readonly ForgeEvent[]): ForgeEvent[] {
  return events.filter(isSemanticEvent);
}

/** Events a station is responsible for, newest last. Used inside the panels. */
export function eventsForRole(
  events: readonly ForgeEvent[],
  role: ForgeEvent["role"],
): ForgeEvent[] {
  return semanticEvents(events).filter((e) => e.role === role);
}
