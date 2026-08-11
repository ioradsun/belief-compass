import { describe, it, expect } from "vitest";
import {
  formatCC,
  checkSimulationBuy,
  insufficientCc,
  simulationEligible,
  modeFor,
  isSimulating,
  canOrder,
  directionalSide,
  positionValueCc,
  SIMULATION_START_CC,
  MIN_ORDER_CC,
  CC_DEFINITION,
  SIMULATION_COPY,
  type SimulationAccount,
} from "./simulation";
import { profileProgressFor, PROFILE_TARGET, CALIBRATION_TARGET } from "./beliefs";

const account = (over: Partial<SimulationAccount> = {}): SimulationAccount => ({
  wallet: "0xabc",
  startingBalanceCc: SIMULATION_START_CC,
  balanceCc: SIMULATION_START_CC,
  active: true,
  activatedAt: "2026-08-11T00:00:00.000Z",
  exitedAt: null,
  graduatedAt: null,
  ...over,
});

describe("formatCC", () => {
  it("suffixes the unit and never a currency symbol", () => {
    expect(formatCC(1000)).toBe("1,000 CC");
    expect(formatCC(24.15)).toBe("24.15 CC");
    expect(formatCC(0)).toBe("0.00 CC");
    expect(formatCC(100)).not.toContain("$");
  });
  it("signs a delta on request, and always signs a negative", () => {
    expect(formatCC(24.15, true)).toBe("+24.15 CC");
    expect(formatCC(-3.2, true)).toBe("−3.20 CC");
    expect(formatCC(-3.2)).toBe("−3.20 CC");
  });
  it("refuses to print a non-finite amount as a number", () => {
    expect(formatCC(Number.NaN)).toBe("—");
    expect(formatCC(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("CC language", () => {
  it("states plainly that CC is not money", () => {
    expect(CC_DEFINITION).toMatch(/no monetary value/);
    expect(CC_DEFINITION).toMatch(/cannot be withdrawn, transferred, redeemed, or exchanged/);
  });
  it("never calls CC play, fake, demo or dollar money", () => {
    const all = [CC_DEFINITION, ...Object.values(SIMULATION_COPY)].join(" ").toLowerCase();
    for (const banned of [
      "fake money",
      "play money",
      "demo money",
      "test money",
      "virtual dollar",
      "cc dollar",
      "exchange rate",
      "cash equivalent",
      "dollar equivalent",
    ]) {
      expect(all).not.toContain(banned);
    }
  });
});

describe("the two thresholds stay apart", () => {
  it("recognisable at five, done at ten", () => {
    expect(CALIBRATION_TARGET).toBe(5);
    expect(PROFILE_TARGET).toBe(10);
  });
  it("five convictions is progress, not completion", () => {
    const p = profileProgressFor(5);
    expect(p.complete).toBe(false);
    expect(p.remaining).toBe(5);
  });
  it("ten completes the profile", () => {
    expect(profileProgressFor(10).complete).toBe(true);
    expect(profileProgressFor(14).remaining).toBe(0);
  });
});

describe("eligibility", () => {
  it("is open below ten", () => {
    expect(simulationEligible({ progress: profileProgressFor(9), graduatedAt: null })).toBe(true);
  });
  it("closes at ten", () => {
    expect(simulationEligible({ progress: profileProgressFor(10), graduatedAt: null })).toBe(false);
  });
  it("never reopens for a graduated account, whatever the count says later", () => {
    expect(
      simulationEligible({ progress: profileProgressFor(3), graduatedAt: "2026-08-01T00:00:00Z" }),
    ).toBe(false);
  });
});

describe("modeFor", () => {
  it("is REAL with no account, an inactive one, or a graduated one", () => {
    expect(modeFor(null, profileProgressFor(2))).toBe("REAL");
    expect(modeFor(account({ active: false }), profileProgressFor(2))).toBe("REAL");
    expect(modeFor(account({ graduatedAt: "2026-08-01T00:00:00Z" }), profileProgressFor(2))).toBe(
      "REAL",
    );
  });
  it("simulates below ten", () => {
    expect(modeFor(account(), profileProgressFor(6))).toBe("SIMULATION");
  });
  it("graduates at ten without dropping straight to REAL", () => {
    // The tenth receipt is still on screen — it must stay readable.
    expect(modeFor(account(), profileProgressFor(10))).toBe("GRADUATING");
  });
  it("keeps Simulation data visible while graduating but opens no new order", () => {
    expect(isSimulating("GRADUATING")).toBe(true);
    expect(canOrder("GRADUATING")).toBe(false);
    expect(canOrder("SIMULATION")).toBe(true);
    expect(isSimulating("REAL")).toBe(false);
  });
});

describe("checkSimulationBuy", () => {
  it("accepts an affordable order", () => {
    expect(checkSimulationBuy({ amountCc: 100, balanceCc: 1000 })).toEqual({ ok: true });
  });
  it("rejects zero, sub-minimum and over-balance amounts", () => {
    expect(checkSimulationBuy({ amountCc: 0, balanceCc: 1000 }).ok).toBe(false);
    expect(checkSimulationBuy({ amountCc: MIN_ORDER_CC / 2, balanceCc: 1000 }).ok).toBe(false);
    const over = checkSimulationBuy({ amountCc: 101, balanceCc: 42 });
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.reason).toBe("Not enough CC. Available: 42.00 CC.");
  });
  it("fails closed on an unknown balance rather than permitting the spend", () => {
    expect(checkSimulationBuy({ amountCc: 10, balanceCc: null }).ok).toBe(false);
  });
  it("names the number it is refusing against", () => {
    expect(insufficientCc(42)).toContain("42.00 CC");
    expect(insufficientCc(-5)).toContain("0.00 CC");
  });
});

describe("position reading", () => {
  const pos = (yes: number, no: number, last: "YES" | "NO" | null = null) => ({
    onchainId: 1,
    yesShares: yes,
    noShares: no,
    yesCostCc: 0,
    noCostCc: 0,
    lastDirectionalSide: last,
  });

  it("reads the larger side as the belief", () => {
    expect(directionalSide(pos(10, 2))).toBe("YES");
    expect(directionalSide(pos(2, 10))).toBe("NO");
  });
  it("infers nothing from a perfectly balanced position beyond the last direction", () => {
    expect(directionalSide(pos(5, 5))).toBe(null);
    expect(directionalSide(pos(5, 5, "NO"))).toBe("NO");
  });
  it("has no direction with nothing held", () => {
    expect(directionalSide(pos(0, 0, "YES"))).toBe(null);
  });
  it("marks value against the live price, and withholds it when there is none", () => {
    expect(positionValueCc(100, 0.42)).toBeCloseTo(42);
    expect(positionValueCc(100, null)).toBe(null);
    expect(positionValueCc(100, 0)).toBe(null);
    expect(positionValueCc(0, null)).toBe(0);
  });
});
