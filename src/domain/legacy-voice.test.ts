import { describe, expect, it } from "vitest";
import { modernizeTransitionCopy } from "./legacy-voice";

describe("legacy transition copy", () => {
  it("converts a capital drain into scaled PI language with the real number", () => {
    const v = modernizeTransitionCopy("Money is leaving YES", "−65% over 24H", "k1");
    expect(v.headline.toLowerCase()).not.toContain("money is leaving");
    expect(v.detail).toBe("65% of the money left in 24H.");
  });

  it("keeps a total drain distinct from a partial one", () => {
    const a = modernizeTransitionCopy("Money is leaving YES", "−100% over 24H", "k1");
    const b = modernizeTransitionCopy("Money is leaving YES", "−12% over 24H", "k1");
    expect(a.headline).not.toBe(b.headline);
  });

  it("keeps a one-trade return quiet", () => {
    const v = modernizeTransitionCopy(
      "This question is alive again",
      "First trades in a week — 1 trade today",
      "k2",
    );
    expect(v.headline.toLowerCase()).not.toContain("alive again");
    expect(v.headline.toLowerCase()).not.toContain("back from the dead");
  });

  it("unifies first believers under the company motif", () => {
    const v = modernizeTransitionCopy("NO has its first believers", "", "k3");
    expect(v.headline).toBe("NO just got company");
  });

  it("makes first capital money doing something", () => {
    const v = modernizeTransitionCopy("First capital backs NO", "", "k4");
    expect(v.headline).toBe("Money finally hit NO");
    expect(v.detail).toBe("First capital just landed on that side.");
  });

  it("leaves copy it does not recognise completely alone", () => {
    const v = modernizeTransitionCopy("Parzival wasn't done", "Another $1.8 on YES.", "k5");
    expect(v).toEqual({ headline: "Parzival wasn't done", detail: "Another $1.8 on YES." });
  });

  it("is deterministic for a given row", () => {
    const a = modernizeTransitionCopy("Money is leaving YES", "−65% over 24H", "same");
    const b = modernizeTransitionCopy("Money is leaving YES", "−65% over 24H", "same");
    expect(a).toEqual(b);
  });
});
