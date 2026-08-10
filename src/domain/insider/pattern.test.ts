import { describe, it, expect } from "vitest";
import { accumulatePatterns, type PatternObservation } from "./pattern";

const obs = (over: Partial<PatternObservation> & { key: string }): PatternObservation => ({
  marketId: 1,
  marketTitle: "Will X happen?",
  side: "YES",
  holderCount: 4,
  maxDaysHeld: 13,
  priceMove: null,
  oppositeBelievers: null,
  kind: "held_through_price_move",
  strength: 0.4,
  ...over,
});

describe("insider patterns — evidence accumulation", () => {
  it("merges two 'didn't budge' observations into ONE price-indifferent dossier", () => {
    // The corpus case: YES rose 15% AND fell 40%, same 4 positions held.
    const out = accumulatePatterns([
      obs({ key: "up", priceMove: 0.15 }),
      obs({ key: "down", priceMove: -0.4 }),
    ]);
    expect(out).toHaveLength(1);
    const d = out[0]!;
    expect(d.kind).toBe("price_indifferent");
    expect(d.headline).toBe("THEY'RE NOT WATCHING THE PRICE");
    expect(d.body).toContain("rose 15%");
    expect(d.body).toContain("fell 40%");
    // It consumes BOTH constituents so neither prints on its own.
    expect(d.consumes.sort()).toEqual(["down", "up"]);
    // A pattern outranks its loudest part.
    expect(d.strength).toBeGreaterThan(0.4);
  });

  it("does not fire on a single move (that is still just one observation)", () => {
    expect(accumulatePatterns([obs({ key: "solo", priceMove: 0.15 })])).toHaveLength(0);
  });

  it("ignores moves too small to make stillness informative", () => {
    expect(
      accumulatePatterns([
        obs({ key: "a", priceMove: 0.02 }),
        obs({ key: "b", priceMove: -0.03 }),
      ]),
    ).toHaveLength(0);
  });

  it("builds the uncontested dossier: long-held one side, price moved, other side empty", () => {
    const out = accumulatePatterns([
      obs({ key: "one-sided", kind: "one_sided_persistence", maxDaysHeld: 16, oppositeBelievers: 0, holderCount: 2 }),
      obs({ key: "held", kind: "held_through_price_move", maxDaysHeld: 16, priceMove: -0.08, holderCount: 2 }),
    ]);
    expect(out).toHaveLength(1);
    const d = out[0]!;
    expect(d.kind).toBe("uncontested_conviction");
    expect(d.headline).toBe("16 DAYS. STILL NO ONE ON NO.");
    expect(d.body).toContain("fell 8%");
    expect(d.question).toBe("What would it take for someone to disagree?");
    expect(d.consumes.sort()).toEqual(["held", "one-sided"]);
  });

  it("uncontested fires on tenure alone when there is no proven move", () => {
    const out = accumulatePatterns([
      obs({ key: "one-sided", kind: "one_sided_persistence", maxDaysHeld: 29, oppositeBelievers: 0, holderCount: 1, priceMove: null }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.headline).toBe("29 DAYS. STILL NO ONE ON NO.");
    expect(out[0]!.body).toContain("NO still has nobody");
  });

  it("an observation is consumed by at most one dossier (strongest wins)", () => {
    // A held-through-move that could feed BOTH patterns is claimed once.
    const out = accumulatePatterns([
      obs({ key: "up", priceMove: 0.15, strength: 0.45 }),
      obs({ key: "down", priceMove: -0.4, strength: 0.45 }),
      obs({ key: "one-sided", kind: "one_sided_persistence", oppositeBelievers: 0, maxDaysHeld: 13, strength: 0.3 }),
    ]);
    const allConsumed = out.flatMap((d) => d.consumes);
    expect(new Set(allConsumed).size).toBe(allConsumed.length); // no key consumed twice
  });

  it("keeps patterns on different markets separate", () => {
    const out = accumulatePatterns([
      obs({ key: "m1-up", marketId: 1, priceMove: 0.1 }),
      obs({ key: "m1-down", marketId: 1, priceMove: -0.1 }),
      obs({ key: "m2-up", marketId: 2, priceMove: 0.1 }),
      obs({ key: "m2-down", marketId: 2, priceMove: -0.1 }),
    ]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((d) => d.marketId))).toEqual(new Set([1, 2]));
  });
});
