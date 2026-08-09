import { describe, it, expect } from "vitest";
import {
  scoreLiveAction,
  scoreMarketTransition,
  scoreMilestone,
  compose,
  bandOf,
  fallbackRate,
  isCovered,
  SIGNIFICANCE,
  SIGNIFICANCE_COVERAGE,
} from "./significance";
import type { FeedCandidate } from "./feed-event";

const trade = (o: Partial<FeedCandidate> = {}): FeedCandidate => ({
  kind: "trade_burst",
  side: "YES",
  amountUsd: 40,
  walletCount: 1,
  tradeCount: 1,
  marketBelievers: 200,
  ...o,
});

/** The calibration set, in the order a person would rank it. */
const CALIBRATION = () => ({
  smallBuy: scoreLiveAction(trade({ amountUsd: 20 })).score,
  bigBuy: scoreLiveAction(trade({ amountUsd: 4000 })).score,
  shortExit: scoreLiveAction(trade({ amountUsd: 30 }), { fullExit: true, daysHeld: 2 }).score,
  longExit: scoreLiveAction(trade({ amountUsd: 300 }), { fullExit: true, daysHeld: 97 }).score,
  sideSwitch: scoreLiveAction(trade({ kind: "side_shift", amountUsd: 40, walletCount: 2 })).score,
  biggestLeft: scoreLiveAction(trade({ amountUsd: 800 }), { fullExit: true, daysHeld: 60, rank: 1 })
    .score,
  routineMilestone: scoreMilestone({ threshold: 10 }).score,
  bigMilestone: scoreMilestone({ threshold: 1000, people: 40 }).score,
  minorTransition: scoreMarketTransition({ type: "losing_conviction", tier: 3 }).score,
  majorTransition: scoreMarketTransition({ type: "market_dividing", tier: 1, share: 0.4 }).score,
  marketFlip: scoreMarketTransition({ type: "majority_flipped", tier: 1, share: 0.6 }).score,
});

