import { describe, it, expect } from "vitest";
import {
  houseReadState,
  houseReadCopy,
  HOUSE_READ_LABEL,
  type HouseReadSource,
} from "./house-read";

const src = (over: Partial<HouseReadSource> = {}): HouseReadSource => ({
  connected: true,
  preview: null,
  predicted: null,
  actual: null,
  outcome: null,
  closed: false,
  foundation: null,
  ...over,
});

describe("houseReadState", () => {
  it("is learning when not connected", () => {
    expect(houseReadState(src({ connected: false }))).toEqual({ status: "learning" });
    expect(houseReadState(null)).toEqual({ status: "learning" });
  });

  it("counts the remaining picks during cold start", () => {
    expect(houseReadState(src({ foundation: { answered: 2, required: 5 } }))).toEqual({
      status: "learning",
      remainingPicks: 3,
    });
  });

  it("drops the count once the foundation is complete", () => {
    expect(houseReadState(src({ foundation: { answered: 5, required: 5 } }))).toEqual({
      status: "learning",
    });
  });

  it("calls a side when the read is strong and the round is open", () => {
    expect(houseReadState(src({ preview: "YES" }))).toEqual({
      status: "predicted",
      predictedSide: "YES",
    });
    expect(houseReadState(src({ preview: "NO" }))).toEqual({
      status: "predicted",
      predictedSide: "NO",
    });
  });

  it("never calls a PASS as a side", () => {
    expect(houseReadState(src({ preview: "PASS" }))).toEqual({ status: "learning" });
  });

  it("keeps the round sealed when there is no preview", () => {
    expect(houseReadState(src({ predicted: "YES" }))).toEqual({ status: "learning" });
  });

  it("reports a correct call after the round closes", () => {
    expect(
      houseReadState(src({ closed: true, outcome: "correct", predicted: "YES", actual: "YES" })),
    ).toEqual({ status: "correct", predictedSide: "YES", actualSide: "YES" });
  });

  it("reports a miss after the round closes", () => {
    expect(
      houseReadState(src({ closed: true, outcome: "miss", predicted: "YES", actual: "NO" })),
    ).toEqual({ status: "incorrect", predictedSide: "YES", actualSide: "NO" });
  });

  it("scores a PASS round — passing is a real answer", () => {
    expect(
      houseReadState(src({ closed: true, outcome: "miss", predicted: "YES", actual: "PASS" })),
    ).toEqual({ status: "incorrect", predictedSide: "YES", actualSide: "PASS" });
    expect(
      houseReadState(src({ closed: true, outcome: null, predicted: "PASS", actual: "PASS" })),
    ).toEqual({ status: "correct", predictedSide: "PASS", actualSide: "PASS" });
  });

  it("settles an unscored round by comparison rather than showing a dead end", () => {
    expect(
      houseReadState(src({ closed: true, outcome: "unscored", predicted: "YES", actual: "YES" })),
    ).toEqual({ status: "correct", predictedSide: "YES", actualSide: "YES" });
  });

  it("prefers the settled result over an open preview", () => {
    const s = houseReadState(
      src({ closed: true, outcome: "correct", predicted: "NO", actual: "NO", preview: "YES" }),
    );
    expect(s.status).toBe("correct");
  });
});

describe("houseReadCopy — the voice", () => {
  it("never frames the reader as hard to read", () => {
    const all = [
      houseReadCopy({ status: "learning" }),
      houseReadCopy({ status: "learning", remainingPicks: 3 }),
      houseReadCopy({ status: "predicted", predictedSide: "YES" }),
      houseReadCopy({ status: "correct", predictedSide: "YES", actualSide: "YES" }),
      houseReadCopy({ status: "incorrect", predictedSide: "YES", actualSide: "NO" }),
      houseReadCopy({ status: "closed" }),
    ];
    for (const c of all) {
      const text = `${c.label ?? ""} ${c.body} ${c.suffix}`.toLowerCase();
      expect(text).not.toContain("hard to read");
      // No internal vocabulary ever reaches the copy.
      for (const leak of ["model", "embedding", "similarity", "sample", "threshold", "score"]) {
        expect(text).not.toContain(leak);
      }
    }
  });

  it("writes a completed non-directional read without saying it is learning", () => {
    const c = houseReadCopy({ status: "closed" });
    expect(c.label).toBeNull();
    expect(c.body).toBe("This read is closed.");
  });

  it("writes the default learning line", () => {
    const c = houseReadCopy({ status: "learning" });
    expect(c.label).toBe(HOUSE_READ_LABEL);
    expect(c.body).toBe("Learning you…");
    expect(c.side).toBeNull();
  });

  it("writes the specific learning line when picks are known", () => {
    expect(houseReadCopy({ status: "learning", remainingPicks: 3 }).body).toBe(
      "3 more picks and we’ll call your move.",
    );
    expect(houseReadCopy({ status: "learning", remainingPicks: 1 }).body).toBe(
      "1 more pick and we’ll call your move.",
    );
  });

  it("names the called side so it can carry its own colour", () => {
    const c = houseReadCopy({ status: "predicted", predictedSide: "YES" });
    expect(c.label).toBe(HOUSE_READ_LABEL);
    expect(c.body).toBe("We think you’ll back ");
    expect(c.side).toBe("YES");
    expect(c.suffix).toBe("");
  });

  it("omits confidence unless a calibrated score is supplied", () => {
    expect(houseReadCopy({ status: "predicted", predictedSide: "NO" }).suffix).toBe("");
  });

  it("renders a supplied calibrated confidence", () => {
    expect(
      houseReadCopy({ status: "predicted", predictedSide: "YES", confidence: 0.78 }).suffix,
    ).toBe(" · 78% confidence");
  });

  it("speaks the result plainly, with no label", () => {
    const win = houseReadCopy({ status: "correct", predictedSide: "YES", actualSide: "YES" });
    expect(win.label).toBeNull();
    expect(win.body).toBe("The House called it.");
    expect(win.tone).toBe("correct");

    const loss = houseReadCopy({ status: "incorrect", predictedSide: "YES", actualSide: "NO" });
    expect(loss.label).toBeNull();
    expect(loss.body).toBe("You beat the House.");
    expect(loss.tone).toBe("incorrect");
  });
});
