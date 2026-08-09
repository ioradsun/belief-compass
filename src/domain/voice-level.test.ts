import { describe, it, expect } from "vitest";
import { voiceLevel, INTELLIGENCE_UNUSUAL_MIN } from "./pi-voice";
import { emptyVector } from "./signal-vector";
import { CADENCE, intelligenceCost, mixFeed, type MixCandidate } from "./feed-cadence";

const vec = (patch: Partial<ReturnType<typeof emptyVector>["signals"]>, gain: number) => {
  const v = emptyVector();
  return { signals: { ...v.signals, ...patch }, informationGain: gain };
};

describe("voice levels", () => {
  it("a social (all-zero) row is a receipt", () => {
    expect(voiceLevel(emptyVector())).toBe("receipt");
    expect(voiceLevel(null)).toBe("receipt");
  });

  it("a single real change is an observation, not intelligence", () => {
    expect(voiceLevel(vec({ beforePrice: 0.5 }, 0.4))).toBe("observation");
  });

  it("accumulation alone never rises above a receipt", () => {
    expect(voiceLevel(vec({ building: 1 }, 0.4))).toBe("receipt");
  });

  it("tension and nonresponse speak at intelligence volume", () => {
    expect(voiceLevel(vec({ tension: 0.6 }, 0.4))).toBe("intelligence");
    expect(voiceLevel(vec({ nonresponse: 0.5 }, 0.4))).toBe("intelligence");
    expect(voiceLevel(vec({ unusual: INTELLIGENCE_UNUSUAL_MIN }, 0.4))).toBe("intelligence");
  });

  it("a row that only inherited a share of the anomaly is quieter", () => {
    // Same signals, low earned gain (carrier discount) → not intelligence.
    expect(voiceLevel(vec({ tension: 0.6 }, 0.08))).toBe("observation");
    expect(voiceLevel(vec({ tension: 0.6 }, 0.01))).toBe("receipt");
  });
});

const row = (id: string, patch: Partial<MixCandidate> = {}): MixCandidate => ({
  id,
  family: "live_action",
  significance: 0.5,
  occurredAt: "2026-08-09T12:00:00.000Z",
  marketId: id,
  side: null,
  ...patch,
});

describe("intelligence cost", () => {
  it("costs nothing while the window is within its allowance", () => {
    expect(intelligenceCost(row("a", { voice: "intelligence" }), 0, 0)).toBe(0);
  });

  it("escalates once the allowance is spent", () => {
    const c = row("a", { voice: "intelligence" });
    const first = intelligenceCost(c, 1, 3);
    const second = intelligenceCost(c, 2, 3);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  it("a genuine clue buys its way past the cost", () => {
    const c = row("a", { voice: "intelligence", signalGain: CADENCE.intelligenceBypass });
    expect(intelligenceCost(c, 5, 5)).toBe(0);
  });

  it("never applies to observations or receipts", () => {
    expect(intelligenceCost(row("a", { voice: "observation" }), 9, 9)).toBe(0);
    expect(intelligenceCost(row("a"), 9, 9)).toBe(0);
  });

  it("is a cost, not a ceiling: six real contradictions still all appear", () => {
    const all = Array.from({ length: 6 }, (_, i) =>
      row(`i${i}`, { voice: "intelligence", signalGain: 0.5, significance: 0.6 }),
    );
    expect(mixFeed(all)).toHaveLength(6);
  });

  it("spaces intelligence out when equally good receipts are available", () => {
    const mixed = [
      ...Array.from({ length: 4 }, (_, i) =>
        row(`i${i}`, { voice: "intelligence", signalGain: 0.2, significance: 0.5 }),
      ),
      ...Array.from({ length: 4 }, (_, i) => row(`r${i}`, { voice: "receipt", significance: 0.5 })),
    ];
    const order = mixFeed(mixed).map((c) => c.voice);
    // The first four rows are not all intelligence any more.
    expect(order.slice(0, 4).filter((v) => v === "intelligence").length).toBeLessThan(4);
  });
});
