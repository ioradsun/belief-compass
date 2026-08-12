/**
 * The Forge Worker adapter.
 *
 * The Conviction web server never touches a filesystem, never runs a test,
 * never holds a git checkout. Everything that writes code happens in an
 * isolated external service; this file is the only door to it.
 *
 * If the door is not configured, every operation fails with a single, honest
 * error — "Forge Worker not connected". It does NOT return plausible-looking
 * results. A fabricated diff or a fabricated passing check is worse than a
 * missing one, because it is believed.
 */
import type { DiffSummary, ForgeMode, GstackOperation, VerificationProfileKey } from "./types";

export type WorkerStatus = {
  configured: boolean;
  reachable: boolean;
  url: string | null;
  version?: string;
  workspace?: string;
  error?: string;
};

export class ForgeWorkerNotConnected extends Error {
  constructor(reason = "Forge Worker not connected") {
    super(reason);
    this.name = "ForgeWorkerNotConnected";
  }
}

export type WorkerJobRef = { workerJobId: string };

export type CreateJobInput = {
  jobId: string;
  request: string;
  mode: ForgeMode;
  branchName: string;
  verificationProfile: VerificationProfileKey;
  builderModel: string;
  challengerModel: string;
  escalationModel: string;
};

export type WorkerCheckResult = {
  name: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  outputSummary?: string;
  failureSummary?: string;
};

/**
 * The contract Phase 2 implements on the other side. Written as one interface
 * so the worker cannot quietly grow a capability the app has not accounted for.
 */
export interface ForgeWorker {
  status(): Promise<WorkerStatus>;
  createJob(input: CreateJobInput): Promise<WorkerJobRef>;
  getJob(workerJobId: string): Promise<{ status: string; detail?: unknown }>;
  startDebate(workerJobId: string): Promise<void>;
  runBuilder(workerJobId: string, instruction?: string): Promise<void>;
  runChallenger(workerJobId: string): Promise<void>;
  lockPlan(workerJobId: string): Promise<void>;
  startImplementation(workerJobId: string): Promise<void>;
  runChecks(workerJobId: string, profile: VerificationProfileKey): Promise<WorkerCheckResult[]>;
  runReview(workerJobId: string, operation: GstackOperation): Promise<void>;
  runQA(workerJobId: string): Promise<void>;
  getDiff(workerJobId: string): Promise<{ summary: DiffSummary; patch: string }>;
  getPreview(workerJobId: string): Promise<{ url: string | null }>;
  createPullRequest(workerJobId: string): Promise<{ url: string }>;
  cancelJob(workerJobId: string): Promise<void>;
}

/**
 * Operators paste worker URLs by hand, so accept the shapes a human types:
 * missing scheme, stray whitespace, quotes, a trailing slash. Anything that
 * still isn't a URL becomes null — "not connected" beats "Invalid URL string".
 */
export function normalizeWorkerUrl(raw: string | undefined | null): string | null {
  let value = (raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const parsed = new URL(value);
    if (!parsed.hostname) return null;
    // Keep any base path, guarantee a trailing slash so path joins don't eat it.
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/`;
  } catch {
    return null;
  }
}

function config() {
  return {
    url: normalizeWorkerUrl(process.env.FORGE_WORKER_URL),
    secret: process.env.FORGE_WORKER_SECRET?.trim() || null,
  };
}

export function workerConfigured(): boolean {
  const { url, secret } = config();
  return Boolean(url && secret);
}

async function call<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const { url, secret } = config();
  if (!url || !secret) throw new ForgeWorkerNotConnected();

  const res = await fetch(new URL(path.replace(/^\//, ""), url).toString(), {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`Forge Worker ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

export const forgeWorker: ForgeWorker = {
  async status() {
    const { url } = config();
    if (!url && (process.env.FORGE_WORKER_URL ?? "").trim()) {
      return {
        configured: true,
        reachable: false,
        url: null,
        error: "FORGE_WORKER_URL is not a valid URL (expected e.g. https://forge.example.com)",
      };
    }
    if (!workerConfigured()) {
      return { configured: false, reachable: false, url: null };
    }
    try {
      const info = await call<{ version?: string; workspace?: string }>(
        "/status",
        undefined,
        "GET",
      );
      return {
        configured: true,
        reachable: true,
        url,
        version: info.version,
        workspace: info.workspace,
      };
    } catch (e) {
      return {
        configured: true,
        reachable: false,
        url,
        error: e instanceof Error ? e.message : "unreachable",
      };
    }
  },
  createJob: (input) => call("/jobs", input),
  getJob: (id) => call(`/jobs/${id}`, undefined, "GET"),
  startDebate: (id) => call(`/jobs/${id}/debate`),
  runBuilder: (id, instruction) => call(`/jobs/${id}/builder`, { instruction }),
  runChallenger: (id) => call(`/jobs/${id}/challenger`),
  lockPlan: (id) => call(`/jobs/${id}/lock`),
  startImplementation: (id) => call(`/jobs/${id}/implement`),
  runChecks: (id, profile) => call(`/jobs/${id}/checks`, { profile }),
  runReview: (id, operation) => call(`/jobs/${id}/review`, { operation }),
  runQA: (id) => call(`/jobs/${id}/qa`),
  getDiff: (id) => call(`/jobs/${id}/diff`, undefined, "GET"),
  getPreview: (id) => call(`/jobs/${id}/preview`, undefined, "GET"),
  createPullRequest: (id) => call(`/jobs/${id}/pr`),
  cancelJob: (id) => call(`/jobs/${id}/cancel`),
};
