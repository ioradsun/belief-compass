import { describe, it, expect, beforeEach, vi } from "vitest";
import { swrCache, _clearSwrCache } from "./server-cache";

describe("swrCache", () => {
  beforeEach(() => _clearSwrCache());

  it("computes once on a cold miss and caches the result", async () => {
    const fn = vi.fn(async () => 1);
    let clock = 1000;
    const now = () => clock;
    expect(await swrCache("k", { ttlMs: 100, now }, fn)).toBe(1);
    clock = 1050; // still fresh
    expect(await swrCache("k", { ttlMs: 100, now }, fn)).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("serves stale immediately and refreshes in the background", async () => {
    let value = 1;
    const fn = vi.fn(async () => value);
    let clock = 0;
    const now = () => clock;
    await swrCache("k", { ttlMs: 100, now }, fn); // cold → 1

    value = 2;
    clock = 200; // now stale
    // Returns the STALE value synchronously-from-cache while it refreshes.
    expect(await swrCache("k", { ttlMs: 100, now }, fn)).toBe(1);
    await Promise.resolve(); // let the background refresh settle
    await Promise.resolve();
    // Next read (still within the new ttl window) sees the refreshed value.
    expect(await swrCache("k", { ttlMs: 100, now }, fn)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps the stale value if a background refresh throws", async () => {
    let mode: "ok" | "boom" = "ok";
    const fn = vi.fn(async () => {
      if (mode === "boom") throw new Error("db down");
      return 7;
    });
    let clock = 0;
    const now = () => clock;
    await swrCache("k", { ttlMs: 100, now }, fn); // 7

    mode = "boom";
    clock = 200;
    expect(await swrCache("k", { ttlMs: 100, now }, fn)).toBe(7); // stale served
    await Promise.resolve();
    await Promise.resolve();
    mode = "ok";
    clock = 250;
    // The failed refresh didn't poison the cache; a later miss recovers.
    expect(await swrCache("k", { ttlMs: 100, now }, fn)).toBe(7);
  });

  it("isolates entries by key", async () => {
    const now = () => 0;
    expect(await swrCache("a", { ttlMs: 100, now }, async () => "A")).toBe("A");
    expect(await swrCache("b", { ttlMs: 100, now }, async () => "B")).toBe("B");
  });
});
