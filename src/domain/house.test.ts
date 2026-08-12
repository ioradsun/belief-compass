import { describe, it, expect } from "vitest";
import {
  predictHouse,
  scoreHouse,
  foldRecord,
  revealHeadline,
  dnaContribution,
  directionalAccuracy,
  confidenceBand,
  BAND_COPY,
  MIN_CONFIDENCE,
  FOUNDATION_ANSWERS,
  FOUNDATION_MAPPINGS,
  FOUNDATION_MAPPING_VERSION,
  applyFoundationAnswer,
  accumulateDimensions,
  nextFoundation,
  type HouseSignals,
} from "./house";

describe("foundation cold-start", () => {
  it("defines exactly the required, moderately-worded POVs", () => {
    expect(FOUNDATION_MAPPINGS).toHaveLength(FOUNDATION_ANSWERS);
    for (const m of FOUNDATION_MAPPINGS) {
      expect(m.prompt).not.toMatch(/almost all|completely|feared/i);
      expect(Object.keys(m.dimensions.YES).length).toBeGreaterThan(0);
      expect(Object.keys(m.dimensions.NO).length).toBeGreaterThan(0);
    }
  });
  it("YES and NO push a dimension in opposite directions", () => {
    const m = FOUNDATION_MAPPINGS[0];
    const yes = applyFoundationAnswer(m, "YES");
    const no = applyFoundationAnswer(m, "NO");
    expect(Math.sign(yes.interpersonalTrust)).toBe(-Math.sign(no.interpersonalTrust));
  });
  it("accumulates contributions across answers", () => {
    const v = accumulateDimensions([
      applyFoundationAnswer(FOUNDATION_MAPPINGS[0], "YES"),
      applyFoundationAnswer(FOUNDATION_MAPPINGS[0], "YES"),
    ]);
    expect(v.interpersonalTrust).toBeCloseTo(-1.1, 6);
  });
  it("walks through the POVs and ends when all are answered", () => {
    expect(nextFoundation([])?.key).toBe(FOUNDATION_MAPPINGS[0].key);
    const allButLast = FOUNDATION_MAPPINGS.slice(0, -1).map((m) => m.key);
    expect(nextFoundation(allButLast)?.key).toBe(FOUNDATION_MAPPINGS.at(-1)!.key);
    expect(nextFoundation(FOUNDATION_MAPPINGS.map((m) => m.key))).toBeNull();
  });
  it("has a stable mapping version", () => {
    expect(FOUNDATION_MAPPING_VERSION).toBe(1);
  });
});

describe("confidence bands", () => {
  it("maps confidence to the right band at every threshold", () => {
    expect(confidenceBand(0.42)).toBe("SHOT_IN_THE_DARK");
    expect(confidenceBand(0.5)).toBe("FLYING_BLIND");
    expect(confidenceBand(0.59)).toBe("FLYING_BLIND");
    expect(confidenceBand(0.6)).toBe("HUNCH");
    expect(confidenceBand(0.69)).toBe("HUNCH");
    expect(confidenceBand(0.7)).toBe("READ");
    expect(confidenceBand(0.84)).toBe("READ");
    expect(confidenceBand(0.85)).toBe("STRONG_READ");
    expect(confidenceBand(1)).toBe("STRONG_READ");
  });
  it("has copy for every band that never names a side", () => {
    for (const band of Object.keys(BAND_COPY) as (keyof typeof BAND_COPY)[]) {
      expect(BAND_COPY[band].headline.length).toBeGreaterThan(0);
      expect(BAND_COPY[band].line).not.toMatch(/\b(YES|NO)\b/);
    }
  });
});

const base: HouseSignals = {
  connected: true,
  category: "Technology",
  totalAnswers: 20,
  overall: { yes: 10, no: 8, pass: 2 },
  inCategory: { yes: 0, no: 0, pass: 0 },
};

