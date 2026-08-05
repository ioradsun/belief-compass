import { describe, it, expect } from "vitest";
import { peopleAround, NETWORK, type Overlap } from "./person-network";

const ov = (o: Partial<Overlap> & { wallet: string }): Overlap => ({
  name: o.wallet,
  avatarUrl: null,
  sharedMarkets: 10,
  sameSide: 5,
  oppositeSide: 5,
  currentlyTogether: 0,
  daysSinceTogether: null,
  byTopic: [],
  enteredAfter: 0,
  ...o,
});

/**
 * Helpers that keep the RATIO honest when the overlap size is overridden.
 * Setting `sharedMarkets` alone left `sameSide` behind, which quietly turned a
 * "clearly aligned" fixture into a coin flip — the first version of this file
 * did exactly that and the pattern test caught it.
 */
const leaning = (w: string, sameShare: number, over: Partial<Overlap> = {}) => {
  const shared = over.sharedMarkets ?? 10;
  const same = Math.round(shared * sameShare);
  return ov({
    wallet: w,
    ...over,
    sharedMarkets: shared,
    sameSide: same,
    oppositeSide: shared - same,
  });
};
const aligned = (w: string, over: Partial<Overlap> = {}) => leaning(w, 0.9, over);
const opposed = (w: string, over: Partial<Overlap> = {}) => leaning(w, 0.1, over);

describe("a connection must be earned before it is claimed", () => {
  it("ignores an overlap too small to be a pattern", () => {
    const thin = ov({ wallet: "0xa", sharedMarkets: NETWORK.minShared - 1 });
    expect(peopleAround([thin])).toEqual([]);
  });

  it("returns nothing rather than filling the section", () => {
    expect(peopleAround([])).toEqual([]);
  });

  it("always shows the count behind the claim", () => {
    const [p] = peopleAround([aligned("0xa")]);
    expect(p.lines[0]).toBe("Took a side in 10 of the same markets.");
  });
});

/**
 * The output this module exists instead of. A relationship between two people
 * has a shape; a single number flattens all of them into one claim and explains
 * none of it.
 */
describe("patterns, never a score", () => {
  it("never emits a percentage or a match", () => {
    const all = peopleAround([
      aligned("0xa", { byTopic: [{ topic: "technology", same: 6, opposite: 0 }] }),
      opposed("0xb", { byTopic: [{ topic: "economics", same: 0, opposite: 7 }] }),
      ov({ wallet: "0xc", sharedMarkets: 8, sameSide: 4, oppositeSide: 4 }),
    ])
      .flatMap((p) => p.lines)
      .join(" ");
    expect(all).not.toMatch(/%|percent|match|score|similar/i);
  });

  it("names the shape of the connection", () => {
    expect(peopleAround([aligned("0xa")])[0].pattern).toBe("aligned");
    expect(peopleAround([opposed("0xa")])[0].pattern).toBe("opposed");
    expect(
      peopleAround([ov({ wallet: "0xa", sharedMarkets: 10, sameSide: 5, oppositeSide: 5 })])[0]
        .pattern,
    ).toBe("co_participant");
  });

  it("claims no tendency when there is no lean", () => {
    const [p] = peopleAround([
      ov({ wallet: "0xa", sharedMarkets: 10, sameSide: 5, oppositeSide: 5 }),
    ]);
    expect(p.lines[1]).toBe("They land on the same side about as often as not.");
  });
});

describe("topics are named only where the evidence sits", () => {
  it("names where they agree, and the exception", () => {
    const [p] = peopleAround([
      aligned("0xa", {
        byTopic: [
          { topic: "technology", same: 6, opposite: 0 },
          { topic: "economics", same: 0, opposite: 3 },
        ],
      }),
    ]);
    expect(p.lines[1]).toBe("Usually backs the same side on technology.");
    expect(p.lines[2]).toBe("Takes the other side on economics.");
  });

  it("names where they differ, and the common ground", () => {
    const [p] = peopleAround([
      opposed("0xa", {
        byTopic: [
          { topic: "economics", same: 0, opposite: 6 },
          { topic: "technology", same: 3, opposite: 0 },
        ],
      }),
    ]);
    expect(p.lines[1]).toBe("Usually takes the other side on economics.");
    expect(p.lines[2]).toBe("They do agree on technology.");
  });

  it("refuses a topic with only one shared market in it", () => {
    const [p] = peopleAround([
      aligned("0xa", { byTopic: [{ topic: "sports", same: 1, opposite: 0 }] }),
    ]);
    expect(p.lines.join(" ")).not.toContain("sports");
    expect(p.lines[1]).toBe("Usually backs the same side.");
  });

  it("refuses a topic where they are split down the middle", () => {
    const [p] = peopleAround([
      aligned("0xa", { byTopic: [{ topic: "politics", same: 3, opposite: 3 }] }),
    ]);
    expect(p.lines.join(" ")).not.toContain("politics");
  });
});

