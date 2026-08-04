import { describe, it, expect } from "vitest";
import {
  findStandingFacts,
  pickStandingFacts,
  tellStandingFact,
  heldText,
  nameThem,
  STANDING,
  type StandingHolder,
  type StandingInput,
} from "./standing-fact";

const h = (o: Partial<StandingHolder> & { wallet: string }): StandingHolder => ({
  name: `n${o.wallet}`,
  avatarUrl: null,
  relationship: null,
  daysHeld: 40,
  positionUsd: 100,
  ...o,
});

const input = (o: Partial<StandingInput> = {}): StandingInput => ({
  marketId: 42,
  marketTitle: "Will it ship?",
  side: "YES",
  holders: [h({ wallet: "0xa" })],
  ...o,
});

describe("nothing is invented", () => {
  it("says nothing when nobody holds anything", () => {
    expect(findStandingFacts(input({ holders: [] }))).toEqual([]);
  });

  it("says nothing about dust", () => {
    const dust = h({ wallet: "0xa", positionUsd: STANDING.minPositionUsd - 1 });
    expect(findStandingFacts(input({ holders: [dust] }))).toEqual([]);
  });

  it("says nothing about a belief too young to be a continuity", () => {
    const fresh = h({ wallet: "0xa", daysHeld: STANDING.minDays - 1 });
    expect(findStandingFacts(input({ holders: [fresh] }))).toEqual([]);
  });

  it("never claims founding without being told the market's age", () => {
    const old = h({ wallet: "0xa", daysHeld: 400 });
    const kinds = findStandingFacts(input({ holders: [old] })).map((f) => f.kind);
    expect(kinds).not.toContain("founding");
  });
});

/**
 * The feed's standing privacy rule — a person in the reader's network is shown
 * moving, never shown taking a side — applies with MORE force here, because a
 * standing fact is about a position they are still holding.
 */
describe("a network member's side is never disclosed", () => {
  const twin = h({ wallet: "0xa", relationship: "twin" });

  it("carries no side on a tribe fact", () => {
    const f = findStandingFacts(input({ holders: [twin] })).find((x) => x.kind === "tribe_present");
    expect(f?.side).toBeNull();
    expect(tellStandingFact(f!).body).not.toMatch(/\bYES\b|\bNO\b/);
  });

  it("carries no side on a crossed-paths fact", () => {
    const recurring = h({ wallet: "0xa", relationship: "tribe", crossings: 5 });
    const f = findStandingFacts(input({ holders: [recurring] })).find(
      (x) => x.kind === "crossed_paths",
    );
    expect(f?.side).toBeNull();
    expect(tellStandingFact(f!).body).not.toMatch(/\bYES\b|\bNO\b/);
  });

  it("keeps network members out of the side-naming facts entirely", () => {
    // Otherwise "Kate has backed YES for 40 days" arrives by the back door.
    const facts = findStandingFacts(
      input({ holders: [twin, h({ wallet: "0xb" })], marketAgeDays: 42 }),
    );
    for (const f of facts) {
      if (f.side == null) continue;
      expect(f.people.some((p) => p.wallet === "0xa")).toBe(false);
    }
  });
});

describe("recognition outranks size", () => {
  it("puts a Twin's small position above a stranger's large one", () => {
    const twin = h({ wallet: "0xa", relationship: "twin", positionUsd: 20, daysHeld: 10 });
    const whale = h({ wallet: "0xb", positionUsd: 50_000, daysHeld: 10 });
    const facts = findStandingFacts(input({ holders: [twin, whale] }));
    expect(facts[0].kind).toBe("tribe_present");
  });

  it("puts a recurring encounter above everything", () => {
    const recurring = h({ wallet: "0xa", relationship: "tribe", crossings: 6 });
    const facts = findStandingFacts(input({ holders: [recurring, h({ wallet: "0xb" })] }));
    expect(facts[0].kind).toBe("crossed_paths");
  });

  it("still has something to say with no reader at all", () => {
    const strangers = [h({ wallet: "0xa" }), h({ wallet: "0xb" })];
    const facts = findStandingFacts(input({ holders: strangers }));
    expect(facts.map((f) => f.kind)).toContain("still_holding");
  });
});

/**
 * The cooldown is what replaces an expiry. A standing fact does not age, so the
 * control is "do not say this to this reader again too soon" — which is what
 * lets a handful of long-held beliefs carry weeks of quiet days.
 */
