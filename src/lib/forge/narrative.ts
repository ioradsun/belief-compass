/**
 * Forge narrative — machine state translated into the story a human reads.
 *
 * The state machine in `types.ts` keeps fifteen statuses because the pipeline
 * genuinely has fifteen positions. A person opening Forge cold does not need
 * fifteen; they need to know whether the thing is running, blocked, waiting on
 * them, or finished. So this module is the single translation layer: statuses
 * collapse into five human states, and every screen answers the same four
 * questions — what is happening, why, what happened before, what next.
 *
 * Pure by design: no network, no React. The words are testable.
 */
import {
  MODE_PIPELINE,
  VERIFICATION_PROFILES,
  blocksImplementation,
  isTerminal,
  type ForgeCheck,
  type ForgeJob,
  type ForgeMode,
  type ForgeObjection,
  type ForgeStatus,
} from "./types";

/* ── Human state ───────────────────────────────────────────────────────── */

export type HumanState = "running" | "needs-you" | "failed" | "ready" | "completed";

export const HUMAN_STATE_LABEL: Record<HumanState, string> = {
  running: "Running",
  "needs-you": "Needs you",
  failed: "Failed",
  ready: "Ready",
  completed: "Completed",
};

export const HUMAN_STATE_GLYPH: Record<HumanState, string> = {
  running: "●",
  "needs-you": "!",
  failed: "×",
  ready: "✓",
  completed: "✓",
};

/** The states a person filters an inbox by, in the order they care about them. */
export const HUMAN_STATES: readonly HumanState[] = [
  "running",
  "needs-you",
  "ready",
  "failed",
  "completed",
] as const;

export function humanState(
  job: Pick<ForgeJob, "status" | "mode">,
  objections: readonly ForgeObjection[] = [],
  checks: readonly ForgeCheck[] = [],
): HumanState {
  if (job.status === "FAILED") return "failed";
  if (job.status === "CANCELLED") return "completed";
  if (job.status === "COMPLETED" || job.status === "PR_CREATED") return "completed";
  if (job.status === "READY_FOR_HUMAN") return "ready";
  if (checks.some((c) => c.status === "failed")) return "needs-you";
  if (blocksImplementation(job.mode, objections)) return "needs-you";
  if (job.status === "DRAFT") return "needs-you";
  return "running";
}

/* ── What is happening, and why ────────────────────────────────────────── */

export type CurrentAction = {
  /** One sentence in the present tense. The most dominant line on the page. */
  headline: string;
  /** Why that is the right thing to be doing right now. */
  why: string;
  /** The step that follows, so nothing feels open-ended. */
  next: string | null;
};

const ACTION: Record<ForgeStatus, CurrentAction> = {
  DRAFT: {
    headline: "Waiting to start",
    why: "The job is recorded but no worker has picked it up yet.",
    next: "Repository analysis",
  },
  ANALYZING: {
    headline: "Builder is reading the repository",
    why: "Before proposing anything it looks for the mechanism that already does this, so the change extends one source of truth instead of creating a second.",
    next: "Builder writes a plan",
  },
  BUILDER_PLAN: {
    headline: "Builder is writing the plan",
    why: "The smallest complete implementation, named as steps and acceptance criteria, before a line is written.",
    next: "Challenger reviews the plan",
  },
  CHALLENGER_REVIEW: {
    headline: "Challenger is reviewing the plan",
    why: "Looking for duplicated state, regressions in the feed and identity systems, and simpler ways to reach the same behaviour.",
    next: "Builder revises the plan",
  },
  BUILDER_REVISION: {
    headline: "Builder is revising the plan",
    why: "Every CRITICAL and HIGH objection has to be answered before implementation may begin.",
    next: "Challenger re-reviews",
  },
  PLAN_LOCKED: {
    headline: "Plan is locked",
    why: "The debate is settled. What gets built is now fixed.",
    next: "Implementation",
  },
  IMPLEMENTING: {
    headline: "Builder is writing code",
    why: "Working on its own branch in an isolated checkout. Nothing touches main.",
    next: "Deterministic checks",
  },
  VERIFYING: {
    headline: "Running the verification suite",
    why: "The repository's existing checks judge the change — Forge does not invent a second testing system.",
    next: "Challenger reviews the diff",
  },
  REVIEWING: {
    headline: "Challenger is reviewing the diff",
    why: "Reading the actual change rather than the promise of it.",
    next: "Browser QA",
  },
  QA: {
    headline: "Running browser QA",
    why: "The surfaces the change touches are exercised in a real browser.",
    next: "Your approval",
  },
  READY_FOR_HUMAN: {
    headline: "Waiting for you",
    why: "Everything Forge can judge has passed. A human decides whether this ships.",
    next: "Pull request",
  },
  PR_CREATED: {
    headline: "Pull request opened",
    why: "Forge never merges. Review and merge it on GitHub.",
    next: "Merge",
  },
  COMPLETED: { headline: "Job complete", why: "The change is on a pull request.", next: null },
  FAILED: { headline: "Job failed", why: "Forge stopped rather than ship something it could not prove.", next: null },
  CANCELLED: { headline: "Job cancelled", why: "Stopped by a human.", next: null },
};