describe("sequence is stated as sequence", () => {
  it("says who tends to arrive second without saying why", () => {
    const [p] = peopleAround([aligned("0xa", { enteredAfter: 9 })]);
    expect(p.lines).toContain("Usually takes a side after them.");
    // Not "follows their lead", not "copies" — a timestamp is not a motive.
    expect(p.lines.join(" ")).not.toMatch(/follows their|copies|imitat|because/i);
  });

  it("stays quiet when the order is mixed", () => {
    const [p] = peopleAround([aligned("0xa", { enteredAfter: 4 })]);
    expect(p.lines.join(" ")).not.toMatch(/after them/);
  });
});

describe("what is happening now earns its own line", () => {
  it("counts live shared markets", () => {
    const [p] = peopleAround([aligned("0xa", { currentlyTogether: 4 })]);
    expect(p.lines).toContain("Active together in 4 markets now.");
  });

  it("keeps the singular honest", () => {
    const [p] = peopleAround([aligned("0xa", { currentlyTogether: 1 })]);
    expect(p.lines).toContain("Active together in 1 market now.");
  });

  it("says nothing when they share nothing live", () => {
    const [p] = peopleAround([aligned("0xa", { currentlyTogether: 0 })]);
    expect(p.lines.join(" ")).not.toMatch(/now\./);
  });
});

describe("the list is a doorway, not a directory", () => {
  it("shows at most three", () => {
    const many = Array.from({ length: 9 }, (_, i) => aligned(`0x${i}`, { sharedMarkets: 20 - i }));
    expect(peopleAround(many)).toHaveLength(NETWORK.maxPeople);
  });

  /**
   * The variety cap is a preference, not a reason to withhold a real
   * connection. Someone whose overlaps are genuinely all one shape still gets a
   * full section — the first version of this capped them at two, which punished
   * a person for being consistent.
   */
  it("still fills the section when every connection is the same shape", () => {
    const allAligned = [40, 30, 20, 10].map((n, i) => aligned(`0x${i}`, { sharedMarkets: n }));
    expect(peopleAround(allAligned)).toHaveLength(NETWORK.maxPeople);
  });

  /**
   * Three "usually backs the same side" rows make the pattern vocabulary
   * invisible and turn the section back into the similarity list it exists
   * instead of.
   */
  it("does not fill every slot with the same pattern", () => {
    const rows = [
      aligned("0xa", { sharedMarkets: 40 }),
      aligned("0xb", { sharedMarkets: 30 }),
      aligned("0xc", { sharedMarkets: 20 }),
      opposed("0xd", { sharedMarkets: 5 }),
    ];
    const out = peopleAround(rows);
    expect(out.filter((p) => p.pattern === "aligned")).toHaveLength(NETWORK.maxPerPattern);
    expect(out.some((p) => p.pattern === "opposed")).toBe(true);
  });

  it("leads with the strongest connection", () => {
    const out = peopleAround([
      aligned("0xweak", { sharedMarkets: 4 }),
      aligned("0xstrong", { sharedMarkets: 30, currentlyTogether: 6, daysSinceTogether: 1 }),
    ]);
    expect(out[0].wallet).toBe("0xstrong");
  });

  it("is deterministic when two connections are identical", () => {
    const a = peopleAround([aligned("0xa"), aligned("0xb")]).map((p) => p.wallet);
    const b = peopleAround([aligned("0xb"), aligned("0xa")]).map((p) => p.wallet);
    expect(a).toEqual(b);
  });
});

/**
 * Ranking by position size would sort "who has the most money in the same
 * markets" and call it a relationship. The safeguard that works is not
 * collecting it: `Overlap` has no capital field at all, so this is a test that
 * the SHAPE stays honest.
 */
describe("money is not a connection", () => {
  it("has no capital input to be dominated by", () => {
    const keys = Object.keys(aligned("0xa"));
    for (const banned of ["capital", "valueUsd", "positionUsd", "volume", "cost"]) {
      expect(keys).not.toContain(banned);
    }
  });
});
