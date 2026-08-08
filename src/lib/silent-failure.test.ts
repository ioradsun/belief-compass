import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { challengeLock } from "@/domain/challenge";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/**
 * BELIEVABLE EMPTINESS — the failure mode this file exists to prevent.
 *
 * The social graph does not fall over when a privileged read fails. It goes
 * QUIET, and quiet is a state the product already has legitimate copy for. That
 * is what makes it dangerous: a blocked read arrives as `null`, `?? 0` turns it
 * into a number, and a number means something. Nobody sees an error. Everybody
 * sees a calm, well-written sentence that happens to be false.
 *
 * These are source-level guards rather than behavioural tests because the bug is
 * a SHAPE — a read whose failure was never bound to a variable. There is no
 * runtime state to assert against; the absence is the defect.
 */
describe("a failed read never becomes a claim about the reader", () => {
  it("proves the claim it would have made", () => {
    // Not hypothetical. This is the exact sentence a zero produces, and it is the
    // first-run onboarding line — shown, before the fix, to anyone whose belief
    // read failed, however long they had been here.
    const lock = challengeLock(0);
    expect(lock.unlocked).toBe(false);
    expect(lock.detail).toContain("Take 5 sides");
  });

  it("counts beliefs from an answer, never from a failure", () => {
    const src = read("lib/dna.functions.ts");
    const fn = src.slice(
      src.indexOf("async function loadFactors"),
      src.indexOf("expressedBeliefCount"),
    );
    // `expressedBeliefs` is this array's length and `challengeLock` reads it, so
    // `?? []` on a blocked read is the difference between "no beliefs yet" and
    // "we could not ask".
    expect(fn).toMatch(/traded\.error \|\| expressed\.error/);
    expect(fn).toMatch(/throw new Error/);
  });

  it("tells a cold DNA cache apart from an unreachable one", () => {
    const src = read("lib/dna/viewer-dna-cache.server.ts");
    const from = src.indexOf("export async function readViewerDnaCache");
    // Bounded to this function. An unbounded slice would pick up the writer's
    // own error handling below it and pass without the reader being fixed.
    const fn = src.slice(from, src.indexOf("export interface ViewerDnaOutput", from));
    // Both used to arrive as `data == null`; `getNetwork` reads null as "still
    // computing" and renders the empty shell, forever, while every request errors.
    expect(fn).toMatch(/\{ data, error \}/);
    expect(fn).toMatch(/if \(error\) throw/);
  });

  it("carries the distinction to the only surface that can say it", () => {
    const hook = read("lib/open-calls.ts");
    expect(hook).toMatch(/isError: netError/);
    expect(hook).toMatch(/lockUnknown/);

    const rail = read("components/ChallengeRail.tsx");
    // The refusal must come BEFORE the lock branch, or the onboarding sentence
    // wins the ternary and the fix is decorative.
    expect(rail.indexOf("lockUnknown ?")).toBeGreaterThan(-1);
    expect(rail.indexOf("lockUnknown ?")).toBeLessThan(rail.indexOf("!lock.unlocked ?"));
  });

  it("names the missing variable rather than the library's argument", () => {
    const src = read("lib/supabase-clients.ts");
    expect(src).toMatch(/missingServiceSecrets/);
    expect(src).toMatch(/console\.error/);
    // "supabaseKey is required" is what this replaces: true, and actionable by
    // nobody.
    expect(src).toMatch(/service-role unavailable: missing/);
  });
});

/**
 * The health endpoint is the thing that makes this checkable in ten seconds
 * instead of an afternoon. It must never become the leak it is guarding.
 */
describe("the health endpoint reports state, never secrets", () => {
  const src = read("routes/api/public/health.ts");

  it("never reads a secret's value", () => {
    // Presence is asked of `missingServiceSecrets`, which returns NAMES. Any
    // direct `process.env.SUPABASE_...` here would be a value in scope beside a
    // JSON response, one edit away from being serialised.
    expect(src).not.toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).not.toMatch(/process\.env\.SUPABASE_URL/);
  });

  it("keeps the detail behind the operator bearer", () => {
    expect(src).toMatch(/operator \?/);
    expect(src).toMatch(/INGEST_RUN_SECRET/);
  });

  it("never echoes a database error string", () => {
    // A driver message can carry connection detail. The STATUS is the answer.
    expect(src).not.toMatch(/error\.message/);
  });

  it("answers 503 when degraded, so a status-code monitor still pages", () => {
    expect(src).toMatch(/status: ok \? 200 : 503/);
  });

  it("proves the credential works rather than merely being present", () => {
    // A rotated-but-stale key passes every presence check and fails every query.
    expect(src).toMatch(/head: true/);
    expect(src).toMatch(/serviceRoleRead/);
  });
});
