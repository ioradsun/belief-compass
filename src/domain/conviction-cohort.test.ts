import { describe, it, expect } from "vitest";
import {
  findCohorts,
  renderCohort,
  rungFor,
  rungText,
  nameList,
  faceSplit,
  COHORT,
  type CohortHolder,
} from "./conviction-cohort";

const h = (o: Partial<CohortHolder> & { wallet: string }): CohortHolder => ({
  name: `n${o.wallet}`,
  avatarUrl: null,
  daysHeld: 30.5,
  positionUsd: 100,
  relationship: null,
  ...o,
});

describe("milestones, not ticking", () => {
  it("reports a rung only in the window it was crossed", () => {
    // 30.5 days: yesterday they were at 29.5, so 30 was crossed today. Story.
    expect(
      findCohorts({ side: "YES", holders: [h({ wallet: "a" }), h({ wallet: "b" })] }),
    ).toHaveLength(1);
    // 45 days → crossed 30 a fortnight ago. Already told. Silence.
    const old = findCohorts({
      side: "YES",
      holders: [h({ wallet: "a", daysHeld: 45 }), h({ wallet: "b", daysHeld: 45 })],
    });
    expect(old).toHaveLength(0);
  });

  it("never emits the same rung on consecutive days", () => {
    for (const daysHeld of [32, 33, 34, 40]) {
      const c = findCohorts({
        side: "YES",
        holders: [h({ wallet: "a", daysHeld }), h({ wallet: "b", daysHeld })],
      });
      expect(c).toHaveLength(0);
    }
  });

  it("uses durations people actually think in", () => {
    expect(rungFor(6)).toBeNull();
    expect(rungFor(7)).toBe(7);
    expect(rungFor(29)).toBe(7);
    expect(rungFor(30)).toBe(30);
    expect(rungFor(400)).toBe(365);
    expect(rungText(30)).toBe("30 days");
    expect(rungText(90)).toBe("3 months");
    expect(rungText(365)).toBe("a year");
  });
});

describe("the group outranks the individual", () => {
  it("three people crossing 30 days is ONE story", () => {
    const c = findCohorts({
      side: "YES",
      holders: [h({ wallet: "a" }), h({ wallet: "b" }), h({ wallet: "c" })],
    });
    expect(c).toHaveLength(1);
    expect(c[0].people).toHaveLength(3);
  });

  it("a lone believer at the first rung is not news", () => {
    expect(findCohorts({ side: "YES", holders: [h({ wallet: "a", daysHeld: 7.5 })] })).toHaveLength(
      0,
    );
  });

  it("...but a lone believer at 90 days is", () => {
    const c = findCohorts({ side: "YES", holders: [h({ wallet: "a", daysHeld: 90.5 })] });
    expect(c).toHaveLength(1);
    expect(c[0].rung).toBe(90);
  });
});

describe("recognition is earned", () => {
  it("dust positions buy neither a face nor a mention", () => {
    const c = findCohorts({
      side: "YES",
      holders: [
        h({ wallet: "a", positionUsd: 0.5 }),
        h({ wallet: "b", positionUsd: 1 }),
        h({ wallet: "c", positionUsd: 2 }),
      ],
    });
    expect(c).toHaveLength(0);
  });

  it("a spray of tiny wallets cannot manufacture a cohort", () => {
    const spam = Array.from({ length: 40 }, (_, i) =>
      h({ wallet: `s${i}`, positionUsd: COHORT.minPositionUsd - 0.01 }),
    );
    expect(findCohorts({ side: "YES", holders: spam })).toHaveLength(0);
  });
});

describe("who leads the stack", () => {
  it("puts people you know first, then the longest-held", () => {
    const c = findCohorts({
      side: "YES",
      holders: [
        h({ wallet: "a", daysHeld: 30.5, positionUsd: 900 }),
        h({ wallet: "b", daysHeld: 30.5, relationship: "twin" }),
        h({ wallet: "c", daysHeld: 30.5, relationship: "tribe" }),
      ],
    });
    expect(c[0].people.map((p) => p.wallet)).toEqual(["b", "c", "a"]);
  });

  it("is deterministic — the same cohort always shows the same faces", () => {
    const holders = [h({ wallet: "a" }), h({ wallet: "b" }), h({ wallet: "c" })];
    const one = findCohorts({ side: "YES", holders });
    const two = findCohorts({ side: "YES", holders: [...holders].reverse() });
    expect(one[0].people.map((p) => p.wallet)).toEqual(two[0].people.map((p) => p.wallet));
  });
});

describe("claims are only made when evidenced", () => {
  it("never calls anyone a founding believer without the market's age", () => {
    const c = findCohorts({
      side: "YES",
      holders: [h({ wallet: "a", daysHeld: 30.5 }), h({ wallet: "b", daysHeld: 30.5 })],
    });
    expect(c[0].kind).not.toBe("founding");
  });

  it("names founding believers when they have been there the whole time", () => {
    const c = findCohorts({
      side: "YES",
      marketAgeDays: 31,
      holders: [h({ wallet: "a", daysHeld: 30.5 }), h({ wallet: "b", daysHeld: 30.9 })],
    });
    expect(c[0].kind).toBe("founding");
  });

  it("recognises your own people when enough of them are here", () => {
    const c = findCohorts({
      side: "YES",
      holders: [
        h({ wallet: "a", relationship: "tribe" }),
        h({ wallet: "b", relationship: "twin" }),
        h({ wallet: "c" }),
      ],
    });
    expect(c[0].kind).toBe("tribe_holding");
  });
});

