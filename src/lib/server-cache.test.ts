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

/**
 * A COLD INSTANCE MUST DO THE WORK ONCE.
 *
 * The cold branch said "compute once, then cache" and did not: the entry is
 * written only after `fn()` resolves, so every caller arriving during the first
 * computation found the key absent and started another. On a cold serverless
 * instance that is the normal path, not a rare race — the SSR loader, the
 * client's hydration fetch and the client's 4s fallback all land inside the same
 * window and each ran a full feed build. Slow first load, fast refresh.
 */
describe("single flight", () => {
  it("runs one computation for concurrent cold callers", async () => {
    _clearSwrCache();
    let runs = 0;
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const fn = () => {
      runs += 1;
      return gate;
    };

    // The three callers a cold instance actually produces, all before the first
    // has finished.
    const a = swrCache("k", { ttlMs: 1000 }, fn);
    const b = swrCache("k", { ttlMs: 1000 }, fn);
    const c = swrCache("k", { ttlMs: 1000 }, fn);
    release("value");

    expect(await Promise.all([a, b, c])).toEqual(["value", "value", "value"]);
    expect(runs).toBe(1);
  });

  it("caches the shared result, so the next caller does no work at all", async () => {
    _clearSwrCache();
    let runs = 0;
    const fn = async () => {
      runs += 1;
      return "v";
    };
    await Promise.all([swrCache("k", { ttlMs: 1000 }, fn), swrCache("k", { ttlMs: 1000 }, fn)]);
    await swrCache("k", { ttlMs: 1000 }, fn);
    expect(runs).toBe(1);
  });

  it("never caches a failure, and every waiter hears about it", async () => {
    _clearSwrCache();
    let runs = 0;
    const boom = () => {
      runs += 1;
      return Promise.reject(new Error("db down"));
    };
    const a = swrCache("k", { ttlMs: 1000 }, boom);
    const b = swrCache("k", { ttlMs: 1000 }, boom);
    await expect(a).rejects.toThrow("db down");
    await expect(b).rejects.toThrow("db down");
    expect(runs).toBe(1);

    // The slot is clear, so the next request is a real retry rather than an
    // await on a promise that already rejected.
    const ok = await swrCache("k", { ttlMs: 1000 }, async () => "recovered");
    expect(ok).toBe("recovered");
  });

  it("keeps separate keys independent", async () => {
    _clearSwrCache();
    let runs = 0;
    const fn = async () => {
      runs += 1;
      return "v";
    };
    await Promise.all([swrCache("a", { ttlMs: 1000 }, fn), swrCache("b", { ttlMs: 1000 }, fn)]);
    expect(runs).toBe(2);
  });
});

describe("a build that is slow but alive", () => {
  it("is not turned into an error by the wedge watchdog", async () => {
    vi.useFakeTimers();
    _clearSwrCache();
    let settle!: (v: string) => void;
    const p = swrCache("slow", { ttlMs: 1000 }, () => new Promise<string>((r) => (settle = r)));
    // Well past the 10s in-flight window — the slot is expired, the build is not.
    await vi.advanceTimersByTimeAsync(12_000);
    settle("real content");
    await expect(p).resolves.toBe("real content");
    vi.useRealTimers();
  });

  it("lets a later caller start fresh instead of joining the expired build", async () => {
    vi.useFakeTimers();
    _clearSwrCache();
    const calls: Array<(v: string) => void> = [];
    const fn = () => new Promise<string>((r) => calls.push(r));
    void swrCache("slow2", { ttlMs: 1000 }, fn);
    await vi.advanceTimersByTimeAsync(12_000);
    const second = swrCache("slow2", { ttlMs: 1000 }, fn);
    expect(calls).toHaveLength(2);
    calls[1]!("fresh");
    await expect(second).resolves.toBe("fresh");
    vi.useRealTimers();
  });
});
