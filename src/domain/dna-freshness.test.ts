import { describe, it, expect } from "vitest";
import {
  isComputing,
  dnaPollInterval,
  DNA_COMPUTE_POLL_MS,
  DNA_COMPUTE_MAX_ATTEMPTS,
} from "./dna-freshness";

describe("isComputing", () => {
  it("is true for the two states the worker is actually working in", () => {
    expect(isComputing({ status: "empty" })).toBe(true);
    expect(isComputing({ status: "updating" })).toBe(true);
  });

  it("is false for a settled answer", () => {
    // The whole point: a fresh cache cannot change until positions do, so
    // nothing about it is worth a timer.
    expect(isComputing({ status: "fresh", calculatedAt: "2026-08-06T00:00:00Z" })).toBe(false);
  });

  it("treats a stale cache as settled, not as in-flight", () => {
    // "stale" means the cache exists and is old — a worker-schedule matter. It
    // renders; polling it would be waiting for something nobody started.
    expect(isComputing({ status: "stale" })).toBe(false);
  });

  it("is false before the first payload lands", () => {
    // The request itself is what is in flight; a second one would not help.
    expect(isComputing(null)).toBe(false);
    expect(isComputing(undefined)).toBe(false);
  });
});

describe("dnaPollInterval", () => {
  it("polls while the worker is computing", () => {
    expect(dnaPollInterval({ status: "empty" }, 1)).toBe(DNA_COMPUTE_POLL_MS);
    expect(dnaPollInterval({ status: "updating" }, 3)).toBe(DNA_COMPUTE_POLL_MS);
  });

  it("stops the instant the answer is fresh", () => {
    // This is the forever-poll that used to run on ["dna-overview"] for the
    // whole session.
    expect(dnaPollInterval({ status: "fresh" }, 1)).toBe(false);
  });

  it("gives up rather than polling forever on a worker that never lands", () => {
    expect(dnaPollInterval({ status: "empty" }, DNA_COMPUTE_MAX_ATTEMPTS)).toBe(false);
    expect(dnaPollInterval({ status: "empty" }, DNA_COMPUTE_MAX_ATTEMPTS + 5)).toBe(false);
    // One short of the ceiling still asks.
    expect(dnaPollInterval({ status: "empty" }, DNA_COMPUTE_MAX_ATTEMPTS - 1)).toBe(
      DNA_COMPUTE_POLL_MS,
    );
  });

  it("does not poll on a missing or nonsense attempt count", () => {
    expect(dnaPollInterval({ status: "empty" }, Number.NaN)).toBe(false);
  });

  it("bounds the total wait to something a person would actually sit through", () => {
    const totalMs = DNA_COMPUTE_POLL_MS * DNA_COMPUTE_MAX_ATTEMPTS;
    expect(totalMs).toBeLessThanOrEqual(3 * 60_000);
  });
});
