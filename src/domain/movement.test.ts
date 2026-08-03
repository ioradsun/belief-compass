import { describe, expect, it } from "vitest";
import { movementProgress, MOVEMENT_THRESHOLDS } from "./movement";

describe("movementProgress", () => {
  it("classifies by unique believers through every stage", () => {
    expect(movementProgress(0).stage).toBe("seed");
    expect(movementProgress(1).stage).toBe("seed");
    expect(movementProgress(2).stage).toBe("spark");
    expect(movementProgress(4).stage).toBe("spark");
    expect(movementProgress(5).stage).toBe("forming");
    expect(movementProgress(14).stage).toBe("forming");
    expect(movementProgress(15).stage).toBe("tribe");
    expect(movementProgress(49).stage).toBe("tribe");
    expect(movementProgress(50).stage).toBe("movement");
    expect(movementProgress(500).stage).toBe("movement");
  });

  it("counts believers still needed for the next stage, in human words", () => {
    const m = movementProgress(11); // forming, tribe at 15
    expect(m.nextLabel).toBe("Tribe");
    expect(m.toNext).toBe(4);
    expect(m.note).toBe("4 more believers to become a Tribe.");
  });

  it("singularises 'believer' at exactly one to go", () => {
    expect(movementProgress(14).note).toBe("1 more believer to become a Tribe.");
  });

  it("invites the first believer, and marks 'just you' at one", () => {
    expect(movementProgress(0).note).toContain("Be the first");
    expect(movementProgress(1).note).toContain("Just you so far");
  });

  it("progress spans the current stage's floor to the next stage's floor", () => {
    // forming floor 5, tribe floor 15 → 10 believers is halfway.
    expect(movementProgress(10).progress).toBeCloseTo(0.5, 5);
    expect(movementProgress(5).progress).toBeCloseTo(0, 5);
  });

  it("tops out cleanly at Movement", () => {
    const m = movementProgress(120);
    expect(m.nextStage).toBeNull();
    expect(m.toNext).toBe(0);
    expect(m.progress).toBe(1);
    expect(m.note).toContain("still growing");
  });

  it("is robust to junk input", () => {
    expect(movementProgress(NaN).believers).toBe(0);
    expect(movementProgress(-5).stage).toBe("seed");
  });

  it("keeps thresholds as the single source of truth", () => {
    expect(movementProgress(MOVEMENT_THRESHOLDS.tribe).stage).toBe("tribe");
    expect(movementProgress(MOVEMENT_THRESHOLDS.tribe - 1).stage).toBe("forming");
  });
});
