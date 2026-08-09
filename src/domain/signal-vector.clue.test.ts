import { describe, it, expect } from "vitest";
import { signalVector, type SignalFacts } from "./signal-vector";
import { clueLine } from "./pi-voice";

const H = 3_600_000;
const NOW = Date.parse("2026-08-09T12:00:00Z");

const base = (over: Partial<SignalFacts> = {}): SignalFacts => ({
  isSocial: false,
  yesPrice: 2,
  yesPriceChange24h: 0.02,
  yesCapitalDelta24h: 200,
  noCapitalDelta24h: 0,
  tradeCount24h: 6,
  tradeCount7d: 14,
  believersYes: 4,
  believersNo: 2,
  newBelievers24h: 2,
  actor: { wallet: "0xa", direction: "buy", amountUsd: 200 },
  input: { amountUsd: 200, atMs: NOW - 6 * H },
  nowMs: NOW,
  ...over,
});

describe("clue lifecycle is gated on proven ordering (plan §8/§9)", () => {
  it("stays `new` and emits no confirmation without a price proof", () => {
    const v = signalVector(base({ yesPriceChange24h: 0.3 }));
    expect(v.clue).toBe("new");
    expect(v.signals.confirmation).toBe(0);
    expect(v.provenMoveSinceInput).toBeUndefined();
  });

  it("is `developing` when the price is proven still quiet since the input", () => {
    const v = signalVector(
      base({
        priceProof: {
          sinceMs: NOW - 6 * H,
          priceThen: 2,
          priceNow: 2.01,
          atNowMs: NOW,
          relMove: 0.005,
        },
      }),
    );
    expect(v.clue).toBe("developing");
    expect(v.signals.confirmation).toBe(0);
    expect(clueLine(v)).toMatch(/Still quiet/);
  });

  it("is `resolved` only when the proven move agrees with the input, and says a real number", () => {
    const v = signalVector(
      base({
        priceProof: {
          sinceMs: NOW - 6 * H,
          priceThen: 2,
          priceNow: 2.2,
          atNowMs: NOW,
          relMove: 0.1,
        },
      }),
    );
    expect(v.clue).toBe("resolved");
    expect(v.signals.confirmation).toBeGreaterThan(0);
    expect(clueLine(v)).toBe("Now it's moving. Price is up 10% since then.");
  });

  it("does not call a move against the input a confirmation", () => {
    const v = signalVector(
      base({
        priceProof: {
          sinceMs: NOW - 6 * H,
          priceThen: 2,
          priceNow: 1.7,
          atNowMs: NOW,
          relMove: -0.15,
        },
      }),
    );
    expect(v.clue).toBe("new");
    expect(v.signals.confirmation).toBe(0);
  });

  it("no clue line ever implies causation", () => {
    for (const relMove of [0.1, 0.005]) {
      const line =
        clueLine(
          signalVector(
            base({
              priceProof: { sinceMs: NOW - 6 * H, priceThen: 2, priceNow: 2 * (1 + relMove), atNowMs: NOW, relMove },
            }),
          ),
        ) ?? "";
      expect(line).not.toMatch(/because|caused|drove|sent|so the price/i);
    }
  });

  it("a dust input never buys a before/after story", () => {
    const v = signalVector(
      base({
        input: { amountUsd: 3, atMs: NOW - 6 * H },
        actor: { wallet: "0xa", direction: "buy", amountUsd: 3 },
        priceProof: { sinceMs: NOW - 6 * H, priceThen: 2, priceNow: 2.4, atNowMs: NOW, relMove: 0.2 },
      }),
    );
    expect(v.clue).toBe("new");
    expect(v.signals.confirmation).toBe(0);
  });
});
