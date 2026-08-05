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
    // Both have a claim of their own; the only difference is whether the viewer
    // has been there. A market with NO claim is not a candidate at all — see
    // "an absence is not a reason" below.
    const shared = c({ marketId: 1, viewerSide: "YES", personSide: "YES", isLargest: true });
    const fresh = c({ marketId: 2, viewerSide: null, isLongest: true, daysHeld: 120 });
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
      "Sarah — You two usually agree on technology, but here you do not — you back NO and they back YES.",
    );
    expect(r?.kind).toBe("challenging");
  });

  it("says what is unexplored when there is no disagreement", () => {
    const r = startHere([c({ marketId: 1, isLargest: true, valueUsd: 4_000 })], {
      personName: "Sarah",
    });
    expect(r?.why).toBe(
      "Sarah — Their largest current position, and you have never taken a side here.",
    );
    expect(r?.kind).toBe("discovering");
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
    // Two facts about the person, because a signed-out reader has no
    // relationship signals to draw a second one from.
    expect(r?.why).toBe("Sarah — Their largest current position, held for 30 days.");
    expect(r?.kind).toBe("defining");
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
      kind: "defining",
      why: "Sarah — A market where they back YES while 91% of the room does not, held for 30 days.",
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

/**
 * Caught by running the archetype harness, not by a unit test — which is
 * exactly why the harness exists.
 *
 * "You have not taken a side here yet" describes the ABSENCE of a fact, and it
 * is true of almost every market a reader has never opened. Printed as a
 * standalone reason it turned a forty-position profile into four identical
 * rows: "Recommended" wearing other words.
 */
describe("an absence is not a reason", () => {
  it("refuses a market whose only claim is that you have not been there", () => {
    expect(startHere([c({ marketId: 1, viewerSide: null })])).toBeNull();
  });

  it("still uses it to QUALIFY a real claim about them", () => {
    const r = startHere([c({ marketId: 1, viewerSide: null, isLargest: true, valueUsd: 40 })], {
      personName: "Sarah",
    });
    expect(r?.why).toBe(
      "Sarah — Their largest current position, and you have never taken a side here.",
    );
    expect(r?.kind).toBe("discovering");
  });

  it("keeps the topic version, which says something specific", () => {
    const r = startHere([c({ marketId: 1, viewerSide: null, topicUsuallyAligned: true })], {
      personName: "Sarah",
    });
    expect(r?.why).toBe(
      "Sarah — Technology is a topic you keep meeting on, and you have never taken a side here.",
    );
    expect(r?.kind).toBe("connecting");
  });

  it("does not pad a long list of unremarkable markets", () => {
    const many = Array.from({ length: 40 }, (_, i) => c({ marketId: i + 1, viewerSide: null }));
    expect(rankStartCandidates(many)).toEqual([]);
  });
});

/**
 * On a platform whose 95th-percentile market holds $23 in total, duration is
 * the scarcer signal. Without the tenure term a long-tenured account opened on
 * an $8 position instead of a 512-day conviction.
 */
describe("a long conviction outweighs a small largest position", () => {
  it("opens on the 512-day hold, not the $8 one", () => {
    const long = c({
      marketId: 1,
      title: "Will remote work outlast the mandate?",
      isLongest: true,
      daysHeld: 512,
      tenureIsFloor: true,
      valueUsd: 1,
      participants: 4,
    });
    const big = c({ marketId: 2, isLargest: true, valueUsd: 8, participants: 1 });
    expect(startHere([long, big])?.marketId).toBe(1);
  });

  it("but a genuinely large position still wins against a short hold", () => {
    const shortish = c({ marketId: 1, isLongest: true, daysHeld: 20, valueUsd: 1 });
    const big = c({ marketId: 2, isLargest: true, valueUsd: 500, participants: 37 });
    expect(startHere([shortish, big])?.marketId).toBe(2);
  });
});

/**
 * THE COPY RULE, enforced rather than reviewed.
 *
 * One signal produces metadata — "you have not taken a side here" is a database
 * fact about a stranger, "their largest current position" is a label. Two
 * signals produce a story, because the second supplies the reason the first
 * matters. Below two the engine returns nothing and the section is omitted:
 * an empty slot costs a visitor nothing, a generic one costs their trust in
 * every other recommendation on the page.
 */
describe("every sentence carries at least two signals", () => {
  /** Rough but honest: count the clauses the composer can emit. */
  const signals = (why: string) =>
    [
      /largest current position/,
      /held longest/,
      /held for /,
      /% of the room does not/,
      /usually agree on/,
      /is a topic you keep meeting on/,
      /never taken a side here/,
      /you back (YES|NO) and they back/,
    ].filter((re) => re.test(why)).length;

  const cases: [string, StartCandidate][] = [
    ["largest + gap", c({ marketId: 1, isLargest: true, valueUsd: 40 })],
    ["longest + gap", c({ marketId: 2, isLongest: true, daysHeld: 300 })],
    [
      "topic + largest + gap",
      c({ marketId: 3, isLargest: true, valueUsd: 40, topicUsuallyAligned: true }),
    ],
    [
      "clash + topic",
      c({ marketId: 4, viewerSide: "NO", topicUsuallyAligned: true, participants: 9 }),
    ],
    ["clash + largest", c({ marketId: 5, viewerSide: "NO", isLargest: true, participants: 9 })],
    ["contrarian + tenure", c({ marketId: 6, againstPct: 90, participants: 20, daysHeld: 80 })],
    [
      "agreement + topic + largest",
      c({ marketId: 7, viewerSide: "YES", topicUsuallyAligned: true, isLargest: true }),
    ],
  ];

  for (const [label, cand] of cases) {
    it(`never prints one bare fact — ${label}`, () => {
      const r = startHere([cand], { personName: "Sarah" });
      expect(r, label).not.toBeNull();
      expect(signals(r!.why), r!.why).toBeGreaterThanOrEqual(2);
    });
  }

  it("holds for a signed-out reader too, from person facts alone", () => {
    const r = startHere([c({ marketId: 1, isLargest: true, valueUsd: 40, daysHeld: 90 })], {
      personName: "Sarah",
      hasViewer: false,
    });
    expect(signals(r!.why), r!.why).toBeGreaterThanOrEqual(2);
    expect(r!.why).not.toMatch(/you back|usually agree|never taken/);
  });

  it("shows nothing rather than one signal", () => {
    // Not largest, not long enough to be a tenure claim, no crowd, no viewer.
    const bare = c({ marketId: 1, daysHeld: 2, viewerSide: null });
    expect(startHere([bare], { hasViewer: false })).toBeNull();
  });
});

/**
 * Every returned recommendation lands in one of the four useful classes. There
 * is no `weak` member of `StartKind` by design — a weak candidate is not
 * returned, so the section disappears instead of filling the space.
 */
describe("nothing weak is ever featured", () => {
  it("classifies every result into a useful category", () => {
    const list = [
      c({ marketId: 1, isLargest: true, valueUsd: 40 }),
      c({ marketId: 2, viewerSide: "NO", topicUsuallyAligned: true, participants: 9 }),
      c({ marketId: 3, isLongest: true, daysHeld: 300, topicUsuallyAligned: true }),
      c({ marketId: 4, viewerSide: "YES", isLargest: true, topicUsuallyAligned: true }),
    ];
    const kinds = rankStartCandidates(list).map((r) => r.kind);
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds)
      expect(["challenging", "connecting", "defining", "discovering"]).toContain(k);
  });
});
