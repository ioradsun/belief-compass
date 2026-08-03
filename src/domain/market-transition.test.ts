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
    // −$120 on a $500 base clears both the absolute and the 15%-relative bar.
    const t = emitMarketTransition(input({ yes: side({ believerDelta: 4, capitalDeltaUsd: -120 }) }));
    expect(t?.type).toBe("people_capital_divergence");
    expect(t?.side).toBe("YES");
    expect(t?.headline).toBe("More believers. Less capital.");
    expect(t?.detail).toBe("4 people joined while $120.00 left the market.");
    expect(t?.tier).toBe(1);
  });

  it("capital up sharply, believers flat → concentration rising", () => {
    const t = emitMarketTransition(input({ yes: side({ believerDelta: 0, capitalDeltaUsd: 300 }) }));
    expect(t?.type).toBe("concentration_rising");
    expect(t?.headline).toBe("Capital is concentrating on YES.");
    expect(t?.detail).toBe("YES gained $300.00 without adding new believers.");
  });

  it("price up, believers and capital flat → price without conviction", () => {
    const t = emitMarketTransition(input({ yes: side({ believerDelta: 0, capitalDeltaUsd: 0, pricePct: 12 }) }));
    expect(t?.type).toBe("price_conviction_divergence");
    expect(t?.headline).toBe("Price moved, but conviction did not.");
  });

  it("believers and capital rising together → participation broadening", () => {
    const t = emitMarketTransition(input({ yes: side({ believerDelta: 4, capitalDeltaUsd: 200 }) }));
    expect(t?.type).toBe("participation_broadening");
    expect(t?.headline).toBe("Participation is broadening.");
  });
});

describe("capital safeguards — no drama from noise", () => {
  it("ignores a capital move below the absolute floor (tiny market)", () => {
    // −$10 is under the $25 floor even though it's a big fraction of a $30 book.
    const t = emitMarketTransition(
      input({ yes: side({ believerDelta: 4, capitalDeltaUsd: -10, capitalBaseUsd: 30 }) }),
    );
    expect(t?.type).not.toBe("people_capital_divergence");
  });

  it("ignores a capital move that is normal noise in a huge market", () => {
    // −$120 absolute, but only 2.4% of a $5000 book → below the relative bar.
    const t = emitMarketTransition(
      input({ yes: side({ believerDelta: 4, capitalDeltaUsd: -120, capitalBaseUsd: 5000 }) }),
    );
    expect(t?.type).not.toBe("people_capital_divergence");
  });

  it("makes no capital claim when the delta is unavailable (0)", () => {
    const t = emitMarketTransition(input({ yes: side({ believerDelta: 4, capitalDeltaUsd: 0 }) }));
    expect(t?.type).not.toBe("people_capital_divergence");
    expect(t?.type).not.toBe("concentration_rising");
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

  it("uses the ranker's acceleration multiple, attributed to the gaining side", () => {
    const t = emitMarketTransition(
      input({
        yes: side({ believerDelta: 5, capitalDeltaUsd: 300 }),
        no: side({ capitalDeltaUsd: 10 }),
        baseline: { accelerationMultiple: 4 },
      }),
    );
    expect(t?.type).toBe("accelerating");
    expect(t?.side).toBe("YES");
    expect(t?.detail).toBe("Flow is 4.0× normal.");
  });

  it("makes no acceleration claim from the multiple when no side is gaining capital", () => {
    const t = emitMarketTransition(
      input({
        yes: side({ believerDelta: 0, capitalDeltaUsd: -5 }),
        no: side({ capitalDeltaUsd: -5 }),
        baseline: { accelerationMultiple: 5 },
      }),
    );
    expect(t?.type).not.toBe("accelerating");
  });

  it("hysteresis on the multiple: below 3× only holds if already accelerating", () => {
    const below = input({
      yes: side({ believerDelta: 3, capitalDeltaUsd: 100 }),
      baseline: { accelerationMultiple: 2.5 },
    });
    expect(emitMarketTransition(below)?.type).not.toBe("accelerating");
    expect(
      emitMarketTransition({ ...below, prev: { type: "accelerating", side: "YES" } })?.type,
    ).toBe("accelerating");
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
  it("prefers a contradiction over a simultaneous dividing market", () => {
    // Both sides gaining believers (dividing) AND YES shows people-up/capital-down.
    // The contradiction is more informative, so it wins.
    const t = emitMarketTransition(
      input({
        yes: side({ believerDelta: 4, capitalDeltaUsd: -120 }),
        no: side({ believerDelta: 4, capitalDeltaUsd: 120 }),
      }),
    );
    expect(t?.type).toBe("people_capital_divergence");
  });

  it("gives a repeated state the same fingerprint (dedupe)", () => {
    const a = emitMarketTransition(input({ yes: side({ believerDelta: 4, capitalDeltaUsd: -120 }) }));
    const b = emitMarketTransition(
      input({
        yes: side({ believerDelta: 6, capitalDeltaUsd: -150 }),
        prev: { type: "people_capital_divergence", side: "YES" },
      }),
    );
    expect(a?.type).toBe("people_capital_divergence");
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
        yes: side({ believerDelta: 4, capitalDeltaUsd: -120 }),
        money: (usd) => `€${usd.toFixed(0)}`,
      }),
    );
    expect(t?.detail).toContain("€120");
  });
});