describe("significance ranks meaning, not chronology", () => {
  it("a rarer rung outranks a common one", () => {
    const c = findCohorts({
      side: "YES",
      holders: [
        h({ wallet: "a", daysHeld: 7.5 }),
        h({ wallet: "b", daysHeld: 7.5 }),
        h({ wallet: "c", daysHeld: 90.5 }),
        h({ wallet: "d", daysHeld: 90.5 }),
      ],
    });
    expect(c[0].rung).toBe(90);
    expect(c[0].significance).toBeGreaterThan(c[1].significance);
  });

  it("people you know raise a story's value", () => {
    const plain = findCohorts({ side: "YES", holders: [h({ wallet: "a" }), h({ wallet: "b" })] });
    const known = findCohorts({
      side: "YES",
      holders: [h({ wallet: "a", relationship: "twin" }), h({ wallet: "b" })],
    });
    expect(known[0].significance).toBeGreaterThan(plain[0].significance);
  });
});

describe("one story, rendered for where it is read", () => {
  const cohort = findCohorts({
    side: "YES",
    holders: [
      h({ wallet: "a", name: "Jon" }),
      h({ wallet: "b", name: "Kate" }),
      ...Array.from({ length: 12 }, (_, i) => h({ wallet: `x${i}`, name: `P${i}` })),
    ],
  })[0];

  it("the app-wide feed names the market and the side — it has no other context", () => {
    const s = renderCohort(cohort, "app", "Are you up overall in crypto?");
    expect(s.headline).toBe("HOLDING STRONG");
    expect(s.body).toBe("Jon, Kate, and 12 others have backed YES for 30 days.");
    expect(s.marketTitle).toBe("Are you up overall in crypto?");
  });

  it("the panel strips what the column already says", () => {
    const s = renderCohort(cohort, "panel", "Are you up overall in crypto?");
    expect(s.body).toBe("Jon, Kate, and 12 others reached 30 days.");
    expect(s.body).not.toMatch(/\bYES\b/);
    expect(s.marketTitle).toBeNull();
  });

  it("is the same underlying story either way", () => {
    const a = renderCohort(cohort, "app", "Q");
    const p = renderCohort(cohort, "panel", "Q");
    expect(a.fingerprint).toBe(p.fingerprint);
    expect(a.people).toEqual(p.people);
    expect(a.headline).toBe(p.headline);
  });
});

describe("the stack", () => {
  it("shows a few faces and counts the rest", () => {
    const people = Array.from({ length: 15 }, (_, i) => h({ wallet: `w${i}` }));
    const { faces, overflow } = faceSplit(people);
    expect(faces).toHaveLength(COHORT.maxFaces);
    expect(overflow).toBe(15 - COHORT.maxFaces);
  });

  it("has no overflow when everyone fits", () => {
    expect(faceSplit([h({ wallet: "a" }), h({ wallet: "b" })]).overflow).toBe(0);
  });

  it("folds unnameable people into the count rather than printing an address", () => {
    const people = [h({ wallet: "0xabc", name: null }), h({ wallet: "0xdef", name: null })];
    expect(nameList(people)).toBe("2 believers");
    expect(nameList(people)).not.toMatch(/0x/);
  });

  it("reads naturally at every group size", () => {
    expect(nameList([h({ wallet: "a", name: "Jon" })])).toBe("Jon");
    expect(nameList([h({ wallet: "a", name: "Jon" }), h({ wallet: "b", name: "Kate" })])).toBe(
      "Jon and Kate",
    );
    expect(
      nameList([
        h({ wallet: "a", name: "Jon" }),
        h({ wallet: "b", name: "Kate" }),
        h({ wallet: "c", name: "Maya" }),
      ]),
    ).toBe("Jon, Kate, and 1 other");
  });
});

describe("celebration without coercion", () => {
  const all = [
    findCohorts({ side: "YES", holders: [h({ wallet: "a" }), h({ wallet: "b" })] })[0],
    findCohorts({
      side: "NO",
      marketAgeDays: 31,
      holders: [h({ wallet: "a", daysHeld: 30.5 }), h({ wallet: "b", daysHeld: 30.9 })],
    })[0],
    findCohorts({
      side: "YES",
      holders: [
        h({ wallet: "a", relationship: "twin" }),
        h({ wallet: "b", relationship: "tribe" }),
      ],
    })[0],
  ];

  it("states duration, never character", () => {
    // "Steadfast" / "diamond hands" / "true believer" are claims about a person
    // that no position history can evidence.
    const unearned = /steadfast|unwavering|diamond|loyal|faithful|true believer|brave|smart/i;
    for (const c of all) {
      for (const surface of ["app", "panel"] as const) {
        const s = renderCohort(c, surface, "Q");
        expect(`${s.headline} ${s.body}`).not.toMatch(unearned);
      }
    }
  });

  it("never tells anyone to stay", () => {
    const coercive = /don't sell|hold on|stay strong|keep holding|don't give up|paper hands/i;
    for (const c of all) {
      for (const surface of ["app", "panel"] as const) {
        const s = renderCohort(c, surface, "Q");
        expect(`${s.headline} ${s.body}`).not.toMatch(coercive);
      }
    }
  });

  it("keeps the headline a kicker and the body one sentence", () => {
    for (const c of all) {
      const s = renderCohort(c, "app", "Q");
      expect(s.headline).not.toMatch(/\.$/);
      expect(s.headline.split(/\s+/).length).toBeLessThanOrEqual(4);
      expect(s.body.split(".").filter((x) => x.trim()).length).toBe(1);
    }
  });
});
