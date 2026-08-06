// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

// h3's HTTPError serializes to {"status":500,"unhandled":true,"message":"HTTPError"} —
// no stack, no cause — so a plain console.error(error) reaches the log pipeline with
// the failure detail stripped. Expand Error-like args into a string that keeps the
// message, stack, and the full cause chain.
const CAUSE_DEPTH_LIMIT = 5;
const DESCRIPTION_LENGTH_LIMIT = 8_000;

export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH_LIMIT && current != null; depth++) {
    if (!(current instanceof Error)) {
      parts.push(typeof current === "string" ? current : safeStringify(current));
      break;
    }
    const label = depth === 0 ? "" : "caused by: ";
    const status = describeStatus(current);
    parts.push(`${label}${current.stack ?? `${current.name}: ${current.message}`}${status}`);
    current = current.cause;
  }
  return parts.join("\n").slice(0, DESCRIPTION_LENGTH_LIMIT);
}

function describeStatus(error: Error): string {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = status ?? statusCode;
  return typeof value === "number" ? ` (status ${value})` : "";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

// A client that navigates away/reloads mid-render aborts the socket. Node and
// srvx surface that as AbortError / "aborted" / ECONNRESET. Nobody is left to
// receive a response, so it is not an app error and must not be logged or
// reported (it would show up as a blank-screen runtime error).
export function isAbortError(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  const err = value as { name?: unknown; message?: unknown; code?: unknown };
  return (
    err.name === "AbortError" ||
    err.message === "aborted" ||
    err.message === "This operation was aborted" ||
    err.code === "ECONNRESET" ||
    err.code === "ABORT_ERR"
  );
}

// Wrap console.error so errors logged by any layer — including h3's internal
// unhandled-error logging, which this file cannot hook directly — are both
// recorded for consumeLastCapturedError and expanded before serialization.
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (args.some(isAbortError)) return;
  const expanded = args.map((arg) => {
    if (!isErrorLike(arg)) return arg;
    record(arg);
    return describeError(arg);
  });
  originalConsoleError(...expanded);
};

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => {
    const error = (event as ErrorEvent).error ?? event;
    if (isAbortError(error)) return;
    record(error);
  });
  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    if (isAbortError(reason)) return;
    record(reason);
  });
}

// Node (dev server / SSR on Node) does not route socket aborts through
// globalThis error events — they arrive as process-level uncaught exceptions
// from node:_http_server. Swallow only the abort case so a client that
// navigates away mid-render doesn't get reported as a runtime error.
const nodeProcess = (globalThis as { process?: NodeJS.Process }).process;
if (nodeProcess && typeof nodeProcess.on === "function") {
  // An `uncaughtException` listener is too late for preview instrumentation:
  // every listener receives the socket abort, even when ours ignores it. Node's
  // capture callback runs before that event is broadcast, so expected client
  // disconnects never reach the runtime-error reporter. Keep the prior behavior
  // for genuine failures by recording and logging them here.
  // The Worker runtime stubs these process methods: merely CALLING
  // hasUncaughtExceptionCaptureCallback throws "not implemented", which would
  // 500 every request. Probe defensively and fall back to plain listeners.
  let installedCaptureCallback = false;
  try {
    if (
      typeof nodeProcess.setUncaughtExceptionCaptureCallback === "function" &&
      typeof nodeProcess.hasUncaughtExceptionCaptureCallback === "function" &&
      !nodeProcess.hasUncaughtExceptionCaptureCallback()
    ) {
      nodeProcess.setUncaughtExceptionCaptureCallback((error: unknown) => {
        if (isAbortError(error)) return;
        record(error);
        originalConsoleError(describeError(error));
      });
      installedCaptureCallback = true;
    }
  } catch {
    installedCaptureCallback = false;
  }

  try {
    if (!installedCaptureCallback) {
      nodeProcess.on("uncaughtException", (error: unknown) => {
        if (isAbortError(error)) return;
        record(error);
        originalConsoleError(describeError(error));
      });
    }
    nodeProcess.on("unhandledRejection", (reason: unknown) => {
      if (isAbortError(reason)) return;
      record(reason);
      originalConsoleError(describeError(reason));
    });
  } catch {
    // Runtime doesn't support process event listeners — globalThis listeners above suffice.
  }
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
