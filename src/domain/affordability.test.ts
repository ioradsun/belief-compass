import { describe, it, expect } from "vitest";
import { affordability, affordabilityCopy, GAS_RESERVE_ETH } from "./affordability";

const at3000 = (amountUsd: number, balanceEth: number | null, ethUsd: number | null = 3000) =>
  affordability({ amountUsd, balanceEth, ethUsd });

describe("the check fails closed", () => {
  /**
   * THE SHARPEST HOLE. The old guard was `ethUsd > 0 && amount > balance*rate`,
   * so a missing rate did not fail the check — it removed it, and any amount
   * passed. That rate comes from calc_cache, which this repo has already watched
   * return zero rows silently under RLS.
   */
  it("blocks when the rate is unknown instead of waving the trade through", () => {
    for (const rate of [0, null, NaN, -1]) {
      expect(at3000(1_000_000, 0.001, rate)).toEqual({ ok: false, reason: "unknown" });
    }
  });

  it("blocks while the balance is still unknown", () => {
    expect(at3000(10, null)).toEqual({ ok: false, reason: "unknown" });
    expect(at3000(10, NaN)).toEqual({ ok: false, reason: "unknown" });
  });

  it("says the problem is ours, not the wallet's, when we cannot price it", () => {
    const c = affordabilityCopy(at3000(10, null))!;
    expect(c.detail).toMatch(/we can't check/i);
    expect(c.detail).not.toMatch(/insufficient/i);
  });
});

describe("gas is part of the price", () => {
  /**
   * The old check compared the amount to the FULL balance, so a wallet holding
   * exactly the trade amount passed and then had nothing left for the fee — the
   * "never ask someone to sign something guaranteed to fail" case.
   */
  it("rejects a wallet holding exactly the trade amount", () => {
    const balance = 0.01;
    const a = at3000(balance * 3000, balance);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe("gas");
  });

  it("accepts the same trade once the fee is covered", () => {
    const balance = 0.01;
    expect(at3000(balance * 3000, balance + GAS_RESERVE_ETH).ok).toBe(true);
  });

  it("separates 'no money' from 'no fee', because they are different errands", () => {
    const broke = at3000(300, 0.001);
    const noFee = at3000(30, 0.01);
    expect(broke.ok).toBe(false);
    expect(noFee.ok).toBe(false);
    if (!broke.ok) expect(broke.reason).toBe("short");
    if (!noFee.ok) expect(noFee.reason).toBe("gas");
  });
});

describe("the copy names both numbers", () => {
  it("states what is needed, what is held, and the gap", () => {
    const c = affordabilityCopy(at3000(300, 0.001))!;
    expect(c.detail).toMatch(/You need [\d.]+ ETH/);
    expect(c.detail).toMatch(/You have [\d.]+ ETH/);
    expect(c.detail).toMatch(/short/);
    // The label must fit a button; the numbers live under it.
    expect(c.label.length).toBeLessThan(32);
  });

  it("says nothing when the trade is affordable", () => {
    expect(affordabilityCopy({ ok: true })).toBeNull();
  });
});

describe("degenerate amounts never block", () => {
  it("leaves an empty or zero amount alone", () => {
    expect(at3000(0, 0).ok).toBe(true);
    expect(at3000(NaN, 0).ok).toBe(true);
    expect(at3000(-5, 0).ok).toBe(true);
  });

  it("does not block a reader who typed their exact spendable balance", () => {
    const balance = 1;
    expect(at3000((balance - GAS_RESERVE_ETH) * 3000, balance).ok).toBe(true);
  });
});
