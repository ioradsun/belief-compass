import { describe, it, expect } from "vitest";
import { compareSides, comparisonStrip, COMPARE, type SideSnapshot } from "./side-compare";

const side = (o: Partial<SideSnapshot> = {}): SideSnapshot => ({
  believers: 10,
  capitalUsd: 500,
  joined: 0,
  capitalChangePct: 0,
  ...o,
});

describe("an empty side outranks everything", () => {
  it("says so plainly, even while the other side is surging", () => {
    const c = compareSides(side({ joined: 40 }), side({ believers: 0, capitalUsd: 0 }));
    expect(c).toEqual({ story: "Nobody currently backs NO.", focus: "YES" });
  });

  it("works in the other direction", () => {
    expect(compareSides(side({ believers: 0 }), side()).story).toBe("Nobody currently backs YES.");
  });

  it("has a sentence for a market nobody has entered", () => {
    const c = compareSides(side({ believers: 0 }), side({ believers: 0 }));
    expect(c).toEqual({ story: "No one has taken a side here yet.", focus: null });
  });
});

describe("movement beats size", () => {
  it("leads with who arrived, not who is bigger", () => {
    // NO is four times the size; YES is the one that moved.
    const c = compareSides(side({ believers: 10, joined: 3 }), side({ believers: 40 }));
    expect(c).toEqual({ story: "3 believers joined YES.", focus: "YES" });
  });

  it("keeps the singular honest", () => {
    const c = compareSides(side({ joined: 2 }), side());
    expect(c.story).toBe("2 believers joined YES.");
    // …and one arrival is a person, not momentum — see the next block.
  });

  it("has a better sentence when both sides are gaining", () => {
    const c = compareSides(side({ joined: 4 }), side({ joined: 4 }));
    expect(c).toEqual({ story: "Both sides are gaining believers.", focus: null });
  });
});

/**
 * The refusals. A market with one new believer and a 2% capital tick has not
 * done anything, and dressing that up as momentum is how a calm interface
 * becomes a noisy one.
 */
describe("no trend is manufactured from noise", () => {
  it("does not call a single arrival momentum", () => {
    const c = compareSides(side({ joined: COMPARE.minJoined - 1 }), side());
    expect(c.story).not.toMatch(/joined/);
  });

  it("ignores a capital move too small to mean anything", () => {
    const c = compareSides(
      side({ capitalChangePct: COMPARE.minCapitalMovePct - 1 }),
      side({ capitalChangePct: 0 }),
    );
    expect(c.story).not.toMatch(/Capital/);
  });

  it("falls back to the honest dull answer", () => {
    expect(compareSides(side(), side()).story).toBe("Both sides are evenly matched.");
  });
});

describe("capital speaks only when nobody arrived", () => {
  it("names the direction it moved", () => {
    const c = compareSides(side({ capitalChangePct: 30 }), side());
    expect(c).toEqual({ story: "Capital moved toward YES.", focus: "YES" });
  });

  it("names a withdrawal as a withdrawal", () => {
    const c = compareSides(side({ capitalChangePct: -30 }), side());
    expect(c).toEqual({ story: "Capital pulled back from YES.", focus: "YES" });
  });

  it("yields to people — an arrival outranks any amount of money", () => {
    const c = compareSides(side({ capitalChangePct: 400 }), side({ joined: 5 }));
    expect(c.story).toBe("5 believers joined NO.");
  });
});

describe("the standing balance, when nothing moved", () => {
  it("calls a close market evenly matched", () => {
    expect(compareSides(side({ believers: 10 }), side({ believers: 8 })).story).toBe(
      "Both sides are evenly matched.",
    );
  });

  it("names the leader once it is genuinely ahead", () => {
    const c = compareSides(side({ believers: 30 }), side({ believers: 6 }));
    expect(c).toEqual({ story: "YES holds most of the room, 30 to 6.", focus: "YES" });
  });

  it("never reads as advice", () => {
    const stories = [
      compareSides(side({ believers: 30 }), side({ believers: 6 })).story,
      compareSides(side({ joined: 9 }), side()).story,
      compareSides(side({ capitalChangePct: 40 }), side()).story,
    ].join(" ");
    expect(stories).not.toMatch(/should|winning|better|right|smart|safe/i);
  });
});

/**
 * `share` is computed beside the numbers precisely so a bar and its labels
 * cannot disagree — the bug this shape exists to make impossible.
 */
describe("the strip cannot contradict itself", () => {
  it("splits proportionally to the believer counts", () => {
    const [yes, no] = comparisonStrip(side({ believers: 30 }), side({ believers: 10 }));
    expect(yes.share).toBeCloseTo(0.75, 6);
    expect(no.share).toBeCloseTo(0.25, 6);
    expect(yes.share + no.share).toBeCloseTo(1, 12);
  });

  it("splits an empty market evenly rather than dividing by zero", () => {
    const [yes, no] = comparisonStrip(side({ believers: 0 }), side({ believers: 0 }));
    expect(yes.share).toBe(0.5);
    expect(no.share).toBe(0.5);
  });

  it("carries the arrivals so the strip can show what moved", () => {
    const [yes] = comparisonStrip(side({ joined: 3 }), side());
    expect(yes.joined).toBe(3);
  });

  it("never invents a negative or fractional believer", () => {
    const [yes] = comparisonStrip(side({ believers: -5 }), side({ believers: 3.7 }));
    expect(yes.believers).toBe(0);
    expect(comparisonStrip(side({ believers: 3.7 }), side())[0].believers).toBe(3);
  });
});
