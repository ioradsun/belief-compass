import { describe, it, expect } from "vitest";
import {
  findCohorts,
  cohortKindForViewer,
  renderCohort,
  rungFor,
  rungText,
  nameList,
  faceSplit,
  COHORT,
  selectCohortsForRun,
  type CohortCandidate,
  type CohortHolder,
  type ConvictionCohort,
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

  it("never claims YOUR people at emission — there is no reader there", () => {
    // The emitter has no viewer, so a stored cohort can only ever be
    // holding/founding. Deciding otherwise would give one event two identities.
    const c = findCohorts({
      side: "YES",
      holders: [
        h({ wallet: "a", relationship: "tribe" }),
        h({ wallet: "b", relationship: "twin" }),
        h({ wallet: "c" }),
      ],
    });
    expect(c[0].kind).toBe("holding");
  });

  it("upgrades to YOUR people at read time, once the reader is known", () => {
    const c = findCohorts({
      side: "YES",
      holders: [
        h({ wallet: "a", relationship: "tribe" }),
        h({ wallet: "b", relationship: "twin" }),
        h({ wallet: "c" }),
      ],
    });
    expect(cohortKindForViewer(c[0])).toBe("tribe_holding");
    // The identity never moves with the reader.
    expect(c[0].fingerprint).toContain(":holding:");
  });

  it("leaves a stranger's cohort alone", () => {
    const c = findCohorts({ side: "YES", holders: [h({ wallet: "a" }), h({ wallet: "b" })] });
    expect(cohortKindForViewer(c[0])).toBe("holding");
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

  it("is identical for every reader — who they are to you is applied later", () => {
    // This used to spend 30% of the score on a relationship term that is
    // structurally zero at emission, deflating every real cohort below the
    // publish threshold. The reader's own view is a read-time boost instead.
    const plain = findCohorts({ side: "YES", holders: [h({ wallet: "a" }), h({ wallet: "b" })] });
    const known = findCohorts({
      side: "YES",
      holders: [h({ wallet: "a", relationship: "twin" }), h({ wallet: "b" })],
    });
    expect(known[0].significance).toBe(plain[0].significance);
  });

  it("a bigger share of the side is a bigger story", () => {
    const few = findCohorts({
      side: "YES",
      holders: [h({ wallet: "a" }), h({ wallet: "b" })],
      sideBelievers: 40,
    });
    const many = findCohorts({
      side: "YES",
      holders: [h({ wallet: "a" }), h({ wallet: "b" })],
      sideBelievers: 4,
    });
    expect(many[0].significance).toBeGreaterThan(few[0].significance);
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

/**
 * The publish gate lives in the emitter, but the numbers it compares against are
 * produced here — so the calibration is pinned where the formula is.
 */
describe("a quiet market still has something true to say", () => {
  const PUBLISH = 0.25; // conviction-cohort-emit.server MIN_SIGNIFICANCE

  const cohortAt = (rung: number, people: number, sideBelievers: number) =>
    findCohorts({
      side: "YES",
      sideBelievers,
      holders: Array.from({ length: people }, (_, i) =>
        h({ wallet: `w${i}`, daysHeld: rung + 0.5 }),
      ),
    })[0];

  it("a small group reaching 30 days is publishable — that is the slow-day story", () => {
    expect(cohortAt(30, 2, 20).significance).toBeGreaterThanOrEqual(PUBLISH);
  });

  it("a week-old group publishes only when it is a real part of its side", () => {
    expect(cohortAt(7, 2, 40).significance).toBeLessThan(PUBLISH);
    expect(cohortAt(7, 6, 12).significance).toBeGreaterThanOrEqual(PUBLISH);
  });

  it("one long-held believer counts in a small market, not in a crowd", () => {
    expect(cohortAt(90, 1, 6).significance).toBeGreaterThanOrEqual(PUBLISH);
    expect(cohortAt(30, 1, 200).significance).toBeLessThan(PUBLISH);
  });

  it("rarer rungs clear the bar more easily, as they should", () => {
    const ladder = [7, 30, 60, 90, 180, 365].map((r) => cohortAt(r, 2, 20).significance);
    expect(ladder).toEqual([...ladder].sort((a, b) => a - b));
  });
});

describe("a second wave is a second story", () => {
  const wave = (daysHeld: number, nowMs: number) =>
    findCohorts({
      side: "YES",
      nowMs,
      holders: [h({ wallet: "a", daysHeld }), h({ wallet: "b", daysHeld })],
    })[0];

  const T0 = Date.UTC(2026, 5, 1, 12);

  it("gives a later group crossing the same rung its own identity", () => {
    const first = wave(30.5, T0);
    const later = wave(30.5, T0 + 90 * 86_400_000);
    expect(first.rung).toBe(later.rung);
    expect(first.fingerprint).not.toBe(later.fingerprint);
  });

  it("still collapses the same crossing seen twice in one day", () => {
    // The refresher runs several times a day; daysHeld grows with the clock, so
    // both terms move together and the crossing date must not.
    const morning = wave(30.2, T0);
    const evening = wave(30.2 + 8 / 24, T0 + 8 * 3_600_000);
    expect(evening.fingerprint).toBe(morning.fingerprint);
  });

  it("holds across midnight, where a naive `today` bucket would split", () => {
    const before = wave(30.4, Date.UTC(2026, 5, 1, 23, 50));
    const after = wave(30.4 + 20 / 1440, Date.UTC(2026, 5, 2, 0, 10));
    expect(after.crossedOn).toBe(before.crossedOn);
  });

  it("dates the crossing, not the run", () => {
    // Crossed 30 days half a day ago → the crossing date is when they passed it.
    const c = wave(30.5, Date.UTC(2026, 5, 10, 12));
    expect(c.crossedOn).toBe("2026-06-10");
  });
});

/**
 * A rung can only be crossed on ONE day. If nothing is watching that day, the
 * moment is gone — no later window finds it. This platform lost every 7-day
 * crossing exactly that way, all on the same date, because the emitter was
 * scoped to markets that had recently traded and never ran for the quiet ones.
 */
describe("standing scan — catching up on crossings nobody was watching for", () => {
  const holder = (wallet: string, daysHeld: number): CohortHolder => ({
    wallet,
    name: null,
    avatarUrl: null,
    daysHeld,
    positionUsd: 100,
  });

  it("finds a rung crossed long ago, which the crossing scan will not", () => {
    const holders = [holder("0xa", 45), holder("0xb", 47)];
    expect(findCohorts({ side: "YES", holders, windowDays: 1 })).toHaveLength(0);
    const standing = findCohorts({ side: "YES", holders, scan: "standing" });
    expect(standing).toHaveLength(1);
    expect(standing[0].rung).toBe(30);
  });

  it("counts a holder at their HIGHEST rung only, never at every rung below", () => {
    // Otherwise catch-up republishes one person's history four times over.
    const holders = [holder("0xa", 200), holder("0xb", 210)];
    const rungs = findCohorts({ side: "YES", holders, scan: "standing" }).map((c) => c.rung);
    expect(rungs).toEqual([180]);
  });

  it("agrees with the crossing scan on the fingerprint of the same fact", () => {
    // This is what makes catch-up safe to run: a caught-up emission and the
    // daily one that should have happened collapse onto the same source_key.
    const now = Date.UTC(2026, 5, 10, 12);
    const holders = [holder("0xa", 30.5), holder("0xb", 30.4)];
    const crossing = findCohorts({ side: "YES", holders, windowDays: 1, nowMs: now });
    const standing = findCohorts({ side: "YES", holders, scan: "standing", nowMs: now });
    expect(standing[0].fingerprint).toBe(crossing[0].fingerprint);
  });
});

/**
 * Cohorts are paced by the CALENDAR, not by trading, so markets whose believers
 * arrived together reach every rung together. With one index epoch behind the
 * whole platform, ~681 markets cross the 30-day rung on the same day.
 */
describe("selectCohortsForRun — a mass crossing drains, it does not dump", () => {
  const candidate = (marketId: number, significance: number, rung = 30): CohortCandidate => ({
    marketId,
    cohort: {
      kind: "holding",
      side: "YES",
      rung: rung as ConvictionCohort["rung"],
      people: [],
      fingerprint: `cohort:YES:holding:${rung}:2026-08-23`,
      crossedOn: "2026-08-23",
      significance,
    },
  });

  it("publishes the strongest, up to the cap", () => {
    const many = Array.from({ length: 50 }, (_, i) => candidate(i, i / 100));
    const picked = selectCohortsForRun(many, 5);
    expect(picked).toHaveLength(5);
    expect(picked.map((p) => p.marketId)).toEqual([49, 48, 47, 46, 45]);
  });

  it("is total and deterministic, so successive runs reach what is behind", () => {
    // Identical significance must still produce a stable order, or the same few
    // markets win every run and the rest starve.
    const tied = [candidate(9, 0.5), candidate(3, 0.5), candidate(7, 0.5)];
    expect(selectCohortsForRun(tied, 3).map((p) => p.marketId)).toEqual([3, 7, 9]);
    expect(selectCohortsForRun([...tied].reverse(), 3).map((p) => p.marketId)).toEqual([3, 7, 9]);
  });

  it("defers rather than discards — everything survives to the next run", () => {
    const many = Array.from({ length: 20 }, (_, i) => candidate(i, i / 100));
    const first = selectCohortsForRun(many, 5).map((p) => p.marketId);
    const rest = many.filter((c) => !first.includes(c.marketId));
    expect(rest).toHaveLength(15);
    expect(selectCohortsForRun(rest, 5).map((p) => p.marketId)).toEqual([14, 13, 12, 11, 10]);
  });

  it("never returns more than exists, or anything at all with no room", () => {
    expect(selectCohortsForRun([candidate(1, 0.9)], 10)).toHaveLength(1);
    expect(selectCohortsForRun([candidate(1, 0.9)], 0)).toHaveLength(0);
  });
});
