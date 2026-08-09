import { describe, expect, it } from "vitest";
import { houseReadCopy, type HouseReadState } from "../../house-read";
import type { InsiderRead } from "../types";
import { INSIDER_READ_LABEL, insiderReadCopy } from "./read";

const predicted: InsiderRead = { status: "predicted", predictedSide: "YES" };

describe("insiderReadCopy", () => {
  it("says the same words as the state machine, under the Insider's name", () => {
    const engine = houseReadCopy({ status: "predicted", predictedSide: "YES" } as HouseReadState);
    const copy = insiderReadCopy(predicted);
    expect(copy.body).toBe(engine.body);
    expect(copy.side).toBe("YES");
    expect(copy.label).toBe(INSIDER_READ_LABEL);
    expect(copy.label).not.toContain("House");
  });

  it("keeps result rows plain — no label, tinted verdict", () => {
    const win = insiderReadCopy({ status: "correct", predictedSide: "NO", actualSide: "NO" });
    expect(win.label).toBeNull();
    expect(win.tone).toBe("correct");
    expect(insiderReadCopy({ status: "incorrect", predictedSide: "NO", actualSide: "YES" }).tone).toBe(
      "incorrect",
    );
  });

  it("counts down the cold start without calling the reader difficult", () => {
    const copy = insiderReadCopy({ status: "learning", remainingPicks: 3 });
    expect(copy.body).toContain("3 more picks");
    expect(copy.body.toLowerCase()).not.toContain("hard to read");
  });

  it("shows a percentage only when one was calibrated", () => {
    expect(insiderReadCopy(predicted).suffix).toBe("");
    expect(insiderReadCopy({ ...predicted, confidence: 0.78 }).suffix).toContain("78%");
  });

  it("adds market context as an aside, only when there is a call", () => {
    expect(insiderReadCopy({ ...predicted, marketAligned: true }).context).toBe("The market agrees.");
    expect(insiderReadCopy({ ...predicted, marketAligned: false }).context).toContain("other way");
    expect(insiderReadCopy(predicted).context).toBeNull();
    expect(
      insiderReadCopy({ status: "learning", remainingPicks: 2, marketAligned: true }).context,
    ).toBeNull();
  });

  it("never lets context replace the prediction", () => {
    const against = insiderReadCopy({ ...predicted, marketAligned: false });
    expect(against.side).toBe("YES");
    expect(against.body).toBe(insiderReadCopy(predicted).body);
  });

  it("degrades to learning when a status arrives without its sides", () => {
    expect(insiderReadCopy({ status: "correct" }).body).toBe("Learning you…");
    expect(insiderReadCopy({ status: "predicted", predictedSide: null }).label).toBe(
      INSIDER_READ_LABEL,
    );
  });
});
