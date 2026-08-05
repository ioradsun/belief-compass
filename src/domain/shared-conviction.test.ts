import { describe, it, expect } from "vitest";
import { sharedConvictionLine, type PresentPerson } from "./shared-conviction";

const p = (o: Partial<PresentPerson> & { wallet: string }): PresentPerson => ({
  relationship: "tribe",
  side: "YES",
  ...o,
});

describe("the line says which way they went", () => {
  it("names a Twin's side", () => {
    expect(sharedConvictionLine([p({ wallet: "0xa", relationship: "twin", side: "NO" })])).toBe(
      "Your Twin is on NO",
    );
  });

  it("names a Rival's side", () => {
    expect(sharedConvictionLine([p({ wallet: "0xa", relationship: "opp", side: "YES" })])).toBe(
      "One of your Rivals is on YES",
    );
  });

  it("names a whole Tribe's side when they agree", () => {
    const tribe = [p({ wallet: "0xa" }), p({ wallet: "0xb" }), p({ wallet: "0xc" })];
    expect(sharedConvictionLine(tribe)).toBe("3 people from your Tribe are on YES");
  });

  it("keeps the singular honest", () => {
    expect(sharedConvictionLine([p({ wallet: "0xa", side: "NO" })])).toBe(
      "1 person from your Tribe is on NO",
    );
  });
});

/**
 * A Twin outranks a group: "the person who thinks most like you" is a stronger
 * reason to look than three people who merely lean your way.
 */
describe("strongest relationship leads", () => {
  it("puts a Twin above a Tribe that is also here", () => {
    const here = [p({ wallet: "0xa" }), p({ wallet: "0xb", relationship: "twin", side: "NO" })];
    expect(sharedConvictionLine(here)).toBe("Your Twin is on NO");
  });

  it("puts a Tribe above a Rival", () => {
    const here = [p({ wallet: "0xa" }), p({ wallet: "0xb", relationship: "inverse", side: "NO" })];
    expect(sharedConvictionLine(here)).toBe("1 person from your Tribe is on YES");
  });

  it("falls back to the circle when the relationships are all opposed", () => {
    const here = [
      p({ wallet: "0xa", relationship: "opp", side: "NO" }),
      p({ wallet: "0xb", relationship: "inverse", side: "NO" }),
    ];
    expect(sharedConvictionLine(here)).toBe("One of your Rivals is on NO");
  });
});

/**
 * The disagreement is more useful than whichever side happens to have more of
 * them — and it is the only version of this line that cannot read as a nudge.
 */
describe("a split is the better story", () => {
  it("reports the split rather than the majority", () => {
    const split = [
      p({ wallet: "0xa", side: "YES" }),
      p({ wallet: "0xb", side: "YES" }),
      p({ wallet: "0xc", side: "NO" }),
    ];
    expect(sharedConvictionLine(split)).toBe("3 people from your Tribe are split here");
  });

  it("never frames anyone as agreeing with the reader", () => {
    const lines = [
      sharedConvictionLine([p({ wallet: "0xa", relationship: "twin" })]),
      sharedConvictionLine([p({ wallet: "0xa" }), p({ wallet: "0xb", side: "NO" })]),
    ].join(" ");
    expect(lines).not.toMatch(/agree|right|with you|like you|should/i);
  });

  it("never states an amount — belonging is presence and direction", () => {
    const line = sharedConvictionLine([p({ wallet: "0xa", relationship: "twin" })]);
    expect(line).not.toMatch(/\$|\d+\s*(shares|USD)/);
  });
});

describe("honest degradation", () => {
  it("says nothing at all when nobody is here", () => {
    expect(sharedConvictionLine([])).toBeNull();
  });

  it("reports presence when the side is genuinely unknown", () => {
    expect(sharedConvictionLine([p({ wallet: "0xa", relationship: "twin", side: null })])).toBe(
      "Your Twin is in this market",
    );
    expect(sharedConvictionLine([p({ wallet: "0xa", side: null })])).toBe(
      "1 person from your Tribe is here",
    );
  });

  it("does not claim one side when only some of them have one", () => {
    const partial = [p({ wallet: "0xa", side: "YES" }), p({ wallet: "0xb", side: null })];
    expect(sharedConvictionLine(partial)).toBe("2 people from your Tribe are here");
  });
});