describe("predictHouse — honest no-read states", () => {
  it("refuses without a connected profile", () => {
    const r = predictHouse({ ...base, connected: false });
    expect(r.action).toBeNull();
    expect(r.noRead?.kind).toBe("no_user");
  });

  it("cold-starts a new user with progress", () => {
    const r = predictHouse({ ...base, totalAnswers: 2, overall: { yes: 1, no: 1, pass: 0 } });
    expect(r.noRead?.kind).toBe("cold_start");
    expect(r.noRead?.detail[0]).toContain("2 of 5");
  });

  it("still calls a never-seen category from the player's overall lean", () => {
    const r = predictHouse({ ...base, overall: { yes: 2, no: 1, pass: 0 } });
    expect(r.noRead).toBeNull();
    expect(r.action).toBe("YES");
  });

  it("still reads a well-known player in a brand new category, from their overall lean", () => {
    const r = predictHouse({
      ...base,
      totalAnswers: 30,
      overall: { yes: 26, no: 2, pass: 2 },
      inCategory: { yes: 0, no: 0, pass: 0 },
    });
    expect(r.noRead).toBeNull();
    expect(r.action).toBe("YES");
  });

  it("predicts a sit-out when personal history and matches disagree", () => {
    const r = predictHouse({
      ...base,
      inCategory: { yes: 9, no: 1, pass: 0 },
      relationship: { yes: 0, no: 9, confidence: 0.9 },
    });
    expect(r.action).toBe("PASS");
    expect(r.noRead).toBeNull();
    expect(r.reasons.length).toBeGreaterThan(1);
  });

  it("never refuses a calibrated player — an even split still gets a call", () => {
    const r = predictHouse({ ...base, inCategory: { yes: 1, no: 1, pass: 0 } });
    expect(r.noRead).toBeNull();
    expect(r.action).not.toBeNull();
  });

  it("reads a sit-out when nothing anywhere leans", () => {
    const r = predictHouse({
      ...base,
      totalAnswers: 6,
      overall: { yes: 0, no: 0, pass: 6 },
      inCategory: { yes: 0, no: 0, pass: 0 },
    });
    expect(r.action).toBe("PASS");
    expect(r.noRead).toBeNull();
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe("predictHouse — reads", () => {
  it("predicts the user's own directional pattern with real reasons", () => {
    const r = predictHouse({ ...base, inCategory: { yes: 1, no: 9, pass: 0 } });
    expect(r.action).toBe("NO");
    expect(r.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    expect(r.reasons[0]).toContain("9 of 10");
    expect(r.reasons.length).toBeLessThanOrEqual(3);
  });

  it("predicts PASS from repeated category passes", () => {
    const r = predictHouse({ ...base, inCategory: { yes: 0, no: 1, pass: 7 } });
    expect(r.action).toBe("PASS");
    expect(r.reasons[0]).toContain("passed on 7");
  });

  it("passes drag directional confidence down, never up", () => {
    const clean = predictHouse({ ...base, inCategory: { yes: 8, no: 1, pass: 0 } });
    const passy = predictHouse({ ...base, inCategory: { yes: 8, no: 1, pass: 2 } });
    expect(passy.confidence).toBeLessThan(clean.confidence);
  });

  it("still reads from personal history when relationship data is missing", () => {
    const r = predictHouse({
      ...base,
      inCategory: { yes: 10, no: 0, pass: 0 },
      relationship: null,
    });
    expect(r.action).toBe("YES");
  });

  it("ignores relationship evidence with no confidence behind it", () => {
    const r = predictHouse({
      ...base,
      inCategory: { yes: 0, no: 0, pass: 1 },
      relationship: { yes: 3, no: 0, confidence: 0 },
    });
    // Falls back to the player's own overall lean, not the zero-confidence matches.
    expect(r.action).toBe("YES");
  });

  it("is deterministic — the same signals lock the same read", () => {
    const s = { ...base, inCategory: { yes: 9, no: 1, pass: 0 } };
    expect(predictHouse(s)).toEqual(predictHouse(s));
  });
});

describe("scoring", () => {
  it("scores exact three-way matches", () => {
    expect(scoreHouse("YES", "YES")).toBe("correct");
    expect(scoreHouse("NO", "YES")).toBe("miss");
  });

  it("counts a correct PASS prediction as a hit", () => {
    expect(scoreHouse("PASS", "PASS")).toBe("correct");
  });

  it("counts a wrong PASS prediction as a miss", () => {
    expect(scoreHouse("PASS", "YES")).toBe("miss");
    expect(scoreHouse("NO", "PASS")).toBe("miss");
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
      { predicted: "PASS", actual: "YES" },
    ]);
    expect(rec.correct).toBe(2);
    expect(rec.miss).toBe(1);
    expect(rec.streak).toBe(2);
    expect(rec.byAction.PASS).toEqual({ correct: 0, total: 1 });
    expect(directionalAccuracy(rec)).toBe(1);
  });

  it("frames a held read without calling the user wrong", () => {
    expect(revealHeadline("NO", "PASS").title).toBe("You held your read");
    expect(revealHeadline("PASS", "YES").title).toBe("You surprised the House");
    expect(revealHeadline("NO", "NO").title).toBe("The House read you");
  });
});

describe("DNA contribution", () => {
  it("keeps PASS behavioral and YES/NO directional", () => {
    expect(dnaContribution("PASS")).toBe("behavioral");
    expect(dnaContribution("YES")).toBe("directional");
    expect(dnaContribution("NO")).toBe("directional");
  });
});
