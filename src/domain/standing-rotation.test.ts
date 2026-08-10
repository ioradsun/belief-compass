import { describe, it, expect } from "vitest";
import { rotationOffset, rotateForWindow, STANDING_ROTATE_MS } from "./standing-rotation";

const NOW = 1_000_000_000_000; // fixed clock

describe("rotationOffset", () => {
  it("does not rotate when the pool cannot fill more than one window", () => {
    expect(rotationOffset(10, 18, NOW)).toBe(0);
    expect(rotationOffset(18, 18, NOW)).toBe(0);
  });

  it("advances by a whole window each bucket", () => {
    const b = Math.floor(NOW / STANDING_ROTATE_MS);
    const next = (b + 1) * STANDING_ROTATE_MS;
    expect(rotationOffset(50, 10, b * STANDING_ROTATE_MS)).toBe((b * 10) % 50);
    expect(rotationOffset(50, 10, next)).toBe(((b + 1) * 10) % 50);
    // One heartbeat later, the window has moved a full `limit` along.
    const d =
      (rotationOffset(50, 10, next) - rotationOffset(50, 10, b * STANDING_ROTATE_MS) + 50) % 50;
    expect(d).toBe(10);
  });

  it("is stable within a bucket (no churn on a second fetch)", () => {
    const t0 = 3 * STANDING_ROTATE_MS;
    expect(rotationOffset(40, 12, t0)).toBe(rotationOffset(40, 12, t0 + STANDING_ROTATE_MS - 1));
  });

  it("wraps around the ring and stays in range", () => {
    for (let k = 0; k < 20; k++) {
      const off = rotationOffset(37, 8, k * STANDING_ROTATE_MS);
      expect(off).toBeGreaterThanOrEqual(0);
      expect(off).toBeLessThan(37);
    }
  });

  it("returns 0 on disabled rotation or bad input", () => {
    expect(rotationOffset(50, 10, NOW, 0)).toBe(0);
    expect(rotationOffset(50, 0, NOW)).toBe(0);
    expect(rotationOffset(Number.NaN, 10, NOW)).toBe(0);
  });
});

describe("rotateForWindow", () => {
  const pool = Array.from({ length: 10 }, (_, i) => i); // 0..9, strongest first

  it("returns the pool unchanged when there is nothing to rotate", () => {
    expect(rotateForWindow(pool, NOW, 10)).toEqual(pool);
    expect(rotateForWindow(pool.slice(0, 3), NOW, 10)).toEqual([0, 1, 2]);
  });

  it("puts this moment's window at the front, wrapping the rest behind it", () => {
    // Force offset 4 with limit 2: bucket*2 % 10 === 4 ⇒ bucket ≡ 2 (mod 5).
    const t = 2 * STANDING_ROTATE_MS;
    expect(rotationOffset(10, 2, t)).toBe(4);
    expect(rotateForWindow(pool, t, 2)).toEqual([4, 5, 6, 7, 8, 9, 0, 1, 2, 3]);
  });

  it("is a permutation — never drops or duplicates a candidate", () => {
    const out = rotateForWindow(pool, 7 * STANDING_ROTATE_MS, 3);
    expect([...out].sort((a, b) => a - b)).toEqual(pool);
  });
});
