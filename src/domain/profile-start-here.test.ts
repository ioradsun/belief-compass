import { describe, it, expect } from "vitest";
import { startHere, rankStartCandidates, START, type StartCandidate } from "./profile-start-here";

const c = (o: Partial<StartCandidate> & { marketId: number }): StartCandidate => ({
  title: `Market ${o.marketId}`,
  personSide: "YES",
  valueUsd: 100,
  daysHeld: 30,
  tenureIsFloor: false,
  againstPct: null,
  participants: 20,
  viewerSide: null,
  category: "technology",
  topicUsuallyAligned: false,
  isLargest: false,
  isLongest: false,
  ...o,
});

describe("it is not simply their biggest position", () => {
  it("prefers a surprising disagreement over the largest holding", () => {
    const biggest = c({ marketId: 1, isLargest: true, valueUsd: 50_000 });
    const clash = c({
      marketId: 2,
      viewerSide: "NO",
      personSide: "YES",
      topicUsuallyAligned: true,
      valueUsd: 20,
    });
    expect(startHere([biggest, clash])?.marketId).toBe(2);
  });

  it("prefers a conviction you have not met over one you already share", () => {
    const shared = c({ marketId: 1, viewerSide: "YES", personSide: "YES", isLargest: true });
    const fresh = c({ marketId: 2, viewerSide: null });
    expect(startHere([shared, fresh])?.marketId).toBe(2);
  });

  it("still picks the largest when nothing more revealing exists", () => {
    const big = c({ marketId: 1, isLargest: true, valueUsd: 9_000 });
    const small = c({ marketId: 2 });
    expect(startHere([big, small])?.marketId).toBe(1);
  });
});

/**
 * Two people on opposite sides of a market with three participants have not had
 * a debate. The room is what makes a disagreement worth opening.
 */
describe("a disagreement needs a real room", () => {
  it("ignores a clash in an empty market", () => {
    const thin = c({
      marketId: 1,
      viewerSide: "NO",
      topicUsuallyAligned: true,
      participants: START.minParticipants - 1,
    });
    const solid = c({ marketId: 2, isLargest: true, valueUsd: 5_000 });
    expect(startHere([thin, solid])?.marketId).toBe(2);
  });

  /**
   * At the floor a clash REGISTERS — it beats a market where you already agree
   * — but registering is not the same as leading the page. Outranking a real
   * defining conviction takes a real room, which is what
   * `minParticipantsForSurprise` and the significance term are between them for.
   */
  it("registers once the room clears the floor", () => {
    const clash = c({
      marketId: 1,
      viewerSide: "NO",
      topicUsuallyAligned: true,
      participants: START.minParticipants,
    });
    const agreed = c({ marketId: 2, viewerSide: "YES", personSide: "YES", isLargest: true });
    expect(startHere([clash, agreed])?.marketId).toBe(1);
  });

  it("but a bare floor is not enough to outrank a real conviction", () => {
    const clash = c({
      marketId: 1,
      viewerSide: "NO",
      topicUsuallyAligned: true,
      participants: START.minParticipants,
    });
    const solid = c({ marketId: 2, isLargest: true, valueUsd: 5_000, participants: 80 });
    expect(startHere([clash, solid])?.marketId).toBe(2);
  });
});

