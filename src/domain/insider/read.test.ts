import { describe, it, expect } from "vitest";
import { insiderRead } from "./read";
import type { HouseReadSource } from "../house-read";
import type { InsiderPulse } from "./types";

const source = (over: Partial<HouseReadSource> = {}): HouseReadSource => ({
  connected: true,
  preview: null,
  predicted: null,
  actual: null,
  outcome: null,
  closed: false,
  foundation: null,
  ...over,
});

const pulse = (direction: InsiderPulse["direction"]): InsiderPulse => ({
  direction,
  momentum: 0.7,
  acceleration: 0,
  activity: 0,
  participation: 0,
  capitalFlow: 0,
  imbalance: 0,
  volatility: 0,
  novelty: 0,
  lastInterestingEventAt: null,
});

describe("insider read — faithful house-read mapping", () => {
  it("a signed-out reader is still learning", () => {
    expect(insiderRead(source({ connected: false })).status).toBe("learning");
    expect(insiderRead(null).status).toBe("learning");
  });

  it("cold start reports remaining picks", () => {
    const r = insiderRead(source({ foundation: { answered: 3, required: 5 } }));
    expect(r).toMatchObject({ status: "learning", remainingPicks: 2 });
  });

  it("an open round with a strong read is a prediction", () => {
    const r = insiderRead(source({ preview: "YES" }));
    expect(r).toMatchObject({ status: "predicted", predictedSide: "YES" });
  });

  it("a settled round reports the result", () => {
    expect(
      insiderRead(source({ closed: true, outcome: "correct", predicted: "YES", actual: "YES" })),
    ).toMatchObject({ status: "correct", predictedSide: "YES", actualSide: "YES" });
    expect(
      insiderRead(source({ closed: true, outcome: "miss", predicted: "YES", actual: "NO" })),
    ).toMatchObject({ status: "incorrect", predictedSide: "YES", actualSide: "NO" });
  });
});

describe("insider read — additive market context (never changes the prediction)", () => {
  it("marks agreement when the market moves toward the predicted side", () => {
    const agree = insiderRead(source({ preview: "YES" }), { pulse: pulse("YES") });
    expect(agree).toMatchObject({ status: "predicted", predictedSide: "YES", marketAligned: true });

    const disagree = insiderRead(source({ preview: "YES" }), { pulse: pulse("NO") });
    expect(disagree.marketAligned).toBe(false);
    // The prediction itself is untouched.
    expect(disagree.predictedSide).toBe("YES");
  });

  it("adds nothing when the market has no direction or there is no prediction", () => {
    expect(insiderRead(source({ preview: "YES" }), { pulse: pulse("BALANCED") }).marketAligned).toBeUndefined();
    expect(insiderRead(source({ preview: "YES" })).marketAligned).toBeUndefined();
    // Learning state never carries alignment.
    expect(insiderRead(source(), { pulse: pulse("YES") }).marketAligned).toBeUndefined();
  });
});
