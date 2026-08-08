import { describe, expect, it } from "vitest";
import { ago } from "./relative-time";

/**
 * `ago` reads the clock itself, so tests build timestamps relative to now. The
 * 50ms bias puts elapsed time just past the target, which keeps the truncating
 * boundaries stable against the few milliseconds the call itself takes.
 */
const at = (seconds: number) => ago(new Date(Date.now() - seconds * 1000 - 50).toISOString());

describe("ago", () => {
  it("reports seconds under a minute", () => {
    expect(at(0)).toBe("0s");
    expect(at(45)).toBe("45s");
    expect(at(59)).toBe("59s");
  });

  it("truncates rather than rounds, so nothing reads longer than it was", () => {
    expect(at(90)).toBe("1m"); // not "2m"
    expect(at(119)).toBe("1m");
  });

  it("steps up at each unit boundary", () => {
    expect(at(60)).toBe("1m");
    expect(at(3600)).toBe("1h");
    expect(at(86_400)).toBe("1d");
  });

  it("clamps future timestamps to zero instead of going negative", () => {
    expect(at(-500)).toBe("0s");
  });
});
