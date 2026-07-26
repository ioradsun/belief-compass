import { describe, it, expect } from "vitest";
import {
  classifyEvent,
  momentumAcceleration,
  structuralAchievement,
  MOMENTUM_MIN_RATIO,
  ACHIEVEMENT_MIN_BELIEVERS,
  ACHIEVEMENT_TOP_N,
  type ClassifyInput,
} from "./feed-gates";

const cbase: ClassifyInput = {
  behavior: "flow",
  actorRole: "market",
  hasConflict: false,
  isAccelerating: false,
  isAchievement: false,
};

describe("classifyEvent — the closed six-type taxonomy", () => {
  it("a viewer-relative actor is a Tribe event first of all", () => {
    expect(classifyEvent({ ...cbase, actorRole: "people", behavior: "increase" })).toBe("tribe");
    expect(classifyEvent({ ...cbase, actorRole: "opp", behavior: "reduce" })).toBe("tribe");
  });
  it("a passed structural-achievement gate outranks conflict and momentum", () => {
    expect(
      classifyEvent({ ...cbase, isAchievement: true, hasConflict: true, isAccelerating: true }),
    ).toBe("achievement");
    expect(classifyEvent({ ...cbase, behavior: "milestone" })).toBe("achievement");
  });
  it("momentum only when the accel gate passed (never a raw count)", () => {
    expect(classifyEvent({ ...cbase, isAccelerating: true })).toBe("momentum");
    expect(classifyEvent({ ...cbase, behavior: "accelerate" })).toBe("momentum");
  });
  it("gated conflict beats plain recruitment/capital", () => {
    expect(classifyEvent({ ...cbase, hasConflict: true, behavior: "flow" })).toBe("conflict");
  });
  it("people arriving is recruitment; money moving is capital", () => {
    expect(classifyEvent({ ...cbase, behavior: "born", actorRole: "creator" })).toBe("recruitment");
    expect(classifyEvent({ ...cbase, behavior: "joined", actorRole: "market" })).toBe(
      "recruitment",
    );
    expect(classifyEvent({ ...cbase, behavior: "flow", actorRole: "market" })).toBe("capital");
    expect(classifyEvent({ ...cbase, behavior: "reduce", actorRole: "market" })).toBe("capital");
  });
});

describe("momentumAcceleration — rate rising window-over-window, gated", () => {
  it("returns the ratio when the recent rate materially exceeds the prior", () => {
    expect(momentumAcceleration(10, 4)).toBeCloseTo(2.5, 5);
  });
  it("is null with no prior baseline — new is not accelerating", () => {
    expect(momentumAcceleration(10, 0)).toBeNull();
    expect(momentumAcceleration(10, 1)).toBeNull(); // below MOMENTUM_MIN_PRIOR
  });
  it("is null when flat or slowing", () => {
    expect(momentumAcceleration(4, 4)).toBeNull();
    expect(momentumAcceleration(3, 5)).toBeNull();
  });
  it("is null when rising but below the minimum ratio", () => {
    // 5 vs 4 = 1.25×, exactly the floor → counts; 5 vs 4.5 would be below but counts are ints.
    expect(momentumAcceleration(5, 4)).toBeCloseTo(MOMENTUM_MIN_RATIO, 5);
    expect(momentumAcceleration(5, 5)).toBeNull();
  });
});

describe("structuralAchievement — structural only, never P&L or timing", () => {
  it("labels a top-slice market present-tense and provable", () => {
    expect(structuralAchievement({ rank: 1, believers: 240 })).toBe(
      "the most-backed belief right now — 240 believers.",
    );
    expect(structuralAchievement({ rank: 3, believers: 88 })).toBe(
      "#3 most-backed belief right now — 88 believers.",
    );
  });
  it("is null below the believer floor (a top slot on noise is not a milestone)", () => {
    expect(structuralAchievement({ rank: 1, believers: ACHIEVEMENT_MIN_BELIEVERS - 1 })).toBeNull();
  });
  it("is null outside the top slice", () => {
    expect(structuralAchievement({ rank: ACHIEVEMENT_TOP_N + 1, believers: 500 })).toBeNull();
    expect(structuralAchievement({ rank: 0, believers: 500 })).toBeNull();
  });
  it("never emits a timing or profit claim", () => {
    const s = structuralAchievement({ rank: 2, believers: 120 }) ?? "";
    expect(/early|beat|profit|gain|won|up \d|\$/i.test(s)).toBe(false);
  });
});
