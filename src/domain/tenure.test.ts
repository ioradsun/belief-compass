import { describe, it, expect } from "vitest";
import {
  TENURE,
  knownSinceDays,
  isFloorTenure,
  firstBackedIsFloor,
  currentHoldDays,
} from "./tenure";

const DAY = 86_400_000;
/** A clock 40 days after the index opened. */
const NOW = TENURE.epochMs + 40 * DAY;

/**
 * The index begins at one instant. Everything that existed on chain before it
 * landed on that timestamp, so a tenure that reaches back to the epoch is a
 * LOWER BOUND — the belief may be far older, and the product must not claim a
 * precision it does not have.
 */
describe("a tenure that reaches the epoch is a floor, not a measurement", () => {
  it("knows how much history it can evidence", () => {
    expect(knownSinceDays(NOW)).toBeCloseTo(40, 6);
  });

  it("flags a tenure pinned to the epoch", () => {
    expect(isFloorTenure(40, NOW)).toBe(true);
    expect(isFloorTenure(39.5, NOW)).toBe(true); // inside the grace band
  });

  it("leaves a tenure that genuinely started after the epoch alone", () => {
    expect(isFloorTenure(30, NOW)).toBe(false);
    expect(isFloorTenure(1, NOW)).toBe(false);
  });

  it("never flags a zero or nonsense tenure", () => {
    expect(isFloorTenure(0, NOW)).toBe(false);
    expect(isFloorTenure(-5, NOW)).toBe(false);
    expect(isFloorTenure(NaN, NOW)).toBe(false);
  });

  it("answers the same question from the timestamp itself", () => {
    expect(firstBackedIsFloor(TENURE.epochMs)).toBe(true);
    expect(firstBackedIsFloor(TENURE.epochMs - 5 * DAY)).toBe(true);
    expect(firstBackedIsFloor(TENURE.epochMs + 10 * DAY)).toBe(false);
    expect(firstBackedIsFloor(NaN)).toBe(false);
  });

  /**
   * The whole mechanism has to switch itself off. Once the index is old, a
   * 40-day tenure is nowhere near the epoch and censoring it would be its own
   * kind of dishonesty — understating a fact we can now prove.
   */
  it("stops applying on its own as the index ages", () => {
    const oneYearOn = TENURE.epochMs + 365 * DAY;
    expect(isFloorTenure(40, oneYearOn)).toBe(false);
    expect(isFloorTenure(365, oneYearOn)).toBe(true);
  });
});

/**
 * ONE DEFINITION OF "HOW LONG THIS CONVICTION HAS BEEN HELD".
 *
 * These encode the reducer's directional_since transitions as the tenure the
 * product may claim. They exist because the tape and standing facts measured
 * from `first_backed_at`, which never resets, and so told a two-day-old
 * position it was forty-three days old.
 */
describe("currentHoldDays — the only tenure the product may claim", () => {
  const NOW = Date.UTC(2026, 5, 1);
  const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

  it("counts a re-entry from the re-entry, not from the first time ever", () => {
    // Entered 43d ago, exited (directional_since cleared), re-entered 2d ago.
    expect(currentHoldDays(daysAgo(2), NOW)).toBeCloseTo(2);
  });

  it("keeps the clock running when they ADD to the same side", () => {
    // Adding preserves directional_since, so yesterday's buy changes nothing.
    expect(currentHoldDays(daysAgo(20), NOW)).toBeCloseTo(20);
  });

  it("keeps the clock running when they TRIM without exiting", () => {
    expect(currentHoldDays(daysAgo(20), NOW)).toBeCloseTo(20);
  });

  it("restarts on a flip, so a new side is a new conviction", () => {
    // YES for 20d, flipped to NO 3d ago: the NO conviction is three days old.
    expect(currentHoldDays(daysAgo(3), NOW)).toBeCloseTo(3);
  });

  it("claims nothing at all when there is no current directional holding", () => {
    // Exit clears directional_since. Zero would be a claim; null is silence.
    expect(currentHoldDays(null, NOW)).toBeNull();
    expect(currentHoldDays(undefined, NOW)).toBeNull();
    expect(currentHoldDays("not-a-date", NOW)).toBeNull();
  });

  it("never returns a negative age from a clock skew", () => {
    expect(currentHoldDays(new Date(NOW + 60_000).toISOString(), NOW)).toBe(0);
  });

  it("accepts a millisecond start as well as an ISO string", () => {
    expect(currentHoldDays(NOW - 5 * 86_400_000, NOW)).toBeCloseTo(5);
  });
});