export function currentAction(job: Pick<ForgeJob, "status">): CurrentAction {
  return ACTION[job.status];
}

/** Position of the job in its mode's pipeline: "4 of 10". */
export function pipelineProgress(job: Pick<ForgeJob, "mode" | "status" | "currentPhase">): {
  index: number;
  total: number;
} {
  const phases = MODE_PIPELINE[job.mode];
  const i = phases.findIndex(
    (p) => p.key === job.currentPhase || p.statuses.includes(job.status),
  );
  return { index: i < 0 ? 0 : i + 1, total: phases.length };
}

/* ── Blockers ──────────────────────────────────────────────────────────── */

export type Blocker =
  | { kind: "objections"; title: string; body: string; count: number }
  | { kind: "check"; title: string; body: string; checkName: string }
  | { kind: "ready"; title: string; body: string }
  | { kind: "failed"; title: string; body: string };

export function blocker(
  job: Pick<ForgeJob, "status" | "mode" | "error" | "diffSummary" | "totalCostUsd">,
  objections: readonly ForgeObjection[],
  checks: readonly ForgeCheck[],
): Blocker | null {
  if (job.status === "FAILED") {
    return {
      kind: "failed",
      title: "Job failed",
      body: job.error ?? "Forge stopped before shipping an unproven change.",
    };
  }
  const failed = checks.find((c) => c.status === "failed");
  if (failed) {
    return {
      kind: "check",
      title: "Check failed",
      body: failed.failureSummary ?? `${failed.name} did not pass.`,
      checkName: failed.name,
    };
  }
  const open = objections.filter(
    (o) => o.status === "open" && (o.severity === "CRITICAL" || o.severity === "HIGH"),
  );
  if (open.length > 0 && blocksImplementation(job.mode, objections)) {
    return {
      kind: "objections",
      title: "Action required",
      body: `${open.length} unresolved ${open.length === 1 ? "objection" : "objections"} block implementation.`,
      count: open.length,
    };
  }
  if (job.status === "READY_FOR_HUMAN") {
    const d = job.diffSummary;
    return {
      kind: "ready",
      title: "Ready for you",
      body: d
        ? `All required checks passed. ${d.filesChanged} files changed, +${d.additions} / −${d.deletions}.`
        : "All required checks passed.",
    };
  }
  return null;
}

/* ── Why this? ─────────────────────────────────────────────────────────── */

export function whyProfile(job: Pick<ForgeJob, "verificationProfile" | "mode">): string | null {
  const key = job.verificationProfile;
  if (!key) return null;
  const p = VERIFICATION_PROFILES[key];
  if (!p) return null;
  return `This change touches ${p.description.toLowerCase().replace(/\.$/, "")}, so Forge selected the ${p.label} verification profile. Running everything for a copy change is noise, not rigour.`;
}

export function whyMode(mode: ForgeMode): string {
  return mode === "FAST"
    ? "FAST skips the plan debate because the change is isolated enough that a diff review catches what a debate would."
    : mode === "CRITICAL"
      ? "CRITICAL adds a security review and a premium escalation gate because money, permissions and identity do not get second chances."
      : "DEBATE attacks the plan before implementation because product behaviour is where duplicated state is created.";
}

/* ── Durations ─────────────────────────────────────────────────────────── */

/** Elapsed wall-clock between two ISO stamps, as "4m 12s". */
export function elapsed(fromIso: string, toIso?: string | null): string {
  const start = new Date(fromIso).getTime();
  const end = toIso ? new Date(toIso).getTime() : Date.now();
  const s = Math.max(0, Math.floor((end - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** A short human title for a job, derived from its request. */
export function jobTitle(request: string): string {
  const line = request.trim().split("\n")[0] ?? "";
  return line.length > 72 ? `${line.slice(0, 71).trimEnd()}…` : line || "Untitled job";
}

/** Terminal jobs get a receipt; live ones do not. */
export function isFinished(job: Pick<ForgeJob, "status">): boolean {
  return isTerminal(job.status) || job.status === "PR_CREATED";
}
