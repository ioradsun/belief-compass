import { describe, expect, it } from "vitest";
import { marketPulse, pulseLabel, pulseTone } from "@/domain/market-pulse";
import { marketVitality } from "@/domain/market-vitality";
import type { TapeTrade } from "@/domain/conviction-series";

const now = 1_000_000_000_000;
const day = 86_400_000;
const buy = (w: string, side: "YES" | "NO", eth: number, t: number): TapeTrade => ({
  w,
  side,
  action: "BUY",
  eth,
  price: 1,
  t,
});
const sell = (w: string, side: "YES" | "NO", eth: number, t: number): TapeTrade => ({
  w,
  side,
  action: "SELL",
  eth,
  price: 1,
  t,
});

const pulse = (tape: TapeTrade[]) => pulseLabel(marketVitality(tape, now));

describe("pulseLabel", () => {
  it("is Quiet on an empty market", () => {
    expect(pulse([])).toBe("Quiet");
  });

  it("is Early for a young market with only a few believers", () => {
    // First event <24h ago → range is since-creation.
    expect(pulse([buy("a", "YES", 1, now - 2 * 3_600_000)])).toBe("Early");
  });

  it("is Accelerating when a small base doubles with capital", () => {
    const tape = [
      buy("a", "YES", 1, now - 30 * day),
      buy("b", "NO", 1, now - 30 * day),
      buy("c", "YES", 1, now - 20 * day),
      buy("d", "NO", 1, now - 20 * day),
      buy("e", "YES", 1, now - 12 * day),
      buy("f", "NO", 1, now - 12 * day),
      // this week: several new believers + capital
      buy("g", "YES", 1, now - 2 * day),
      buy("h", "NO", 1, now - 2 * day),
      buy("i", "YES", 1, now - day),
      buy("j", "NO", 1, now - day),
    ];
    expect(pulse(tape)).toBe("Accelerating");
  });

  it("is Deepening when the same believers add capital", () => {
    const tape = [
      buy("a", "YES", 1, now - 30 * day),
      buy("b", "NO", 1, now - 30 * day),
      buy("c", "YES", 1, now - 20 * day),
      buy("d", "NO", 1, now - 20 * day),
      buy("e", "YES", 1, now - 12 * day),
      buy("f", "NO", 1, now - 12 * day),
      // this week: no new wallets, existing ones add money
      buy("a", "YES", 5, now - 2 * day),
    ];
    expect(pulse(tape)).toBe("Deepening");
  });

  it("is Cooling when capital leaves", () => {
    const tape = [
      buy("a", "YES", 5, now - 30 * day),
      buy("b", "NO", 5, now - 30 * day),
      buy("c", "YES", 5, now - 20 * day),
      buy("d", "NO", 5, now - 12 * day),
      sell("a", "YES", 4, now - 2 * day),
    ];
    expect(pulse(tape)).toBe("Cooling");
  });
});

describe("marketPulse", () => {
  it("carries a neutral meaning sentence with no side", () => {
    const p = marketPulse(marketVitality([buy("a", "YES", 1, now - 2 * 3_600_000)], now));
    expect(p.meaning).toBeTruthy();
    expect(p.meaning).not.toMatch(/\bYES\b|\bNO\b/);
  });
});

describe("pulseTone", () => {
  it("tints growth up, cooling down, the rest flat", () => {
    expect(pulseTone("Growing")).toBe("up");
    expect(pulseTone("Accelerating")).toBe("up");
    expect(pulseTone("Deepening")).toBe("up");
    expect(pulseTone("Cooling")).toBe("down");
    expect(pulseTone("Quiet")).toBe("flat");
    expect(pulseTone("Early")).toBe("flat");
  });
});
