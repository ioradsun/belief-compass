import { describe, it, expect } from "vitest";
import { composeTransition, type TransitionFacts } from "./transition-copy";

const facts = (o: Partial<TransitionFacts>): TransitionFacts => ({ type: null, side: null, ...o });

describe("a sideless transition never leaks the THIS SIDE placeholder", () => {
  it("says 'this market' when a capital milestone has no side to name", () => {
    const r = composeTransition(
      facts({ type: "capital_milestone", side: null, capitalDeltaUsd: 7.17 }),
    );
    expect(r.suppress).toBe(false);
    expect(r.headline).toBe("MONEY ON this market");
    expect(r.detail).toBe("$7.17 went on this market today.");
    expect(`${r.headline} ${r.detail}`.toUpperCase()).not.toContain("THIS SIDE");
  });

  it("says 'this market' when a material capital move has no side", () => {
    const r = composeTransition(
      facts({ type: "material_move", metric: "capital", side: null, capitalDeltaUsd: 5000 }),
    );
    expect(r.suppress).toBe(false);
    expect(r.headline).toBe("MONEY WENT ON this market");
    expect(r.detail).toBe("$5,000 arrived on this market today.");
    expect(`${r.headline} ${r.detail}`.toUpperCase()).not.toContain("THIS SIDE");
  });

  it("still names the side when it has one", () => {
    const r = composeTransition(
      facts({ type: "capital_milestone", side: "YES", capitalDeltaUsd: 7.17 }),
    );
    expect(r.headline).toBe("MONEY ON YES");
    expect(r.detail).toBe("$7.17 went on YES today.");
  });
});

describe("the copy the verbatim-dedup pass relies on", () => {
  it("reawakening is a fixed, market-agnostic sentence", () => {
    const r = composeTransition(facts({ type: "market_reawakened" }));
    expect(r.headline).toBe("IT WOKE UP");
    expect(r.detail).toBe("This market had gone quiet for a week. It's trading again.");
  });
});
