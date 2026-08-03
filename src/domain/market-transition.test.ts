import { describe, it, expect } from "vitest";
import {
  emitMarketTransition,
  type MarketTransitionInput,
  type SideWindow,
} from "./market-transition";

const side = (over: Partial<SideWindow> = {}): SideWindow => ({
  believerDelta: 0,
  believerBase: 20,
  capitalDeltaUsd: 0,
  capitalBaseUsd: 500,
  pricePct: 0,
  ...over,
});

const input = (over: Partial<MarketTransitionInput>): MarketTransitionInput => ({
  timeframeShort: "1D",
  yes: side(),
  no: side(),
  ...over,
});

describe("contradictions carry the most information", () => {
  it("believers up, capital down → people/capital divergence", () => {
    const t = emitMarketTransition(input({ yes: side({ believerDelta: 4, capitalDeltaUsd: -60 }) }));
    expect(t?.type).toBe("people_capital_divergence");
    expect(t?.side).toBe("YES");
    expect(t?.headline).toBe("More believers. Less capital.");
    expect(t?.tier).toBe(1);
  });

  it("capital up sharply, believers flat → concentration rising", () => {
    const t = emitMarketTransition(input({ yes: side({ believerDelta: 0, capitalDeltaUsd: 300 }) }));
    expect(t?.type).toBe("concentration_rising");
    expect(t?.headline).toBe("Capital is rising without broader participation.");
  });

  it("price up, believers and capital flat → price without conviction", () => {
    const t = emitMarketTransition(input({ yes: side({ believerDelta: 0, capitalDeltaUsd: 0, pricePct: 12 }) }));
    expect(t?.type).toBe("price_conviction_divergence");
    expect(t?.headline).toBe("Price moved, but conviction did not.");
  });
});

describe("structural and social states", () => {
  it("both sides gaining similarly → the market is dividing", () => {
    const t = emitMarketTransition(
      input({
        yes: side({ believerDelta: 4, capitalDeltaUsd: 50 }),
        no: side({ believerDelta: 4, capitalDeltaUsd: 50 }),
      }),
    );
    expect(t?.type).toBe("market_dividing");
    expect(t?.side).toBeUndefined();
  });

  it("a Tribe cluster joining YES → a Tribe is forming", () => {
    const t = emitMarketTransition(
      input({ social: { tribeJoinedYes: 4, tribeJoinedNo: 0 } }),
    );
    expect(t?.type).toBe("tribe_forming");
    expect(t?.side).toBe("YES");
    expect(t?.headline).toBe("A Tribe is forming around YES.");
  });

  it("a side shedding believers → losing conviction", () => {
    const t = emitMarketTransition(input({ no: side({ believerDelta: -5 }) }));
    expect(t?.type).toBe("losing_conviction");
    expect(t?.side).toBe("NO");
  });
});

describe("acceleration needs a trustworthy baseline", () => {
  const accelInput = (recent: number, prev?: { type: "accelerating"; side: "YES" }) =>
    input({
      yes: side({ believerDelta: 5, capitalDeltaUsd: recent, recentCapitalUsd: recent }),
      baseline: { normalCapitalUsd: 50 },
      prev,
    });

  it("fires when flow is well above normal", () => {
    const t = emitMarketTransition(accelInput(200)); // 4×
    expect(t?.type).toBe("accelerating");
    expect(t?.detail).toContain("× normal");
  });

  it("makes NO acceleration claim without a baseline", () => {
    const t = emitMarketTransition(
      input({ yes: side({ believerDelta: 5, capitalDeltaUsd: 200, recentCapitalUsd: 200 }) }),
    );
    expect(t?.type).not.toBe("accelerating");
  });

  it("hysteresis: enters at 3×, holds until below 2×", () => {
    // 2.6× — below the enter bar, so a fresh read does NOT accelerate…
    expect(emitMarketTransition(accelInput(130))?.type).not.toBe("accelerating");
    // …but if we were already accelerating, it stays until it drops under 2×.
    expect(
      emitMarketTransition(accelInput(130, { type: "accelerating", side: "YES" }))?.type,
    ).toBe("accelerating");
    // Below 2× it exits even when previously accelerating.
    expect(
      emitMarketTransition(accelInput(90, { type: "accelerating", side: "YES" }))?.type,
    ).not.toBe("accelerating");
  });
});

describe("priority, dedup, and calm", () => {
  it("prefers the structural read over a simultaneous divergence", () => {
    // Both sides gaining (dividing) AND YES shows people-up/capital-down.
    const t = emitMarketTransition(
      input({
        yes: side({ believerDelta: 4, capitalDeltaUsd: -60 }),
        no: side({ believerDelta: 4, capitalDeltaUsd: 60 }),
      }),
    );
    expect(t?.type).toBe("market_dividing");
  });

  it("gives a repeated state the same fingerprint (dedupe)", () => {
    const a = emitMarketTransition(input({ yes: side({ believerDelta: 4, capitalDeltaUsd: -60 }) }));
    const b = emitMarketTransition(
      input({
        yes: side({ believerDelta: 6, capitalDeltaUsd: -90 }),
        prev: { type: "people_capital_divergence", side: "YES" },
      }),
    );
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });

  it("emits nothing on weak noise", () => {
    const t = emitMarketTransition(
      input({ yes: side({ believerDelta: 1, capitalDeltaUsd: 5 }), no: side({ believerDelta: 1 }) }),
    );
    expect(t).toBeNull();
  });

  it("is deterministic — same input, same result", () => {
    const mk = () => input({ yes: side({ believerDelta: 0, capitalDeltaUsd: 300 }) });
    expect(emitMarketTransition(mk())).toEqual(emitMarketTransition(mk()));
  });
});

describe("money formatter is used when supplied", () => {
  it("formats capital in the caller's unit", () => {
    const t = emitMarketTransition(
      input({
        yes: side({ believerDelta: 4, capitalDeltaUsd: -60 }),
        money: (usd) => `€${usd.toFixed(0)}`,
      }),
    );
    expect(t?.detail).toContain("€60");
  });
});