describe("the cooldown makes a small pool last", () => {
  const facts = [
    { ...findStandingFacts(input())[0], marketId: 1, key: "a", strength: 0.9 },
    { ...findStandingFacts(input())[0], marketId: 2, key: "b", strength: 0.5 },
  ];
  const T = 1_000_000_000;

  it("draws the strongest first", () => {
    expect(pickStandingFacts(facts, new Map(), T, 1).map((f) => f.key)).toEqual(["a"]);
  });

  it("will not repeat itself inside the window", () => {
    const said = new Map([["a", T - 1000]]);
    expect(pickStandingFacts(facts, said, T, 1).map((f) => f.key)).toEqual(["b"]);
  });

  it("says it again once the window has passed", () => {
    const said = new Map([["a", T - STANDING.cooldownMs - 1]]);
    expect(pickStandingFacts(facts, said, T, 1).map((f) => f.key)).toEqual(["a"]);
  });

  it("returns nothing rather than repeating when everything is on cooldown", () => {
    const said = new Map([
      ["a", T],
      ["b", T],
    ]);
    expect(pickStandingFacts(facts, said, T, 5)).toEqual([]);
  });

  it("lets one market own only one quiet moment", () => {
    const sameMarket = [
      { ...facts[0], marketId: 7, key: "x", strength: 0.9 },
      { ...facts[0], marketId: 7, key: "y", strength: 0.8 },
    ];
    expect(pickStandingFacts(sameMarket, new Map(), T, 5)).toHaveLength(1);
  });

  /**
   * A cohort that GROWS is genuinely different news, so its key changes and it
   * may speak before the cooldown is up. That is deliberate, not a leak.
   */
  it("treats a grown group as a new fact", () => {
    const one = findStandingFacts(input({ holders: [h({ wallet: "0xa" })] }));
    const two = findStandingFacts(input({ holders: [h({ wallet: "0xa" }), h({ wallet: "0xb" })] }));
    const k = (fs: typeof one) => fs.find((f) => f.kind === "still_holding")!.key;
    expect(k(two)).not.toBe(k(one));
  });
});

describe("tenure is stated honestly", () => {
  it("marks a floor when the belief predates the index", () => {
    expect(heldText(11, true)).toBe("11+ days");
    expect(heldText(11, false)).toBe("11 days");
    expect(heldText(90, true)).toBe("3+ months");
    expect(heldText(400, true)).toBe("over a year");
  });

  it("carries the floor into the sentence", () => {
    const floored = h({ wallet: "0xa", daysHeld: 11, tenureIsFloor: true });
    const f = findStandingFacts(input({ holders: [floored] }))[0];
    expect(tellStandingFact(f).body).toContain("11+ days");
  });
});

describe("the sentence", () => {
  it("names up to two people, then counts", () => {
    expect(nameThem([h({ wallet: "0xa" })])).toBe("n0xa");
    expect(nameThem([h({ wallet: "0xa" }), h({ wallet: "0xb" })])).toBe("n0xa and n0xb");
    expect(nameThem([h({ wallet: "0xa" }), h({ wallet: "0xb" })], 6)).toBe(
      "n0xa, n0xb, and 4 others",
    );
  });

  it("falls back to a count rather than showing a hex address", () => {
    expect(nameThem([h({ wallet: "0xdeadbeef", name: null })])).toBe("1 believer");
  });

  it("claims duration, never character", () => {
    const f = findStandingFacts(input({ holders: [h({ wallet: "0xa", daysHeld: 400 })] }))[0];
    const body = tellStandingFact(f).body;
    expect(body).toMatch(/backed YES for/);
    expect(body).not.toMatch(/loyal|diamond|steadfast|faithful/i);
  });

  it("says founding only when they really were there at the open", () => {
    const founder = h({ wallet: "0xa", daysHeld: 40 });
    const f = findStandingFacts(input({ holders: [founder], marketAgeDays: 42 })).find(
      (x) => x.kind === "founding",
    );
    expect(tellStandingFact(f!).body).toBe("n0xa has backed YES since the market opened.");
  });

  it("does not call a latecomer a founder", () => {
    const late = h({ wallet: "0xa", daysHeld: 10 });
    const kinds = findStandingFacts(input({ holders: [late], marketAgeDays: 200 })).map(
      (f) => f.kind,
    );
    expect(kinds).not.toContain("founding");
  });
});
