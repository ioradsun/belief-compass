/**
 * Forge pipeline — one engineering job as a straight line the operator reads
 * left to right.
 *
 * The worker's fifteen statuses have not changed and never leave the worker;
 * this module is the single place that collapses them into the six stages a
 * person actually reasons about — BRIEF, PLAN, BUILD, VERIFY, REVIEW, SHIP —
 * and, for each, says in plain words what is happening right now.
 *
 * The order is the order the engine runs in: cheap deterministic checks
 * (VERIFY) come before the expensive read of the diff (REVIEW), so the rail is
 * monotonic — each stage lights once, in sequence, and never jumps backwards.
 *
 * gstack is not a stage. It is the process each stage runs inside, named on the
 * stage it belongs to (`/office-hours`, `/plan-eng-review`, `/review`). The
 * "reviewer" is one actor at two moments: it attacks the PLAN, then reads the
 * BUILD diff. That is the whole point of the rework — the two are drawn where
 * they happen, not as separate personalities.
 *
 * Pure: no React, no network. Every screen reads the same answer from here.
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
} from "./types";
import { checkTally, debateRound, planAwaitsHuman } from "./stations";

/* ── The six stages, in engine order ───────────────────────────────────── */

export const STAGE_KEYS = ["brief", "plan", "build", "verify", "review", "ship"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

/** What each stage IS — the fixed part, shown as the panel's standing lede. */
export const STAGE_META: Record<
  StageKey,
  { title: string; gstack: string; owner: string; blurb: string }
> = {
  brief: {
    title: "Brief",
    gstack: "/office-hours",
    owner: "Engineer",
    blurb:
      "The request, read against the codebase and framed as a concrete behaviour with a boundary — before any plan exists.",
  },
  plan: {
    title: "Plan",
    gstack: "/plan-eng-review",
    owner: "Engineer · Reviewer",
    blurb:
      "The engineer proposes the smallest complete change; the reviewer attacks it; you lock what survives. Nothing is written until the plan is locked.",
  },
  build: {
    title: "Build",
    gstack: "implement",
    owner: "Engineer",
    blurb:
      "The locked plan, written onto an isolated branch. The change touches its own checkout — never main, never a force-push.",
  },
  verify: {
    title: "Verify",
    gstack: "deterministic checks",
    owner: "Checks",
    blurb:
      "The repository's own checks judge the change. Forge selects the profile the change's shape calls for and invents no second test suite.",
  },
  review: {
    title: "Review",
    gstack: "/review · /qa · /cso",
    owner: "Reviewer",
    blurb:
      "The reviewer reads the actual diff for correctness and structure — the engineering review — then exercises it in a browser and gates it for risk.",
  },
  ship: {
    title: "Ship",
    gstack: "/ship",
    owner: "You",
    blurb:
      "Delivery is a human decision. Forge readies a pull request and stops. It never merges, and never deploys — you do.",
  },
};

/** Which worker statuses live under each stage. Monotonic with the enum order. */
const STAGE_STATUSES: Record<StageKey, readonly ForgeStatus[]> = {
  brief: ["DRAFT", "ANALYZING"],
  plan: ["BUILDER_PLAN", "CHALLENGER_REVIEW", "BUILDER_REVISION", "PLAN_LOCKED"],
  build: ["IMPLEMENTING"],
  verify: ["VERIFYING"],
  review: ["REVIEWING", "QA"],
  ship: ["READY_FOR_HUMAN", "PR_CREATED", "COMPLETED"],
};

/** The stage a status belongs to, or null for the terminal FAILED/CANCELLED. */
export function stageForStatus(status: ForgeStatus): StageKey | null {
  for (const key of STAGE_KEYS) {
    if (STAGE_STATUSES[key].includes(status)) return key;
  }
  return null;
}

/**
 * How far the job actually got, independent of its live status — used to draw
 * done / failed / pending when the status itself (FAILED, CANCELLED) does not
 * name a stage. Reads the evidence the job carries, not a guess.
 */
function reachedIndex(job: ForgeJob, checks: readonly ForgeCheck[]): number {
  if (
    job.prUrl ||
    job.status === "PR_CREATED" ||
    job.status === "COMPLETED" ||
    job.status === "READY_FOR_HUMAN"
  )
    return 5;
  if (job.status === "REVIEWING" || job.status === "QA") return 4;
  if (job.status === "VERIFYING" || checks.length > 0) return 3;
  if (job.status === "IMPLEMENTING" || job.diffSummary) return 2;
  if (
    job.status === "PLAN_LOCKED" ||
    job.plan ||
    job.status === "BUILDER_PLAN" ||
    job.status === "CHALLENGER_REVIEW" ||
    job.status === "BUILDER_REVISION"
  )
    return 1;
  return 0;
}

/* ── Stage state ───────────────────────────────────────────────────────── */

export type StageProgress = "done" | "live" | "attention" | "fail" | "pending";

export type StageState = {
  key: StageKey;
  progress: StageProgress;
  /** Short label under the node on the rail — never a machine status. */
  status: string;
  /** One line: what this stage is doing or has done, right now. */
  headline: string;
  /** A full, state-aware paragraph of what is happening. */
  description: string;
};

type Input = {
  job: ForgeJob;
  objections: readonly ForgeObjection[];
  checks: readonly ForgeCheck[];
  events: readonly ForgeEvent[];
};

/** The single live stage, or null when nothing is running. */
export function liveStage(status: ForgeStatus): StageKey | null {
  return isTerminal(status) ? null : stageForStatus(status);
}

/** A live stage that is really waiting on the human, not the machine. */
function attentionFor(key: StageKey, job: ForgeJob): boolean {
  if (key === "plan") return planAwaitsHuman(job);
  if (key === "ship") return job.status === "READY_FOR_HUMAN";
  return false;
}

/**
 * Every stage, in one pass. The route derives this once and hands each panel
 * its slice, so the rail node and its detail can never disagree.
 */
export function stageStates({
  job,
  objections,
  checks,
  events,
}: Input): Record<StageKey, StageState> {
  const failed = job.status === "FAILED";
  const cancelled = job.status === "CANCELLED";
  const delivered = job.status === "COMPLETED" || job.status === "PR_CREATED";
  const live = liveStage(job.status);
  const liveIndex = live ? STAGE_KEYS.indexOf(live) : -1;
  const reached = reachedIndex(job, checks);

  const out = {} as Record<StageKey, StageState>;
  for (const key of STAGE_KEYS) {
    const idx = STAGE_KEYS.indexOf(key);
    let progress: StageProgress;
    if (delivered) {
      progress = "done";
    } else if (failed) {
      progress = idx < reached ? "done" : idx === reached ? "fail" : "pending";
    } else if (cancelled) {
      progress = idx < reached ? "done" : "pending";
    } else if (idx < liveIndex) {
      progress = "done";
    } else if (idx === liveIndex) {
      progress = attentionFor(key, job) ? "attention" : "live";
    } else {
      progress = "pending";
    }
    out[key] = { key, progress, ...content(key, progress, job, objections, checks, events) };
  }
  return out;
}

/* ── The words ─────────────────────────────────────────────────────────────
 * Every stage owes the operator a sentence of what is happening, in every
 * state it can be in. "Waiting…" is not a sentence; each branch below says
 * what it is waiting on and what unblocks it.
 */

type Content = { status: string; headline: string; description: string };

function content(
  key: StageKey,
  progress: StageProgress,
  job: ForgeJob,
  objections: readonly ForgeObjection[],
  checks: readonly ForgeCheck[],
  events: readonly ForgeEvent[],
): Content {
  switch (key) {
    case "brief":
      return briefContent(progress, job);
    case "plan":
      return planContent(progress, job, objections);
    case "build":
      return buildContent(progress, job);
    case "verify":
      return verifyContent(progress, job, checks);
    case "review":
      return reviewContent(progress, job, events);
    case "ship":
      return shipContent(progress, job, objections, checks);
  }
}

function briefContent(progress: StageProgress, job: ForgeJob): Content {
  if (progress === "pending" || job.status === "DRAFT") {
    return {
      status: "Queued",
      headline: "Waiting to start",
      description:
        "The job is filed but no worker has taken it yet. When one does, the engineer reads the repository and frames the request as a concrete behaviour before proposing anything.",
    };
  }
  if (progress === "live") {
    return {
      status: "Reading repo",
      headline: "Reading the repository",
      description:
        "The engineer is reading the codebase to find the mechanism that already owns this behaviour, so the change extends one source of truth instead of adding a second. A plan follows once it has the lay of the land.",
    };
  }
  return {
    status: "Framed",
    headline: "Intent framed",
    description:
      "The request has been read against the codebase and framed as a concrete behaviour with a boundary. What follows is a plan for the smallest change that delivers it.",
  };
}

function planContent(
  progress: StageProgress,
  job: ForgeJob,
  objections: readonly ForgeObjection[],
): Content {
  const openBlocking = objections.filter(
    (o) => o.status === "open" && (o.severity === "CRITICAL" || o.severity === "HIGH"),
  ).length;
  const round = debateRound(objections);
  const blocked = blocksImplementation(job.mode, objections);

  if (progress === "pending") {
    return {
      status: "Waiting",
      headline: "Waiting for the brief",
      description:
        "Nothing is planned until the engineer has read the repository. The plan will name the change as steps, files, and acceptance criteria.",
    };
  }
  if (job.status === "BUILDER_PLAN") {
    return {
      status: "Planning",
      headline: "Writing the plan",
      description:
        "The engineer is naming the smallest complete change — its steps, the files it touches, and the acceptance criteria that decide when it is done — before a single line of code is written.",
    };
  }
  if (job.status === "CHALLENGER_REVIEW") {
    return {
      status: "Under review",
      headline: "The reviewer is attacking the plan",
      description: `gstack's plan review is looking for duplicated state, feed and identity regressions, and simpler routes to the same behaviour${
        openBlocking > 0
          ? `. ${openBlocking} blocking objection${openBlocking === 1 ? "" : "s"} must be answered before any code is written`
          : ""
      }.`,
    };
  }
  if (job.status === "BUILDER_REVISION") {
    return {
      status: "Revising",
      headline: "Revising the plan",
      description:
        "The engineer is answering the reviewer's objections. Every CRITICAL and HIGH must be resolved before the plan can lock — the debate does not end on a timer.",
    };
  }
  if (progress === "attention") {
    if (blocked && openBlocking > 0) {
      return {
        status: "Blocked",
        headline: "Blocking objections are open",
        description: `${openBlocking} blocking objection${
          openBlocking === 1 ? "" : "s"
        } must be resolved before the plan can lock. Answer them in the debate, or send the plan back with a note — nothing is implemented while they stand.`,
      };
    }
    return {
      status: "Approve",
      headline: "The plan is yours to lock",
      description:
        "The reviewer's blocking objections are answered. Lock the plan to authorise implementation — nothing is written until you do. You can still send it back with a note instead.",
    };
  }
  // done / plan locked
  const debate =
    objections.length > 0
      ? ` It survived ${objections.length} objection${objections.length === 1 ? "" : "s"}${
          round > 1 ? ` across ${round} rounds` : ""
        }.`
      : "";
  return {
    status: "Locked",
    headline: "Plan locked",
    description: `The debate is settled and what gets built is fixed.${debate} Implementation works only from the locked plan.`,
  };
}

function buildContent(progress: StageProgress, job: ForgeJob): Content {
  const d = job.diffSummary;
  const branch = job.branchName ?? "an isolated branch";
  if (progress === "pending") {
    return {
      status: "Not started",
      headline: job.planLockedAt ? "Queued" : "Waiting on the plan",
      description: job.planLockedAt
        ? "The plan is locked. The engineer will write the change onto its branch; changed files appear here as they land."
        : "Nothing is written until the plan survives review and you lock it. This stage stays empty until then.",
    };
  }
  if (progress === "live") {
    return {
      status: "Writing",
      headline: "Writing the code",
      description: `The engineer is implementing the locked plan on ${branch}, in an isolated checkout — nothing touches main. Changed files and their line counts appear here as they are written.`,
    };
  }
  if (progress === "fail") {
    return {
      status: "Stopped",
      headline: "Implementation stopped",
      description:
        job.error ??
        "The engineer could not complete the change and Forge stopped rather than carry a half-written diff forward.",
    };
  }
  return {
    status: d ? `+${d.additions} −${d.deletions}` : "Written",
    headline: "Implemented",
    description: d
      ? `The change is written onto ${branch}: ${d.filesChanged} file${
          d.filesChanged === 1 ? "" : "s"
        }, +${d.additions} / −${d.deletions}. It now goes to the deterministic checks.`
      : `The change is written onto ${branch} and goes to the deterministic checks.`,
  };
}

function verifyContent(
  progress: StageProgress,
  job: ForgeJob,
  checks: readonly ForgeCheck[],
): Content {
  const tally = checkTally(checks);
  const profile = job.verificationProfile ? VERIFICATION_PROFILES[job.verificationProfile] : null;
  const profileName = profile ? profile.label : "selected";

  if (progress === "pending") {
    return {
      status: "Not started",
      headline: "Not started",
      description: profile
        ? `Verification begins after implementation. ${profile.checks.length} checks are queued from the ${profile.label} profile — the ones this shape of change actually calls for.`
        : "Verification begins after implementation is complete.",
    };
  }
  if (progress === "fail" || tally.failed > 0) {
    const failed = checks.find((c) => c.status === "failed");
    return {
      status: `${tally.failed} failed`,
      headline: "A check failed",
      description:
        failed?.failureSummary ??
        `${failed?.name ?? "A check"} did not pass. Forge stops at a failed check rather than ship a change it cannot prove.`,
    };
  }
  if (progress === "live") {
    return {
      status: tally.total > 0 ? `${tally.settled} / ${tally.total}` : "Running",
      headline: "Running deterministic checks",
      description: `The repository's own checks for a ${profileName} change are running. Forge runs the ones an isolated worker can prove and leaves the data-integrity checks that need a live database to the pull request's own CI — shown honestly, never faked green.`,
    };
  }
  return {
    status: `${tally.passed} / ${tally.total} passed`,
    headline: "Checks passed",
    description: `The deterministic checks Forge can run in isolation passed. The pull request's CI re-runs the full ${profileName} suite against a live environment before anyone merges.`,
  };
}

function reviewContent(
  progress: StageProgress,
  job: ForgeJob,
  events: readonly ForgeEvent[],
): Content {
  void events;
  if (progress === "pending") {
    return {
      status: "Not started",
      headline: "Not started",
      description:
        "The reviewer reads the diff once the checks are in. This is the engineering review — the same skeptic that critiqued the plan, now reading the actual change.",
    };
  }
  if (job.status === "QA") {
    return {
      status: "Browser QA",
      headline: "Exercising it in a browser",
      description:
        "gstack's /qa drives the surfaces the change touches in a real browser, so behaviour is proven against the running app — not just against the diff.",
    };
  }
  if (progress === "live") {
    return {
      status: "Reviewing",
      headline: "Engineering review of the diff",
      description:
        "The same reviewer that attacked the plan now reads the actual change — gstack's /review — for correctness and structure, against what was locked. This is the engineering review: plan critique and diff review are one actor at two moments, shown where each happens.",
    };
  }
  if (progress === "fail") {
    return {
      status: "Sent back",
      headline: "Review sent the change back",
      description:
        job.error ??
        "The engineering review found something the change had to answer before it could go further.",
    };
  }
  return {
    status: "Reviewed",
    headline: "Engineering review complete",
    description:
      "The reviewer read the diff for correctness and structure and, where the profile called for it, exercised it in a browser and gated it for security. What it found rides to your approval as notes.",
  };
}

function shipContent(
  progress: StageProgress,
  job: ForgeJob,
  objections: readonly ForgeObjection[],
  checks: readonly ForgeCheck[],
): Content {
  if (job.status === "PR_CREATED" || job.status === "COMPLETED") {
    return {
      status: "PR open",
      headline: "Pull request opened",
      description:
        "Forge opened the pull request and stopped. Review and merge it on GitHub — Forge never merges, and never deploys.",
    };
  }
  if (job.status === "READY_FOR_HUMAN" || progress === "attention") {
    const d = job.diffSummary;
    const tally = checkTally(checks);
    const noted = objections.filter((o) => o.severity === "MEDIUM").length;
    return {
      status: "Ready for you",
      headline: "Waiting for your decision",
      description: `Everything Forge can judge has passed${
        d
          ? ` — ${d.filesChanged} file${d.filesChanged === 1 ? "" : "s"}, +${d.additions} / −${d.deletions}`
          : ""
      }${tally.total > 0 ? `, ${tally.passed}/${tally.total} checks` : ""}${
        noted > 0 ? `, ${noted} non-blocking note${noted === 1 ? "" : "s"}` : ""
      }. You decide whether this ships: open the pull request, or send it back.`,
    };
  }
  if (progress === "fail") {
    return {
      status: "Stopped",
      headline: "Job stopped before delivery",
      description: job.error ?? "Forge stopped rather than ready a change it could not prove.",
    };
  }
  return {
    status: "Not ready",
    headline: "Not ready",
    description:
      "Delivery unlocks once the change is implemented, verified, and reviewed. Forge readies a pull request for your approval — it never merges on its own.",
  };
}
