/**
 * Conviction Forge — the vocabulary.
 *
 * One place that says what a Forge job IS: its modes, its states, the legal
 * moves between them, the phases each mode walks through, and which
 * deterministic checks a change of a given shape has to survive.
 *
 * Nothing here talks to a network. The UI reads it, the server functions read
 * it, and the future Forge Worker is handed it — so all three agree on the
 * pipeline without any of them owning it privately.
 */

export const FORGE_MODES = ["FAST", "DEBATE", "CRITICAL"] as const;
export type ForgeMode = (typeof FORGE_MODES)[number];

export const FORGE_STATUSES = [
  "DRAFT",
  "ANALYZING",
  "BUILDER_PLAN",
  "CHALLENGER_REVIEW",
  "BUILDER_REVISION",
  "PLAN_LOCKED",
  "IMPLEMENTING",
  "VERIFYING",
  "REVIEWING",
  "QA",
  "READY_FOR_HUMAN",
  "PR_CREATED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ForgeStatus = (typeof FORGE_STATUSES)[number];

export type ForgeRole = "builder" | "challenger" | "escalation" | "system" | "human";
export type ObjectionSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type ObjectionStatus = "open" | "resolved" | "maintained" | "waived";
export type CheckStatus = "pending" | "running" | "passed" | "failed" | "skipped";

/** Terminal states accept no further transition. */
export const TERMINAL_STATUSES: readonly ForgeStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

/**
 * The legal moves. A job's status is never set by a component; it is advanced
 * through `nextStatus`, which refuses illegal jumps. FAILED and CANCELLED are
 * reachable from anywhere non-terminal and so are not listed per-state.
 */
const TRANSITIONS: Record<ForgeStatus, readonly ForgeStatus[]> = {
  DRAFT: ["ANALYZING"],
  ANALYZING: ["BUILDER_PLAN"],
  BUILDER_PLAN: ["CHALLENGER_REVIEW", "PLAN_LOCKED"],
  CHALLENGER_REVIEW: ["BUILDER_REVISION", "PLAN_LOCKED"],
  BUILDER_REVISION: ["CHALLENGER_REVIEW", "PLAN_LOCKED"],
  PLAN_LOCKED: ["IMPLEMENTING"],
  IMPLEMENTING: ["VERIFYING"],
  VERIFYING: ["REVIEWING", "IMPLEMENTING"],
  REVIEWING: ["QA", "BUILDER_REVISION"],
  QA: ["READY_FOR_HUMAN", "IMPLEMENTING"],
  READY_FOR_HUMAN: ["PR_CREATED"],
  PR_CREATED: ["COMPLETED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: ForgeStatus, to: ForgeStatus): boolean {
  if (TERMINAL_STATUSES.includes(from)) return false;
  if (to === "FAILED" || to === "CANCELLED") return true;
  return TRANSITIONS[from].includes(to);
}

export function nextStatus(from: ForgeStatus, to: ForgeStatus): ForgeStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Forge: illegal transition ${from} → ${to}`);
  }
  return to;
}

export function isTerminal(status: ForgeStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/* ── Pipelines ─────────────────────────────────────────────────────────────
 * What each mode actually walks through, in order, as the human sees it.
 * Displayed before anything runs, so the operator knows the cost of the mode
 * they picked before they pick it.
 */

export type ForgePhase = {
  key: string;
  label: string;
  /** Which participant owns this phase. */
  role: ForgeRole;
  /** The job statuses during which this phase is the live one. */
  statuses: readonly ForgeStatus[];
};

const PHASE = {
  analyze: {
    key: "analyze",
    label: "Repository analysis",
    role: "builder",
    statuses: ["ANALYZING"],
  },
  plan: { key: "plan", label: "Builder plan", role: "builder", statuses: ["BUILDER_PLAN"] },
  debate: {
    key: "debate",
    label: "Challenger debate",
    role: "challenger",
    statuses: ["CHALLENGER_REVIEW", "BUILDER_REVISION"],
  },
  lock: { key: "lock", label: "Plan locked", role: "human", statuses: ["PLAN_LOCKED"] },
  implement: {
    key: "implement",
    label: "Implementation",
    role: "builder",
    statuses: ["IMPLEMENTING"],
  },
  verify: { key: "verify", label: "Deterministic checks", role: "system", statuses: ["VERIFYING"] },
  review: {
    key: "review",
    label: "Challenger diff review",
    role: "challenger",
    statuses: ["REVIEWING"],
  },
  security: {
    key: "security",
    label: "Security review",
    role: "escalation",
    statuses: ["REVIEWING"],
  },
  qa: { key: "qa", label: "Browser QA", role: "system", statuses: ["QA"] },
  escalate: {
    key: "escalate",
    label: "Premium review",
    role: "escalation",
    statuses: ["READY_FOR_HUMAN"],
  },
  human: { key: "human", label: "Human approval", role: "human", statuses: ["READY_FOR_HUMAN"] },
  pr: { key: "pr", label: "Pull request", role: "system", statuses: ["PR_CREATED"] },
} satisfies Record<string, ForgePhase>;

export const MODE_PIPELINE: Record<ForgeMode, readonly ForgePhase[]> = {
  FAST: [
    PHASE.analyze,
    PHASE.plan,
    PHASE.implement,
    PHASE.verify,
    PHASE.review,
    PHASE.qa,
    PHASE.human,
    PHASE.pr,
  ],
  DEBATE: [
    PHASE.analyze,
    PHASE.plan,
    PHASE.debate,
    PHASE.lock,
    PHASE.implement,
    PHASE.verify,
    PHASE.review,
    PHASE.qa,
    PHASE.human,
    PHASE.pr,
  ],
  CRITICAL: [
    PHASE.analyze,
    PHASE.plan,
    PHASE.debate,
    PHASE.lock,
    PHASE.implement,
    PHASE.verify,
    PHASE.review,
    PHASE.security,
    PHASE.qa,
    PHASE.escalate,
    PHASE.human,
    PHASE.pr,
  ],
};

export const MODE_BLURB: Record<ForgeMode, string> = {
  FAST: "Copy, CSS, small isolated UI and bug fixes. The engineer implements, the reviewer reads the diff.",
  DEBATE:
    "Product behaviour: feed, ranking, calibration, DNA, onboarding. Plan is attacked before a line is written.",
  CRITICAL:
    "Money, wallets, market execution, migrations, permissions, identity. Full checks, security review, premium escalation. Never auto-merges.",
};

/** Severities that must be resolved before implementation may start. */
export const BLOCKING_SEVERITIES: readonly ObjectionSeverity[] = ["CRITICAL", "HIGH"] as const;

export function blocksImplementation(
  mode: ForgeMode,
  objections: readonly { severity: ObjectionSeverity; status: ObjectionStatus }[],
): boolean {
  if (mode === "FAST") return false;
  return objections.some((o) => BLOCKING_SEVERITIES.includes(o.severity) && o.status === "open");
}

/* ── Verification profiles ─────────────────────────────────────────────────
 * Conviction already owns a large deterministic suite. Forge does not invent a
 * second one; it selects from this one. Running everything for a copy change
 * is not rigour, it is noise — so the shape of the change picks the profile.
 */

export type VerificationProfileKey = "ui" | "feed" | "identity" | "money";

export type VerificationProfile = {
  key: VerificationProfileKey;
  label: string;
  description: string;
  /** package.json script names, in run order. */
  checks: readonly string[];
  /** Extra non-script gates the worker performs. */
  gates?: readonly string[];
};

export const VERIFICATION_PROFILES: Record<VerificationProfileKey, VerificationProfile> = {
  ui: {
    key: "ui",
    label: "UI",
    description: "Copy, styling, presentation-only components.",
    checks: ["check:types", "lint", "build"],
    gates: ["browser QA"],
  },
  feed: {
    key: "feed",
    label: "Feed & discovery",
    description: "Ranking, supply, archetypes, composition, the Insider corpus.",
    checks: [
      "check:types",
      "check:data-flow",
      "check:opportunities",
      "check:feed-supply",
      "check:feed-archetypes",
      "check:composition",
      "check:insider",
      "build",
    ],
  },
  identity: {
    key: "identity",
    label: "Calibration & identity",
    description: "Positions, DNA, discovery, challenge integrity.",
    checks: [
      "check:types",
      "check:positions",
      "check:dna",
      "check:dna-archetypes",
      "check:discovery",
      "check:challenge-integrity",
      "check:composition",
      "build",
    ],
  },
  money: {
    key: "money",
    label: "Money & schema",
    description: "Wallets, market execution, migrations, permissions.",
    checks: [
      "check:types",
      "check:schema",
      "check:ownership",
      "check:positions",
      "check:market-state",
      "check:data-flow",
      "check:connection",
      "build",
    ],
    gates: ["security review", "premium review"],
  },
};

export function defaultProfileForMode(mode: ForgeMode): VerificationProfileKey {
  return mode === "CRITICAL" ? "money" : mode === "FAST" ? "ui" : "feed";
}

/* ── gstack phases ─────────────────────────────────────────────────────────
 * gstack lives in the worker, not here. Forge only needs to name the
 * operations it can ask for, so the human never types a slash command.
 */
export const GSTACK_OPERATIONS = [
  "office-hours",
  "plan review",
  "engineering review",
  "review",
  "investigate",
  "qa",
  "cso",
  "ship",
] as const;
export type GstackOperation = (typeof GSTACK_OPERATIONS)[number];

/* ── Escalation ────────────────────────────────────────────────────────────
 * Configurable, not buried in an if-statement three layers down.
 */
export type EscalationRuleKey =
  | "debate_deadlock"
  | "repair_exhausted"
  | "security_sensitive"
  | "money_logic"
  | "destructive_migration"
  | "low_confidence"
  | "human_request";

export type EscalationRule = {
  key: EscalationRuleKey;
  label: string;
  enabled: boolean;
  threshold?: number;
};

export const DEFAULT_ESCALATION_RULES: readonly EscalationRule[] = [
  {
    key: "debate_deadlock",
    label: "Unresolved after N debate rounds",
    enabled: true,
    threshold: 2,
  },
  {
    key: "repair_exhausted",
    label: "Checks still failing after N repairs",
    enabled: true,
    threshold: 2,
  },
  { key: "security_sensitive", label: "Security-sensitive implementation", enabled: true },
  { key: "money_logic", label: "Wallet or money logic changed", enabled: true },
  { key: "destructive_migration", label: "Destructive database migration", enabled: true },
  {
    key: "low_confidence",
    label: "Architecture confidence below threshold",
    enabled: true,
    threshold: 0.6,
  },
  { key: "human_request", label: "Explicit human request", enabled: true },
];

/* ── Records ───────────────────────────────────────────────────────────────
 * The client-facing shape of persisted rows. camelCase at the boundary; the
 * mapping from snake_case columns happens once, server-side.
 */

export type ForgePlan = {
  summary: string;
  steps?: string[];
  acceptanceCriteria?: string[];
  filesTouched?: string[];
  risks?: string[];
  confidence?: number;
};

export type ForgeJob = {
  id: string;
  createdBy: string | null;
  request: string;
  mode: ForgeMode;
  status: ForgeStatus;
  currentPhase: string | null;
  builderModel: string;
  challengerModel: string;
  escalationModel: string;
  verificationProfile: VerificationProfileKey | null;
  plan: ForgePlan | null;
  planLockedAt: string | null;
  branchName: string | null;
  prUrl: string | null;
  diffSummary: DiffSummary | null;
  workerJobId: string | null;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DiffSummary = {
  filesChanged: number;
  additions: number;
  deletions: number;
  files?: { path: string; additions: number; deletions: number }[];
};

export type ForgeJsonValue =
  | string
  | number
  | boolean
  | null
  | ForgeJsonValue[]
  | { [key: string]: ForgeJsonValue };

export type ForgeEvent = {
  id: number;
  kind: string;
  level: "info" | "warn" | "error" | "success";
  role: ForgeRole | null;
  message: string;
  detail: ForgeJsonValue | null;
  createdAt: string;
};

export type ForgeObjection = {
  id: string;
  round: number;
  severity: ObjectionSeverity;
  title: string;
  body: string | null;
  status: ObjectionStatus;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type ForgeCheck = {
  id: string;
  name: string;
  command: string | null;
  status: CheckStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  outputSummary: string | null;
  failureSummary: string | null;
  position: number;
};

export type ForgeModelRun = {
  id: string;
  role: "builder" | "challenger" | "escalation";
  provider: string;
  modelId: string;
  phase: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number | null;
  status: "ok" | "failed";
  error: string | null;
  createdAt: string;
};

export type ForgeJobDetail = {
  job: ForgeJob;
  events: ForgeEvent[];
  objections: ForgeObjection[];
  checks: ForgeCheck[];
  modelRuns: ForgeModelRun[];
};

/** Branch names are generated, never typed. Keep them boring and git-safe. */
export function branchNameFor(request: string, id: string): string {
  const slug =
    request
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "change";
  return `forge/${slug}-${id.slice(0, 8)}`;
}

/* ── Discovery — the pre-job planning session ───────────────────────────────
 * The office-hours conversation that turns a one-line request into a structured
 * brief before any job exists. Mirrors the worker's contract; the app holds the
 * state, the worker reads the code once and produces each turn.
 */

/** A one-time read of the repo, seeding the conversation with real code. */
export type RepoDigest = {
  tree: string;
  files: { path: string; excerpt: string }[];
  relevantPaths: string[];
};

/** The living brief the conversation builds — structured so agents can act on it. */
export type DiscoveryPlan = {
  title: string;
  problem: string;
  behavior: string;
  edgeCases: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  relevantFiles: string[];
  openQuestions: string[];
};

export type DiscoveryMessage = {
  role: "ai" | "you";
  content: string;
  suggestedAnswers?: string[];
};

export type DiscoveryTurnResult = {
  message: string;
  suggestedAnswers: string[];
  plan: DiscoveryPlan;
  ready: boolean;
};

export const EMPTY_DISCOVERY_PLAN: DiscoveryPlan = {
  title: "",
  problem: "",
  behavior: "",
  edgeCases: [],
  constraints: [],
  acceptanceCriteria: [],
  relevantFiles: [],
  openQuestions: [],
};

/** The client-facing shape of a persisted discovery session. */
export type DiscoverySession = {
  id: string;
  request: string;
  mode: ForgeMode;
  messages: DiscoveryMessage[];
  plan: DiscoveryPlan;
  ready: boolean;
  status: "active" | "proceeded" | "abandoned";
  jobId: string | null;
  /** The OpenRouter model actually running this session — the source of truth,
   *  since a model's own self-report of its identity is unreliable. */
  model: string;
};
