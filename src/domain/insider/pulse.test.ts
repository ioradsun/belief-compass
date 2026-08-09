import { describe, it, expect } from "vitest";
import { insiderPulse, type PulseFacts } from "./pulse";
import { pulseLabel } from "../market-pulse";

const facts = (over: Partial<PulseFacts> = {}): PulseFacts => ({
  believerDelta: 0,
  believerBase: 10,
  believers: 10,
  capitalDeltaEth: 0,
  capitalBaseEth: 1,
  events: 0,
  ...over,
});

describe("insider pulse", () => {
  it("momentum stays consistent with the canonical pulse label (one definition of shape)", () => {
    // Rising believers + rising capital, fast → "Accelerating" → high momentum.
    const f = facts({ believerDelta: 8, believerBase: 10, believers: 18, capitalDeltaEth: 1, capitalBaseEth: 1, events: 12 });
    expect(pulseLabel(f)).toBe("Accelerating");
    expect(insiderPulse(f).momentum).toBeGreaterThanOrEqual(0.9);

    // No activity → "Quiet" → near-zero momentum.
    expect(insiderPulse(facts({ believers: 10 })).momentum).toBeLessThan(0.2);
  });

  it("reads direction from the YES/NO split (capital + believers)", () => {
    expect(insiderPulse(facts({ capitalHeldYesEth: 9, capitalHeldNoEth: 1 })).direction).toBe("YES");
    expect(insiderPulse(facts({ capitalHeldYesEth: 1, capitalHeldNoEth: 9 })).direction).toBe("NO");
    expect(insiderPulse(facts({ capitalHeldYesEth: 5, capitalHeldNoEth: 5 })).direction).toBe("BALANCED");
    // No split known ⇒ BALANCED, never invented.
    expect(insiderPulse(facts()).direction).toBe("BALANCED");
  });

  it("imbalance grows with lopsidedness and is 0 when unknown", () => {
    expect(insiderPulse(facts()).imbalance).toBe(0);
    const lop = insiderPulse(facts({ capitalHeldYesEth: 9, capitalHeldNoEth: 1 })).imbalance;
    const even = insiderPulse(facts({ capitalHeldYesEth: 6, capitalHeldNoEth: 4 })).imbalance;
    expect(lop).toBeGreaterThan(even);
  });

  it("activity + novelty come from the shared unusualness baseline (2x..6x)", () => {
    // 7d below the baseline minimum ⇒ no anomaly (unqualified ⇒ 0), never invented.
    expect(insiderPulse(facts({ tradeCount24h: 50, tradeCount7d: 3 })).novelty).toBe(0);
    // ~6x the daily baseline ⇒ novelty saturates.
    const hot = insiderPulse(facts({ tradeCount24h: 60, tradeCount7d: 70 }));
    expect(hot.novelty).toBeGreaterThan(0.8);
    expect(hot.activity).toBeGreaterThan(0.8);
  });

  it("acceleration fires when the last hour outpaces the 24h average", () => {
    const speeding = insiderPulse(facts({ yesPrice: 0.5, yesPriceChange1h: 0.05, yesPriceChange24h: 0.06 }));
    expect(speeding.acceleration).toBeGreaterThan(0);
    const steady = insiderPulse(facts({ yesPrice: 0.5, yesPriceChange1h: 0.0025, yesPriceChange24h: 0.06 }));
    expect(steady.acceleration).toBe(0);
    // No price data ⇒ calm, never invented.
    expect(insiderPulse(facts()).acceleration).toBe(0);
  });

  it("every metric is a finite 0..1 number", () => {
    const p = insiderPulse(facts({ believerDelta: 5, capitalDeltaEth: 0.5, tradeCount24h: 40, tradeCount7d: 35, yesPrice: 0.5, yesPriceChange24h: 0.04, capitalHeldYesEth: 7, capitalHeldNoEth: 3 }));
    for (const k of ["momentum", "acceleration", "activity", "participation", "capitalFlow", "imbalance", "volatility", "novelty"] as const) {
      expect(p[k]).toBeGreaterThanOrEqual(0);
      expect(p[k]).toBeLessThanOrEqual(1);
      expect(Number.isFinite(p[k])).toBe(true);
    }
  });
});
