import { describe, it, expect } from "vitest";
import {
  INSIDER_CONSTITUTION,
  INSIDER_CONTRACT_VERSION,
  INSIDER_SIGNAL_KINDS,
  NO_EVIDENCE,
  type InsiderSignal,
  type InsiderMarket,
  type InsiderNow,
  type InsiderRead,
  type InsiderSignalKind,
} from "./index";

/**
 * The contract is types-only, so these tests guard the vocabulary itself: that
 * the shapes compose, that the kind list stays in sync with the union, and that
 * the single-resource split (global vs viewer) is expressible. If someone widens
 * a projection with a field a surface must NOT own, this is where it shows up.
 */
describe("insider contract", () => {
  it("names the constitutional rule and a versioned shape", () => {
    expect(INSIDER_CONSTITUTION).toContain("No product surface calculates market intelligence");
    expect(INSIDER_CONTRACT_VERSION).toBe(1);
  });

  it("the signal-kind list has no duplicates and matches the union", () => {
    const set = new Set<InsiderSignalKind>(INSIDER_SIGNAL_KINDS);
    expect(set.size).toBe(INSIDER_SIGNAL_KINDS.length);
    // A representative kind from each family is present.
    for (const k of ["tension", "trade", "became_directional", "standing"] as const) {
      expect(set.has(k)).toBe(true);
    }
  });

  it("a global signal composes without a viewer overlay", () => {
    const signal: InsiderSignal = {
      id: "sig_1",
      marketId: 42,
      kind: "building",
      side: "YES",
      occurredAt: "2026-01-01T00:00:00.000Z",
      evidence: { ...NO_EVIDENCE, magnitude: 0.6, velocity: 0.4, freshness: 0.9 },
      judgment: { momentumScore: 0.7, importanceScore: 0.5, confidence: 0.8 },
      provenance: { sourceEventIds: ["chain:8453:0xabc:3"], reasonCodes: ["yes_building"], builderVersion: 1 },
    };
    expect(signal.viewer).toBeUndefined();
    expect(signal.evidence.imbalance).toBeNull(); // not computed ≠ zero
  });

  it("the per-market resource keeps read viewer-scoped and optional", () => {
    const market: InsiderMarket = {
      marketId: 42,
      pulse: {
        direction: "YES",
        momentum: 0.7,
        acceleration: 0.3,
        activity: 0.5,
        participation: 0.4,
        capitalFlow: 0.6,
        imbalance: 0.55,
        volatility: 0.2,
        novelty: 0.1,
        lastInterestingEventAt: "2026-01-01T00:00:00.000Z",
      },
      insight: {
        headline: "YES is gaining momentum.",
        detail: "8 new believers joined in 3h while YES capital grew 21%.",
        direction: "YES",
        pulse: {
          direction: "YES",
          momentum: 0.7,
          acceleration: 0.3,
          activity: 0.5,
          participation: 0.4,
          capitalFlow: 0.6,
          imbalance: 0.55,
          volatility: 0.2,
          novelty: 0.1,
          lastInterestingEventAt: "2026-01-01T00:00:00.000Z",
        },
      },
      signals: [],
      activity: { yes: [], no: [] },
    };
    // Global-only market: no read until a viewer asks for one.
    expect(market.read).toBeUndefined();

    const read: InsiderRead = { status: "predicted", predictedSide: "YES", confidence: null };
    const forViewer: InsiderMarket = { ...market, read };
    expect(forViewer.read?.predictedSide).toBe("YES");
  });

  it("the global feed is its own resource with a cursor", () => {
    const now: InsiderNow = { stories: [], cursor: null };
    expect(now.stories).toHaveLength(0);
    expect(now.cursor).toBeNull();
  });
});
