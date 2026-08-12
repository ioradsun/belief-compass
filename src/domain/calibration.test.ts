import { describe, it, expect } from "vitest";
import {
  CALIBRATION_SEQUENCE,
  CALIBRATION_IDS,
  CALIBRATION_TAG,
  isCalibrationMarket,
  pinnedCalibration,
} from "./calibration";

describe("the Locked 10 is a fixed, server-owned sequence", () => {
  it("is exactly the ten POV onChainMarketIds, in the authored order", () => {
    // The order IS the calibration — a reordering is a different product, so it
    // is pinned here as a regression guard.
    expect([...CALIBRATION_SEQUENCE]).toEqual([
      2832, 2833, 2834, 2835, 2836, 2837, 2838, 2839, 2840, 2841,
    ]);
  });

  it("holds ten distinct markets", () => {
    expect(CALIBRATION_SEQUENCE).toHaveLength(10);
    expect(CALIBRATION_IDS.size).toBe(10);
  });

  it("points at ids, never question text", () => {
    for (const id of CALIBRATION_SEQUENCE) expect(typeof id).toBe("number");
  });

  it("recognises its own markets and nothing else", () => {
    expect(isCalibrationMarket(2832)).toBe(true);
    expect(isCalibrationMarket(2841)).toBe(true);
    expect(isCalibrationMarket(2831)).toBe(false);
    expect(isCalibrationMarket(2842)).toBe(false);
    expect(isCalibrationMarket(999)).toBe(false);
  });

  it("labels the calibration card", () => {
    expect(CALIBRATION_TAG).toBe("Conviction Calibration");
  });
});

describe("the pin drops a question the moment it is decided", () => {
  it("offers the whole sequence, in order, to a reader who has decided nothing", () => {
    expect(pinnedCalibration(new Set())).toEqual([
      2832, 2833, 2834, 2835, 2836, 2837, 2838, 2839, 2840, 2841,
    ]);
  });

  it("removes decided markets and keeps the rest in sequence order", () => {
    // yes/no/pass all arrive here as "decided" — the pin does not care which.
    const decided = new Set([2832, 2835, 2841]);
    expect(pinnedCalibration(decided)).toEqual([2833, 2834, 2836, 2837, 2838, 2839, 2840]);
  });

  it("is empty once all ten are decided — calibration is exhausted", () => {
    expect(pinnedCalibration(new Set(CALIBRATION_SEQUENCE))).toEqual([]);
  });

  it("does not re-pin a card already seen this session, but a decision outranks a sighting", () => {
    const decided = new Set([2832]);
    const seen = new Set([2833]);
    // 2832 decided (gone for good), 2833 seen this session (gone for now).
    expect(pinnedCalibration(decided, seen)).toEqual([
      2834, 2835, 2836, 2837, 2838, 2839, 2840, 2841,
    ]);
  });

  it("ignores ids outside the sequence in either set", () => {
    expect(pinnedCalibration(new Set([999]), new Set([1000]))).toEqual([
      2832, 2833, 2834, 2835, 2836, 2837, 2838, 2839, 2840, 2841,
    ]);
  });
});