describe("the scale means one thing", () => {
  it("keeps every score inside 0..1", () => {
    for (const v of Object.values(CALIBRATION())) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("bounded composition can never overshoot, however many factors pile on", () => {
    const many = compose(
      0.5,
      Array.from({ length: 20 }, () => ({ weight: 0.9, value: 1 })),
    );
    expect(many.score).toBeLessThanOrEqual(1);
  });

  it("bands read the same for every family", () => {
    expect(bandOf(0.1)).toBe("low");
    expect(bandOf(0.4)).toBe("contextual");
    expect(bandOf(0.6)).toBe("notable");
    expect(bandOf(0.8)).toBe("high");
    expect(bandOf(0.95)).toBe("exceptional");
  });
});

describe("calibration — the ordering matches human judgement", () => {
  const c = CALIBRATION();

  it("a side switch outranks an ordinary entry of similar size", () => {
    expect(c.sideSwitch).toBeGreaterThan(c.smallBuy);
  });

  it("a long-held full exit outranks a short-lived small one", () => {
    expect(c.longExit).toBeGreaterThan(c.shortExit);
  });

  it("the largest believer leaving outranks a plain big buy", () => {
    expect(c.biggestLeft).toBeGreaterThan(c.bigBuy);
  });

  it("a market flip outranks a routine milestone — by a lot", () => {
    expect(c.marketFlip).toBeGreaterThan(c.routineMilestone);
    expect(c.marketFlip - c.routineMilestone).toBeGreaterThan(0.3);
  });

  it("a market flip outranks a major but ordinary transition", () => {
    expect(c.marketFlip).toBeGreaterThan(c.majorTransition);
  });

  it("a major transition outranks a minor one", () => {
    expect(c.majorTransition).toBeGreaterThan(c.minorTransition);
  });

  it("a rare milestone outranks a routine round number", () => {
    expect(c.bigMilestone).toBeGreaterThan(c.routineMilestone);
  });

  it("a routine round number never reads as important", () => {
    expect(bandOf(c.routineMilestone)).not.toBe("high");
    expect(bandOf(c.routineMilestone)).not.toBe("exceptional");
  });

  it("only the market changing its own answer reaches exceptional", () => {
    const exceptional = Object.entries(c).filter(([, v]) => bandOf(v) === "exceptional");
    expect(exceptional.map(([k]) => k)).toEqual(["marketFlip"]);
  });

  it("no single family sweeps the top — cohorts do not automatically dominate", () => {
    // A strong cohort (0.8 from conviction-cohort) must not outrank a flip.
    expect(c.marketFlip).toBeGreaterThan(0.8);
  });
});

describe("recency cannot substitute for significance", () => {
  it("an ordinary recent buy scores below an older major transition", () => {
    // The mixer weights significance 0.7 and recency 0.3, so a gap this size
    // cannot be closed by a timestamp.
    const recentBuy = scoreLiveAction(trade({ amountUsd: 20 })).score;
    const oldFlip = scoreMarketTransition({ type: "majority_flipped", tier: 1 }).score;
    expect(0.7 * oldFlip).toBeGreaterThan(0.7 * recentBuy + 0.3);
  });
});

describe("scores are explainable", () => {
  it("says why, not just how much", () => {
    const s = scoreLiveAction(trade({ amountUsd: 300 }), { fullExit: true, daysHeld: 97 });
    expect(s.reasons.some((r) => /full exit after 97d/.test(r))).toBe(true);
  });

  it("a switch says it switched", () => {
    expect(
      scoreLiveAction(trade({ kind: "side_shift", walletCount: 2 })).reasons.join(" "),
    ).toMatch(/changed sides/);
  });

  it("a flip says the answer changed", () => {
    expect(scoreMarketTransition({ type: "majority_flipped", tier: 1 }).reasons.join(" ")).toMatch(
      /answer changed/,
    );
  });
});

describe("nothing viewer-relative is ever scored at emission", () => {
  it("no scorer accepts a relationship", () => {
    const s = scoreLiveAction(trade({ relationship: "twin" }));
    const plain = scoreLiveAction(trade({}));
    // A Twin's presence may affect the feed TIER (that logic predates this and
    // gates inclusion), but this module adds no relationship term of its own.
    expect(s.reasons.join(" ")).not.toMatch(/twin|tribe|rival|opp/i);
    expect(plain.reasons.join(" ")).not.toMatch(/twin|tribe|rival|opp/i);
  });

  it("the transition and milestone scorers have no relationship input at all", () => {
    expect(
      scoreMarketTransition({ type: "market_dividing", tier: 1 }).reasons.join(" "),
    ).not.toMatch(/twin|tribe|rival/i);
    expect(scoreMilestone({ threshold: 100 }).reasons.join(" ")).not.toMatch(/twin|tribe|rival/i);
  });
});

describe("coverage registry — a new kind cannot ship unscored", () => {
  it("every feed-eligible kind declares how it is scored", () => {
    // Mirrors LIVE_KINDS plus the derived kinds grouping produces.
    const liveKinds = [
      "trade",
      "market_created",
      "position_changed_side",
      "believer_milestone",
      "tribe_doubled",
      "market_transition",
      "conviction_cohort",
    ];
    for (const k of liveKinds) expect(isCovered(k)).toBe(true);
  });

  it("also covers the kinds grouping derives from raw trades", () => {
    for (const k of ["trade_burst", "large_trade", "round_trip", "side_shift"])
      expect(isCovered(k)).toBe(true);
  });

  it("rejects an unknown kind, which is what makes the guard useful", () => {
    expect(isCovered("some_new_kind")).toBe(false);
  });

  it("declares each kind as emitted or derived, never both", () => {
    for (const v of Object.values(SIGNIFICANCE_COVERAGE))
      expect(["emitted", "derived"]).toContain(v);
  });
});

describe("fallback stays available but observable", () => {
  it("reports the share of rows still guessing", () => {
    const t = fallbackRate([
      { kind: "trade_burst", significance: 0.6 },
      { kind: "conviction_cohort", significance: 0.7 },
      { kind: "trade_burst", significance: null },
      { kind: "legacy_thing", significance: 0.5 },
    ]);
    expect(t.total).toBe(4);
    expect(t.fallback).toBe(2);
    expect(t.rate).toBe(0.5);
    expect(t.kinds).toEqual(["legacy_thing", "trade_burst"]);
  });

  it("is zero when every row is scored and covered", () => {
    const t = fallbackRate([
      { kind: "trade_burst", significance: 0.6 },
      { kind: "market_transition", significance: 0.8 },
    ]);
    expect(t.rate).toBe(0);
    expect(t.kinds).toEqual([]);
  });

  it("the fallback constant still exists for legacy rows", () => {
    expect(SIGNIFICANCE.fallback).toBe(0.5);
  });
});

describe("market anomaly as supporting evidence", () => {
  it("lifts an otherwise ordinary row without changing its family", () => {
    const plain = scoreLiveAction(trade({ amountUsd: 20 })).score;
    const anomalous = scoreLiveAction(trade({ amountUsd: 20 }), {
      signal: { informationGain: 0.6, primary: "tension" },
    }).score;
    expect(anomalous).toBeGreaterThan(plain);
  });

  it("says why", () => {
    const s = scoreLiveAction(trade({ amountUsd: 20 }), {
      signal: { informationGain: 0.42, primary: "beforePrice" },
    });
    expect(s.reasons.join(" ")).toContain("beforePrice anomaly");
  });

  it("cannot manufacture structural significance", () => {
    const s = scoreLiveAction(trade({ amountUsd: 4000 }), {
      signal: { informationGain: 1, primary: "tension" },
    });
    expect(s.score).toBeLessThanOrEqual(SIGNIFICANCE.bands.high);
    const flip = scoreMarketTransition({ type: "majority_flipped", tier: 1 }).score;
    expect(s.score).toBeLessThan(flip);
  });

  it("no signal changes nothing", () => {
    expect(scoreLiveAction(trade({ amountUsd: 20 }), { signal: null }).score).toBe(
      scoreLiveAction(trade({ amountUsd: 20 })).score,
    );
    expect(
      scoreLiveAction(trade({ amountUsd: 20 }), {
        signal: { informationGain: 0, primary: "none" },
      }).score,
    ).toBe(scoreLiveAction(trade({ amountUsd: 20 })).score);
  });
});