describe("the sentence explains itself, in terms of both people", () => {
  it("names the surprise when a shared topic splits them", () => {
    const r = startHere(
      [c({ marketId: 1, viewerSide: "NO", personSide: "YES", topicUsuallyAligned: true })],
      { personName: "Sarah" },
    );
    expect(r?.why).toBe(
      "Sarah — You two usually agree on technology, and here you do not — you back NO, they back YES.",
    );
  });

  it("says what is unexplored when there is no disagreement", () => {
    const r = startHere([c({ marketId: 1, isLargest: true, valueUsd: 4_000 })], {
      personName: "Sarah",
    });
    expect(r?.why).toBe(
      "Sarah — Their largest current position, and you have not taken a side here yet.",
    );
  });

  it("carries the tenure floor into the sentence", () => {
    const r = startHere(
      [c({ marketId: 1, isLongest: true, daysHeld: 512, tenureIsFloor: true, viewerSide: "YES" })],
      { personName: "Sarah" },
    );
    expect(r?.why).toContain("512+ days");
  });

  it("falls back to a neutral subject with no name", () => {
    expect(startHere([c({ marketId: 1, isLargest: true })])?.why).toMatch(/^They — /);
  });

  it("never reads as advice", () => {
    const all = [
      startHere([c({ marketId: 1, isLargest: true })])?.why,
      startHere([c({ marketId: 2, viewerSide: "NO", topicUsuallyAligned: true })])?.why,
      startHere([c({ marketId: 3, againstPct: 88, isLongest: true })])?.why,
    ].join(" ");
    expect(all).not.toMatch(/should|winning|best bet|smart|profit|recommended/i);
  });
});

/**
 * A candidate that cannot say why it is the one does not get to be the one.
 * "Recommended" is the failure this refuses.
 */
describe("it refuses rather than defaults", () => {
  it("returns null with nothing to recommend", () => {
    expect(startHere([])).toBeNull();
  });

  it("skips a candidate with nothing specific to say and takes the next", () => {
    // Agreed, unremarkable, no defining status → nothing true to print.
    const mute = c({ marketId: 1, viewerSide: "YES", personSide: "YES" });
    const speaks = c({ marketId: 2, viewerSide: "YES", personSide: "YES", isLargest: true });
    expect(startHere([mute, speaks])?.marketId).toBe(2);
  });

  it("returns null when every candidate is mute", () => {
    const mute = [
      c({ marketId: 1, viewerSide: "YES", personSide: "YES" }),
      c({ marketId: 2, viewerSide: "NO", personSide: "NO" }),
    ];
    expect(startHere(mute)).toBeNull();
  });

  it("does not call a short hold the longest-held conviction", () => {
    const r = startHere(
      [
        c({
          marketId: 1,
          isLongest: true,
          daysHeld: START.minDaysForLongest - 1,
          viewerSide: "YES",
        }),
      ],
      { personName: "Sarah" },
    );
    expect(r).toBeNull();
  });
});

describe("a signed-out visitor still gets one", () => {
  it("explains it in the person's own terms with no relationship clause", () => {
    const r = startHere([c({ marketId: 1, isLargest: true, valueUsd: 3_000, viewerSide: null })], {
      personName: "Sarah",
    });
    expect(r?.why).toContain("Their largest current position");
    expect(r?.why).not.toMatch(/you back|usually agree/);
  });
});

describe("ties break toward the busier room", () => {
  it("sends the visitor where there are more people to meet", () => {
    const quiet = c({ marketId: 1, isLargest: true, participants: 5 });
    const busy = c({ marketId: 2, isLargest: true, participants: 400 });
    expect(startHere([quiet, busy])?.marketId).toBe(2);
  });
});

/**
 * `viewerSide: null` means two different things — "signed in and skipped this
 * market" and "no wallet at all" — and the engine cannot tell them apart on its
 * own. The caller says which, or the page tells a stranger what they have not
 * done.
 */
describe("with no viewer there is no relationship clause", () => {
  it("says nothing about what 'you' have or have not done", () => {
    const r = startHere([c({ marketId: 1, isLargest: true, valueUsd: 3_000 })], {
      personName: "Sarah",
      hasViewer: false,
    });
    expect(r?.why).toBe("Sarah — Their largest current position.");
  });

  it("stays silent rather than recommending something it cannot explain", () => {
    // Nothing defining, and the relationship clause is unavailable.
    expect(startHere([c({ marketId: 1 })], { hasViewer: false })).toBeNull();
  });

  it("still finds a candidate that speaks for itself alone", () => {
    const r = startHere(
      [c({ marketId: 1 }), c({ marketId: 2, againstPct: 91, participants: 60 })],
      {
        personName: "Sarah",
        hasViewer: false,
      },
    );
    expect(r).toEqual({
      marketId: 2,
      title: "Market 2",
      why: "Sarah — A market where they back YES and 91% of the room does not.",
    });
  });
});

