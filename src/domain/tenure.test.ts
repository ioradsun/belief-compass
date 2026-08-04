import { describe, it, expect } from "vitest";
import { TENURE, knownSinceDays, isFloorTenure, firstBackedIsFloor } from "./tenure";

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
