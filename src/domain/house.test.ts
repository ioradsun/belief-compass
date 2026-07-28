import { describe, it, expect } from "vitest";
import {
  predictHouse,
  scoreHouse,
  foldRecord,
  revealHeadline,
  dnaContribution,
  directionalAccuracy,
  MIN_CONFIDENCE,
  type HouseSignals,
} from "./house";

const base: HouseSignals = {
  connected: true,
  category: "Technology",
  totalAnswers: 20,
  overall: { yes: 10, no: 8, skip: 2 },
  inCategory: { yes: 0, no: 0, skip: 0 },
};

describe("predictHouse — honest no-read states", () => {
  it("refuses without a connected profile", () => {
    const r = predictHouse({ ...base, connected: false });
    expect(r.action).toBeNull();
    expect(r.noRead?.kind).toBe("no_user");
  });

  it("cold-starts a new user with progress", () => {
    const r = predictHouse({ ...base, totalAnswers: 2, overall: { yes: 1, no: 1, skip: 0 } });
    expect(r.noRead?.kind).toBe("cold_start");
    expect(r.noRead?.detail[0]).toContain("2 of 5");
  });

  it("calls a never-seen category new territory", () => {
    const r = predictHouse(base);
    expect(r.noRead?.kind).toBe("new_category");
  });

  it("won't bluff when personal history and matches disagree", () => {
    const r = predictHouse({
      ...base,
      inCategory: { yes: 9, no: 1, skip: 0 },
      relationship: { yes: 0, no: 9, confidence: 0.9 },
    });
    expect(r.action).toBeNull();
    expect(r.noRead?.kind).toBe("conflicting");
    expect(r.noRead?.detail.length).toBeGreaterThan(1);
  });

  it("returns weak_sample rather than a coin flip", () => {
    const r = predictHouse({ ...base, inCategory: { yes: 1, no: 1, skip: 0 } });
    expect(r.action).toBeNull();
    expect(r.noRead?.kind).toBe("weak_sample");
  });
});

describe("predictHouse — reads", () => {
  it("predicts the user's own directional pattern with real reasons", () => {
    const r = predictHouse({ ...base, inCategory: { yes: 1, no: 9, skip: 0 } });
    expect(r.action).toBe("NO");
    expect(r.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    expect(r.reasons[0]).toContain("9 of 10");
    expect(r.reasons.length).toBeLessThanOrEqual(3);
  });

  it("predicts SKIP from repeated category skips", () => {
    const r = predictHouse({ ...base, inCategory: { yes: 0, no: 1, skip: 7 } });
    expect(r.action).toBe("SKIP");
    expect(r.reasons[0]).toContain("skipped 7");
  });

  it("skips drag directional confidence down, never up", () => {
    const clean = predictHouse({ ...base, inCategory: { yes: 8, no: 1, skip: 0 } });
    const skippy = predictHouse({ ...base, inCategory: { yes: 8, no: 1, skip: 2 } });
    expect(skippy.confidence).toBeLessThan(clean.confidence);
  });

  it("still reads from personal history when relationship data is missing", () => {
    const r = predictHouse({ ...base, inCategory: { yes: 10, no: 0, skip: 0 }, relationship: null });
    expect(r.action).toBe("YES");
  });

  it("ignores relationship evidence with no confidence behind it", () => {
    const r = predictHouse({
      ...base,
      inCategory: { yes: 0, no: 0, skip: 1 },
      relationship: { yes: 3, no: 0, confidence: 0 },
    });
    expect(r.action).toBeNull();
  });

  it("is deterministic — the same signals lock the same read", () => {
    const s = { ...base, inCategory: { yes: 9, no: 1, skip: 0 } };
    expect(predictHouse(s)).toEqual(predictHouse(s));
  });
});

describe("scoring", () => {
  it("scores exact three-way matches", () => {
    expect(scoreHouse("YES", "YES")).toBe("correct");
    expect(scoreHouse("NO", "YES")).toBe("miss");
  });

  it("counts a correct SKIP prediction as a hit", () => {
    expect(scoreHouse("SKIP", "SKIP")).toBe("correct");
  });

  it("counts a wrong SKIP prediction as a miss", () => {
    expect(scoreHouse("SKIP", "YES")).toBe("miss");
    expect(scoreHouse("NO", "SKIP")).toBe("miss");
  });

  it("never scores a refused read", () => {
    expect(scoreHouse(null, "YES")).toBe("unscored");
    expect(foldRecord([{ predicted: null, actual: "YES" }])).toMatchObject({
      correct: 0,
      miss: 0,
      noRead: 1,
    });
  });

  it("ignores unanswered markets in the record", () => {
    expect(foldRecord([{ predicted: "YES", actual: null }]).correct).toBe(0);
  });

  it("folds a record with streaks and per-action accuracy", () => {
    const rec = foldRecord([
      { predicted: "YES", actual: "YES" },
      { predicted: "NO", actual: "NO" },
      { predicted: "SKIP", actual: "YES" },
    ]);
    expect(rec.correct).toBe(2);
    expect(rec.miss).toBe(1);
    expect(rec.streak).toBe(2);
    expect(rec.byAction.SKIP).toEqual({ correct: 0, total: 1 });
    expect(directionalAccuracy(rec)).toBe(1);
  });

  it("frames a held read without calling the user wrong", () => {
    expect(revealHeadline("NO", "SKIP").title).toBe("You held your read");
    expect(revealHeadline("SKIP", "YES").title).toBe("You surprised the House");
    expect(revealHeadline("NO", "NO").title).toBe("The House read you");
  });
});

describe("DNA contribution", () => {
  it("keeps SKIP behavioral and YES/NO directional", () => {
    expect(dnaContribution("SKIP")).toBe("behavioral");
    expect(dnaContribution("YES")).toBe("directional");
    expect(dnaContribution("NO")).toBe("directional");
  });
});
