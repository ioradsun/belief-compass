/**
 * Forge — shared derivations for the control room.
 *
 * The pipeline model (the six stages the operator reads) lives in
 * `pipeline.ts`. This module holds what both that model and the panels draw
 * from: the semantic tone vocabulary, severity and check tallies, the gstack
 * process lens, the orchestration sentence, and the fault. Pure — no React, no
 * network — so the words and the state machine can be reasoned about, and every
 * panel reads the same answer.
 *
 * It invents nothing. If the worker has not reported a thing, absence is shown
 * as absence.
 */
import {
  type ForgeCheck,
  type ForgeEvent,
  type ForgeJob,
  type ForgeObjection,
  type ForgeStatus,
  type ObjectionSeverity,
} from "./types";
import { blocker, currentAction, humanState } from "./narrative";

/* ── Tone ──────────────────────────────────────────────────────────────────
 * Tone is semantic, never decorative. `active` is the one place currently
 * doing work; `attention` and `fail` are the only tones allowed to shout.
 */
export type StationTone = "active" | "attention" | "fail" | "pass" | "idle";

/** A short human phase name — for the rail, where a sentence will not fit. */
export const PHASE_LABEL: Record<ForgeStatus, string> = {
  DRAFT: "Not started",
  ANALYZING: "Reading repository",
  BUILDER_PLAN: "Planning",
  CHALLENGER_REVIEW: "Plan review",
  BUILDER_REVISION: "Plan revision",
  PLAN_LOCKED: "Plan locked",
  IMPLEMENTING: "Implementing",
  VERIFYING: "Verifying",
  REVIEWING: "Engineering review",
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

/** The highest round the reviewer has reached. Zero before it has spoken. */
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
    remedy: repairing
      ? "The engineer is attempting a repair."
      : "Forge has stopped at the failure.",
    needsYou: !repairing,
  };
}

/* ── gstack ────────────────────────────────────────────────────────────────
 * gstack is the process layer, not a stage. Its state is read from the job's
 * own events — never assumed, never optimistic — and shown on the stage whose
 * operation it is.
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

/** Events a role is responsible for, newest last. Used inside the panels. */
export function eventsForRole(
  events: readonly ForgeEvent[],
  role: ForgeEvent["role"],
): ForgeEvent[] {
  return semanticEvents(events).filter((e) => e.role === role);
}
