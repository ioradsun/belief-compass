/**
 * POV API health / circuit breaker — server only.
 *
 * POV is an external dependency we do not control. When it is down, every call
 * site would otherwise pay a full timeout on every request, turning a provider
 * outage into an app-wide slowdown. This tracks consecutive failures per worker
 * instance and "opens the circuit" for a cool-off window, so read paths fail
 * fast and fall back to chain-derived data instead of hanging.
 */

const FAILURES_TO_OPEN = 3;
const OPEN_MS = 60_000; // cool-off before we probe POV again

let consecutiveFailures = 0;
let openUntil = 0;
let lastError: string | null = null;

export class PovUnavailableError extends Error {
  constructor(message = "POV API unavailable") {
    super(message);
    this.name = "PovUnavailableError";
  }
}

/** True while we are deliberately skipping POV calls after repeated failures. */
export function povCircuitOpen(): boolean {
  return Date.now() < openUntil;
}

export function recordPovSuccess(): void {
  consecutiveFailures = 0;
  openUntil = 0;
  lastError = null;
}

export function recordPovFailure(err: unknown): void {
  consecutiveFailures++;
  lastError = err instanceof Error ? err.message : String(err);
  if (consecutiveFailures >= FAILURES_TO_OPEN) {
    openUntil = Date.now() + OPEN_MS;
  }
}

export function povHealth() {
  return {
    degraded: povCircuitOpen(),
    consecutiveFailures,
    lastError,
    retryInMs: Math.max(0, openUntil - Date.now()),
  };
}

/** Throws fast (no network) while the circuit is open. */
export function assertPovAvailable(): void {
  if (povCircuitOpen()) throw new PovUnavailableError("POV API unavailable (circuit open)");
}