describe("the same engine drives the front door and the further reading", () => {
  it("ranks every explainable candidate, most revealing first", () => {
    const list = [
      c({ marketId: 1, viewerSide: "YES", personSide: "YES" }), // mute
      c({ marketId: 2, isLargest: true, valueUsd: 900 }),
      c({ marketId: 3, viewerSide: "NO", topicUsuallyAligned: true }),
    ];
    expect(rankStartCandidates(list).map((r) => r.marketId)).toEqual([3, 2]);
  });

  it("agrees with startHere on the first row, by construction", () => {
    const list = [c({ marketId: 1, isLargest: true }), c({ marketId: 2, viewerSide: "NO" })];
    expect(rankStartCandidates(list)[0]).toEqual(startHere(list));
  });
});

/**
 * The failure this guards against was checkable arithmetic: before the
 * significance term, a surprising clash in a four-person market scored 1.22
 * while their $50,000 unexplored largest conviction with four hundred
 * participants scored 0.97. The front door had quietly become "where do we
 * disagree most" rather than "what best explains this person".
 */
describe("a trivial market cannot win on relationship alone", () => {
  it("does not let a four-person clash outrank a defining conviction", () => {
    const trivial = c({
      marketId: 1,
      viewerSide: "NO",
      topicUsuallyAligned: true,
      participants: 4,
      valueUsd: 5,
    });
    const defining = c({ marketId: 2, isLargest: true, valueUsd: 50_000, participants: 400 });
    expect(startHere([trivial, defining])?.marketId).toBe(2);
  });

  it("but a clash in a real room still leads", () => {
    const real = c({
      marketId: 1,
      viewerSide: "NO",
      topicUsuallyAligned: true,
      participants: 200,
      valueUsd: 5_000,
    });
    const defining = c({ marketId: 2, isLargest: true, valueUsd: 50_000, participants: 400 });
    expect(startHere([real, defining])?.marketId).toBe(1);
  });

  it("prefers the market they actually committed to, all else equal", () => {
    const token = c({ marketId: 1, isLargest: true, valueUsd: 2, participants: 30 });
    const real = c({ marketId: 2, isLargest: true, valueUsd: 4_000, participants: 30 });
    expect(startHere([token, real])?.marketId).toBe(2);
  });

  it("only awards the top weight above the surprise threshold", () => {
    const below = c({
      marketId: 1,
      viewerSide: "NO",
      topicUsuallyAligned: true,
      participants: START.minParticipantsForSurprise - 1,
    });
    const above = c({
      marketId: 2,
      viewerSide: "NO",
      topicUsuallyAligned: true,
      participants: START.minParticipantsForSurprise,
    });
    expect(startHere([below, above])?.marketId).toBe(2);
  });
});

/**
 * A profile that answers every question with "here is somewhere you two
 * disagree" has stopped introducing a person and started picking fights.
 */
describe("disagreement does not take over the page", () => {
  it("caps how many of the ranked rows are clashes", () => {
    const clashes = [1, 2, 3, 4, 5].map((id) =>
      c({ marketId: id, viewerSide: "NO", personSide: "YES", participants: 50 }),
    );
    const rows = rankStartCandidates(clashes);
    expect(rows).toHaveLength(START.maxDisagreements);
  });

  it("gives the freed slots to markets that reveal something else", () => {
    const list = [
      ...[1, 2, 3].map((id) =>
        c({ marketId: id, viewerSide: "NO", personSide: "YES", participants: 50 }),
      ),
      c({ marketId: 9, isLargest: true, valueUsd: 3_000 }),
    ];
    const ids = rankStartCandidates(list).map((r) => r.marketId);
    expect(ids).toHaveLength(3);
    expect(ids).toContain(9);
  });

  it("does not cap anything when there is no viewer to disagree with", () => {
    const list = [1, 2, 3].map((id) => c({ marketId: id, againstPct: 90, participants: 40 }));
    expect(rankStartCandidates(list, { hasViewer: false })).toHaveLength(3);
  });
});
