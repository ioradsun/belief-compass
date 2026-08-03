import { describe, expect, it } from "vitest";
import { composeShareImpact } from "./share-impact";

describe("composeShareImpact", () => {
  it("leads with believers and folds in capital (the spec headline)", () => {
    const r = composeShareImpact({ opens: 40, believers: 18, capitalUsd: 2840 });
    expect(r.headline).toBe("Your link brought 18 believers and $2.8k into this market.");
    expect(r.hasImpact).toBe(true);
    expect(r.sub).toBe("40 people opened it in all.");
  });

  it("singularises one believer and drops the sub when opens == believers", () => {
    const r = composeShareImpact({ opens: 1, believers: 1, capitalUsd: 0 });
    expect(r.headline).toBe("Your link brought 1 believer into this market.");
    expect(r.sub).toBeNull();
  });

  it("switches scope to the whole platform", () => {
    const r = composeShareImpact({ opens: 5, believers: 3, capitalUsd: 500, scope: "all" });
    expect(r.headline).toBe("Your link brought 3 believers and $500 onto Conviction.");
  });

  it("is honest when people opened but nobody has taken a side", () => {
    const r = composeShareImpact({ opens: 7, believers: 0, capitalUsd: 0 });
    expect(r.headline).toBe("7 people have opened your link.");
    expect(r.sub).toContain("No side taken yet");
    expect(r.hasImpact).toBe(false);
  });

  it("singularises a lone opener", () => {
    expect(composeShareImpact({ opens: 1, believers: 0, capitalUsd: 0 }).headline).toBe(
      "1 person has opened your link.",
    );
  });

  it("invites, never shows a bare zero, when nothing has happened", () => {
    const r = composeShareImpact({ opens: 0, believers: 0, capitalUsd: 0 });
    expect(r.headline).toBe("Stand on it and watch your tribe arrive.");
    expect(r.hasImpact).toBe(false);
  });

  it("formats capital compactly across magnitudes", () => {
    expect(composeShareImpact({ opens: 2, believers: 2, capitalUsd: 950 }).headline).toContain(
      "$950",
    );
    expect(composeShareImpact({ opens: 2, believers: 2, capitalUsd: 24_000 }).headline).toContain(
      "$24k",
    );
    expect(
      composeShareImpact({ opens: 2, believers: 2, capitalUsd: 1_500_000 }).headline,
    ).toContain("$1.5M");
  });

  it("treats nonsense (negatives / NaN) as nothing", () => {
    const r = composeShareImpact({ opens: -3, believers: NaN, capitalUsd: -10 });
    expect(r.hasImpact).toBe(false);
    expect(r.headline).toBe("Stand on it and watch your tribe arrive.");
  });
});
