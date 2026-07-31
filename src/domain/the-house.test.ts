import { describe, expect, it } from "vitest";
import {
  houseAfter,
  houseBefore,
  houseBeforeNamed,
  houseDelight,
  houseMilestone,
  houseMode,
  houseStage,
  STAGE_LABEL,
} from "@/domain/the-house";

describe("houseStage", () => {
  it("deepens with decisions", () => {
    expect(houseStage(0, null)).toBe("learning");
    expect(houseStage(4, 1)).toBe("learning");
    expect(houseStage(10, 1)).toBe("familiar");
    expect(houseStage(30, 1)).toBe("understanding");
    expect(houseStage(50, 0.7)).toBe("in_sync");
    expect(houseStage(100, 0.8)).toBe("twin");
  });

  it("gates the top stages on actually reading you right", () => {
    // Plenty of decisions, but the House keeps missing → it does not level up.
    expect(houseStage(60, 0.4)).toBe("understanding");
    expect(houseStage(100, 0.5)).toBe("understanding");
    expect(houseStage(100, 0.62)).toBe("in_sync"); // right often, not yet twin-accurate
  });

  it("labels every stage without a number", () => {
    for (const s of Object.values(STAGE_LABEL)) expect(s).not.toMatch(/\d|%|score/i);
  });
});

describe("houseMode", () => {
  it("maps bands, with high reserved for the strongest read", () => {
    expect(houseMode("STRONG_READ")).toBe("high");
    expect(houseMode("READ")).toBe("medium");
    expect(houseMode("HUNCH")).toBe("medium");
    expect(houseMode("FLYING_BLIND")).toBe("low");
    expect(houseMode("SHOT_IN_THE_DARK")).toBe("low");
    expect(houseMode(null)).toBe("low");
  });
});

describe("the voice", () => {
  it("never names a side in the generic pre-decision pool", () => {
    for (const mode of ["low", "medium", "high"] as const) {
      for (let seed = 0; seed < 20; seed++) {
        expect(houseBefore(mode, seed)).not.toMatch(/\bYES\b|\bNO\b|\bPASS\b/);
      }
    }
  });

  it("names the side only in the high-confidence reveal", () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(houseBeforeNamed("YES", seed)).toContain("YES");
      expect(houseBeforeNamed("NO", seed)).toContain("NO");
      // A named PASS speaks to conviction, never a side label.
      expect(houseBeforeNamed("PASS", seed)).not.toMatch(/\bYES\b|\bNO\b/);
    }
  });

  it("never exposes math, probability, or 'AI'", () => {
    const all = [
      ...Array.from({ length: 12 }, (_, i) => houseBefore("high", i)),
      ...Array.from({ length: 12 }, (_, i) => houseAfter(true, i)),
      ...Array.from({ length: 12 }, (_, i) => houseAfter(false, i)),
    ];
    for (const line of all) {
      expect(line.toLowerCase()).not.toMatch(/\bai\b|%|confidence|probab|algorithm|based on/);
    }
  });

  it("reacts with emotion, never disappointment, when wrong", () => {
    const wrong = Array.from({ length: 7 }, (_, i) => houseAfter(false, i));
    for (const line of wrong) {
      expect(line.toLowerCase()).not.toMatch(/wrong|bad|fail|sorry|disappoint/);
    }
  });

  it("is deterministic per seed", () => {
    expect(houseBefore("medium", 3)).toBe(houseBefore("medium", 3));
    expect(houseAfter(true, 9)).toBe(houseAfter(true, 9));
  });

  it("keeps milestones and delight rare and stage-appropriate", () => {
    expect(houseMilestone("learning", 0)).toBeNull();
    expect(houseMilestone("twin", 1)).toBe("Conviction Twin unlocked.");
    // in_sync milestones only fire on the 1-in-6 seed
    expect(houseMilestone("in_sync", 0)).not.toBeNull();
    expect(houseMilestone("in_sync", 1)).toBeNull();
    expect(houseDelight(0)).not.toBeNull();
    expect(houseDelight(1)).toBeNull();
  });
});
