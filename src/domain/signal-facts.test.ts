import { describe, it, expect } from "vitest";
import { factsForRow, isSocialSignalKind, type MarketSignalSource } from "./signal-facts";
import { signalVector } from "./signal-vector";

const market: MarketSignalSource = {
  yesPrice: 2,
  yesPriceChange24h: 0.02,
  yesCapitalDelta24h: 120,
  noCapitalDelta24h: 0,
  tradeCount24h: 12,
  tradeCount7d: 21,
  believersYes: 4,
  believersNo: 3,
  newBelievers24h: 3,
  newBelieversYes24h: 2,
  newBelieversNo24h: 1,
  peopleYesChange24h: 5,
  sideFlips24h: 0,
};

const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);

describe("signal-facts", () => {
  it("gives social rows an all-zero vector", () => {
    for (const kind of ["discovery_moment", "believer_milestone", "market_created"]) {
      expect(isSocialSignalKind(kind)).toBe(true);
      const v = signalVector(factsForRow({ kind }, market, NOW));
      expect(v.informationGain).toBe(0);
      expect(Object.values(v.signals).every((n) => n === 0)).toBe(true);
    }
  });

  it("treats a missing market read as no market signal, never as zeros", () => {
    const facts = factsForRow({ kind: "trade" }, null, NOW);
    expect(facts.isSocial).toBe(true);
    expect(signalVector(facts).informationGain).toBe(0);
  });

  it("maps a trade row into an actor and a timed input", () => {
    const facts = factsForRow(
      {
        kind: "trade",
        wallet: "0xABC",
        action: "BUY",
        amountUsd: 80,
        occurredAt: new Date(NOW - 5 * 3_600_000).toISOString(),
      },
      market,
      NOW,
    );
    expect(facts.actor).toEqual({ wallet: "0xabc", direction: "buy", amountUsd: 80 });
    expect(facts.input?.amountUsd).toBe(80);
    expect(facts.preEventHolders).toBeNull();
  });

  it("never invents a holder hierarchy from a large amount alone", () => {
    const facts = factsForRow(
      { kind: "trade", wallet: "0xabc", action: "SELL", amountUsd: 5000, occurredAt: new Date(NOW).toISOString() },
      market,
      NOW,
    );
    expect(facts.preEventHolders).toBeNull();
    expect(signalVector(facts).signals.concentration).toBe(0);
  });

  it("is viewer-blind: identical facts for the same row regardless of who asks", () => {
    const row = { kind: "trade", wallet: "0xabc", action: "BUY" as const, amountUsd: 40, occurredAt: new Date(NOW).toISOString() };
    expect(factsForRow(row, market, NOW)).toEqual(factsForRow(row, market, NOW));
  });
});
