import { describe, it, expect } from "vitest";
import { insiderRead } from "./read";
import type { HouseReadSource } from "../house-read";

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

  it("a predicted PASS is its own read, never a degrade to learning", () => {
    expect(insiderRead(source({ preview: "PASS" })).status).toBe("pass_predicted");
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

describe("insider read — the locked reason", () => {
  it("carries only the strongest revealed reason, after the round completes", () => {
    const r = insiderRead({
      ...source({ closed: true, outcome: "correct", predicted: "YES", actual: "YES" }),
      category: "technology",
      reasons: ["You chose YES in 6 of 8 technology beliefs.", "78% of your matches back YES here."],
    });
    expect(r.reason).toBe("You chose YES in 6 of 8 technology beliefs.");
    expect(r.category).toBe("technology");
  });

  it("never attaches a reason to an open prediction", () => {
    const r = insiderRead({
      ...source({ preview: "YES" }),
      reasons: ["You chose YES in 6 of 8 technology beliefs."],
    });
    expect(r.reason).toBeUndefined();
  });
});
