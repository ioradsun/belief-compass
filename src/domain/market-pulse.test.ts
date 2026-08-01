import { describe, expect, it } from "vitest";
import { pulse, pulseLabel, pulseTone, type PulseInput } from "@/domain/market-pulse";

const base = (over: Partial<PulseInput> = {}): PulseInput => ({
  believerDelta: 0,
  believerBase: 10,
  believers: 10,
  capitalDeltaEth: 0,
  capitalBaseEth: 1,
  events: 4,
  ...over,
});

describe("pulseLabel", () => {
  it("is New with almost no believers", () => {
    expect(pulseLabel(base({ believers: 1 }))).toBe("New");
  });

  it("is Quiet when nothing moved materially", () => {
    expect(pulseLabel(base({ events: 0 }))).toBe("Quiet");
    expect(pulseLabel(base({ believerDelta: 0, capitalDeltaEth: 0.0001 }))).toBe("Quiet");
  });

  it("NEVER reads Growing when believers rise but capital falls", () => {
    // The screenshot case: +people, −money.
    const label = pulseLabel(base({ believerDelta: 4, capitalDeltaEth: -0.5 }));
    expect(label).toBe("Mixed Momentum");
    expect(label).not.toBe("Growing");
  });

  it("is Accelerating only when both rise meaningfully", () => {
    expect(
      pulseLabel(base({ believerBase: 6, believers: 12, believerDelta: 6, capitalDeltaEth: 1 })),
    ).toBe("Accelerating");
  });

  it("is Deepening when believers are flat and capital rises modestly", () => {
    expect(pulseLabel(base({ believerDelta: 0, capitalBaseEth: 10, capitalDeltaEth: 1 }))).toBe(
      "Deepening",
    );
  });

  it("is Capital-led when a flat crowd adds a lot of money", () => {
    expect(pulseLabel(base({ believerDelta: 0, capitalBaseEth: 2, capitalDeltaEth: 2 }))).toBe(
      "Capital-led",
    );
  });

  it("is Narrowing when believers fall but capital holds or rises", () => {
    expect(pulseLabel(base({ believerDelta: -3, capitalDeltaEth: 0 }))).toBe("Narrowing");
    expect(pulseLabel(base({ believerDelta: -3, capitalDeltaEth: 0.5 }))).toBe("Narrowing");
  });

  it("is Cooling when both fall", () => {
    expect(pulseLabel(base({ believerDelta: -3, capitalDeltaEth: -0.5 }))).toBe("Cooling");
  });

  it("is Broadening when believers outpace capital", () => {
    expect(
      pulseLabel(base({ believerBase: 10, believers: 20, believerDelta: 10, capitalDeltaEth: 0.05 })),
    ).toBe("Broadening");
  });
});

describe("pulse conflict-prevention", () => {
  it("never claims people are joining when believers are flat or negative", () => {
    for (const bd of [0, -2]) {
      const p = pulse(base({ believerDelta: bd, capitalDeltaEth: 1, capitalBaseEth: 10 }));
      expect(p.meaning.toLowerCase()).not.toContain("more people are joining");
    }
  });

  it("never says capital is following unless both rose", () => {
    const p = pulse(base({ believerDelta: 4, capitalDeltaEth: -0.5 }));
    expect(p.meaning.toLowerCase()).not.toContain("capital is following");
  });

  it("never mentions a side or price", () => {
    const labels: PulseInput[] = [
      base({ believerDelta: 4, capitalDeltaEth: 1 }),
      base({ believerDelta: 4, capitalDeltaEth: -0.5 }),
      base({ believerDelta: -3, capitalDeltaEth: -0.5 }),
    ];
    for (const i of labels) {
      expect(pulse(i).meaning).not.toMatch(/\bYES\b|\bNO\b|price|\$/);
    }
  });
});

describe("pulseTone", () => {
  it("tints growth up, decline down, ambiguity flat", () => {
    expect(pulseTone("Accelerating")).toBe("up");
    expect(pulseTone("Deepening")).toBe("up");
    expect(pulseTone("Cooling")).toBe("down");
    expect(pulseTone("Narrowing")).toBe("down");
    expect(pulseTone("Mixed Momentum")).toBe("flat");
    expect(pulseTone("New")).toBe("flat");
  });
});
