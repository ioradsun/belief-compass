import { describe, expect, it } from "vitest";
import type { InsiderRead } from "../types";
import { INSIDER_READ_LABEL, insiderReadCopy } from "./read";

const predicted: InsiderRead = { status: "predicted", predictedSide: "YES" };

describe("insiderReadCopy — predict first", () => {
  it("names the side in one direct sentence, with no evidence attached", () => {
    const copy = insiderReadCopy(predicted);
    expect(copy.label).toBe(INSIDER_READ_LABEL);
    expect(copy.body).toBe("We have you on ");
    expect(copy.side).toBe("YES");
    expect(copy.reason).toBeNull();
  });

  it("treats a predicted PASS as a real read", () => {
    const copy = insiderReadCopy({ status: "pass_predicted" });
    expect(copy.body).toBe("We have you sitting this one out.");
    expect(copy.label).toBe(INSIDER_READ_LABEL);
  });

  it("never mentions the market or a percentage", () => {
    const all = [
      insiderReadCopy(predicted),
      insiderReadCopy({ status: "pass_predicted" }),
      insiderReadCopy({ status: "learning", remainingPicks: 2 }),
    ];
    for (const c of all) {
      const text = `${c.label ?? ""} ${c.body} ${c.reason ?? ""}`.toLowerCase();
      expect(text).not.toContain("market");
      expect(text).not.toContain("%");
      expect(text).not.toContain("we think you");
    }
  });
});

describe("insiderReadCopy — prove it after", () => {
  it("states the verdict flatly and shows the one locked reason", () => {
    const win = insiderReadCopy({
      status: "correct",
      predictedSide: "YES",
      actualSide: "YES",
      reason: "You chose YES in 6 of 8 technology beliefs.",
    });
    expect(win.body).toBe("Called it.");
    expect(win.tone).toBe("correct");
    expect(win.label).toBeNull();
    expect(win.reason).toBe("You chose YES in 6 of 8 technology beliefs.");
  });

  it("compares the pattern with the choice when the read missed", () => {
    const loss = insiderReadCopy({
      status: "incorrect",
      predictedSide: "YES",
      actualSide: "NO",
      category: "technology",
    });
    expect(loss.body).toBe("You broke the pattern.");
    expect(loss.tone).toBe("incorrect");
    expect(loss.reason).toBe("Your technology history leaned YES. You chose NO.");
  });

  it("still speaks without a category", () => {
    expect(
      insiderReadCopy({ status: "incorrect", predictedSide: "NO", actualSide: "YES" }).reason,
    ).toBe("Your history leaned NO. You chose YES.");
  });
});

describe("insiderReadCopy — learning", () => {
  it("counts down measurably instead of saying 'learning you'", () => {
    const copy = insiderReadCopy({ status: "learning", remainingPicks: 2 });
    expect(copy.body).toBe("2 more picks. Then we call your next move.");
    expect(copy.body.toLowerCase()).not.toContain("learning you");
    expect(insiderReadCopy({ status: "learning", remainingPicks: 1 }).body).toBe(
      "1 more pick. Then we call your next move.",
    );
  });

  it("degrades to learning when a status arrives without its sides", () => {
    expect(insiderReadCopy({ status: "correct" }).body).toContain("Then we call your next move.");
    expect(insiderReadCopy({ status: "predicted", predictedSide: null }).label).toBe(
      INSIDER_READ_LABEL,
    );
  });
});
