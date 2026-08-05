import { describe, expect, it } from "vitest";
import { composeMarketRow } from "./market-row";

describe("composeMarketRow", () => {
  it("leads with the current YES side and its margin", () => {
    const r = composeMarketRow({ yesPct: 62, believers: 18 });
    expect(r.leadSide).toBe("YES");
    expect(r.leadPct).toBe(62);
    expect(r.stateText).toBe("62% YES");
    expect(r.crowdText).toBe("18 believers");
    expect(r.emptyText).toBeNull();
  });

  it("flips to NO and reports the NO margin when NO is ahead", () => {
    const r = composeMarketRow({ yesPct: 42, believers: 5 });
    expect(r.leadSide).toBe("NO");
    expect(r.stateText).toBe("58% NO");
  });

  it("breaks a dead heat toward YES (the affirmative)", () => {
    expect(composeMarketRow({ yesPct: 50, believers: 4 }).stateText).toBe("50% YES");
  });

  it("singularises a lone believer", () => {
    expect(composeMarketRow({ yesPct: 70, believers: 1 }).crowdText).toBe("1 believer");
  });

  it("shows the crowd even when the market is unpriced", () => {
    const r = composeMarketRow({ yesPct: null, believers: 3 });
    expect(r.stateText).toBeNull();
    expect(r.crowdText).toBe("3 believers");
    expect(r.emptyText).toBeNull();
  });

  it("invites, never blanks, a market with no state at all", () => {
    const r = composeMarketRow({ yesPct: null, believers: 0 });
    expect(r.stateText).toBeNull();
    expect(r.crowdText).toBeNull();
    expect(r.emptyText).toBe("New — no side yet");
  });

  it("clamps a nonsense percentage and ignores negative crowds", () => {
    const r = composeMarketRow({ yesPct: 140, believers: -2 });
    expect(r.leadPct).toBeNull();
    expect(r.stateText).toBeNull();
    expect(r.crowdText).toBeNull();
    expect(r.emptyText).toBe("New — no side yet");
  });

  it("never claims a side on a market nobody is in", () => {
    const r = composeMarketRow({ yesPct: 0, believers: 0 });
    expect(r.stateText).toBeNull();
    expect(r.emptyText).toBe("New — no side yet");
  });
});
