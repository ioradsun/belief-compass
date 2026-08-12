import { describe, it, expect } from "vitest";
import type { Side } from "@/domain/post-action";
import type { AudienceGroup } from "@/domain/audience";
import {
  buildPastChallenge,
  completionSupport,
  discoveryLine,
  groupPast,
  otherSide,
  pastOverview,
  pastVocabulary,
  PAST_BANNED_WORDS,
  showedUpForLine,
  showedUpLine,
  statusLabel,
  tribeLine,
  type PastChallengeInput,
  type PastResponder,
} from "./challenge-past";

const DAY = 86_400_000;

const who = (
  wallet: string,
  side: Side | null,
  group: AudienceGroup = "forming",
): PastResponder => ({ wallet, name: wallet, avatarUrl: null, side, group });

const event = (over: Partial<PastChallengeInput> = {}): PastChallengeInput => ({
  marketId: 1,
  title: "Is Michael Saylor a hypocrite?",
  yourSide: "YES",
  atMs: 0,
  closedAtMs: null,
  closeReason: null,
  reached: 0,
  passed: 0,
  responders: [],
  ...over,
});

/** 12 answered YES, 6 answered NO, out of 30 reached — the brief's own example. */
const saylor = () =>
  buildPastChallenge(
    event({
      reached: 30,
      yourSide: "YES",
      responders: [
        ...Array.from({ length: 12 }, (_, i) => who(`yes${i}`, "YES", i < 8 ? "tribe" : "forming")),
        ...Array.from({ length: 6 }, (_, i) => who(`no${i}`, "NO", i < 1 ? "tribe" : "rivals")),
      ],
    }),
  );

describe("one event, counted once", () => {
  it("reduces a Challenge to its outcome, not one row per recipient", () => {
    const pc = saylor();
    expect(pc.showedUp).toBe(18);
    expect(pc.reached).toBe(30);
    // 30 reached − 18 answered − 0 passed still out. Counted, never named.
    expect(pc.waiting).toBe(12);
    expect(pc.agreed).toBe(12);
    expect(pc.wentOtherWay).toBe(6);
  });

  it("counts the passed against waiting without ever carrying a passer as a person", () => {
    const pc = buildPastChallenge(
      event({ reached: 10, passed: 3, responders: [who("a", "YES"), who("b", "NO")] }),
    );
    expect(pc.showedUp).toBe(2);
    expect(pc.waiting).toBe(5); // 10 − 2 − 3
    // The only people the event carries are the ones who showed up.
    expect(pc.responders).toHaveLength(2);
  });

  it("keeps an answer with an unknown side in showedUp but out of the agreement split", () => {
    // A row stamped before the side was kept is a real answer with no direction.
    const pc = buildPastChallenge(
      event({ reached: 3, yourSide: "YES", responders: [who("a", "YES"), who("b", null)] }),
    );
    expect(pc.showedUp).toBe(2);
    expect(pc.agreed).toBe(1);
    expect(pc.wentOtherWay).toBe(0);
  });
});

describe("agreement is only a fact when I held a side", () => {
  it("is null in both directions with no side of my own", () => {
    const pc = buildPastChallenge(
      event({ reached: 4, yourSide: null, responders: [who("a", "YES"), who("b", "NO")] }),
    );
    expect(pc.agreed).toBeNull();
    expect(pc.wentOtherWay).toBeNull();
    expect(pc.tribeAgreed).toBeNull();
  });
});

describe("completed vs closed — and the outcome outranks either", () => {
  it("is completed when everyone answered", () => {
    expect(saylor().status).not.toBe("completed"); // 12 still out
    // reached === responders → nobody still out → concluded normally.
    const done = buildPastChallenge(
      event({ reached: 2, responders: [who("a", "YES"), who("b", "NO")] }),
    );
    expect(done.status).toBe("completed");
  });

  it("is completed when the server closed it because all responded", () => {
    expect(buildPastChallenge(event({ reached: 5, closeReason: "all_responded" })).status).toBe(
      "completed",
    );
  });

  it("is closed when it was taken down with people still out", () => {
    const pc = buildPastChallenge(
      event({ reached: 30, closeReason: "creator", responders: [who("a", "YES")] }),
    );
    expect(pc.status).toBe("closed");
    expect(statusLabel(pc)).toBe("Closed");
  });

  it("never says 'expired' — a window did not end, I ended it", () => {
    for (const pc of [saylor(), buildPastChallenge(event({ reached: 0 }))])
      expect(statusLabel(pc).toLowerCase()).not.toContain("expired");
  });
});

describe("the headline is side-blind", () => {
  it("counts answers and says nothing about sides", () => {
    expect(showedUpLine(saylor())).toBe("18 of 30 showed up");
    // Identical whether they agreed or not — that is the invariant.
    const rival = buildPastChallenge(
      event({ reached: 30, responders: Array.from({ length: 18 }, (_, i) => who(`n${i}`, "NO")) }),
    );
    expect(showedUpLine(rival)).toBe("18 of 30 showed up");
  });

  it("has no denominator to state when nobody was reached", () => {
    expect(showedUpLine(buildPastChallenge(event({ reached: 0 })))).toBeNull();
  });
});

describe("the reveal — what their answers surfaced", () => {
  it("names the split in the product's warm register, never 'against you'", () => {
    expect(discoveryLine(saylor())).toBe("12 backed YES with you · 6 went NO");
  });

  it("celebrates a clean sweep only when there is a crowd", () => {
    const swept = buildPastChallenge(
      event({ reached: 5, responders: [who("a", "YES"), who("b", "YES"), who("c", "YES")] }),
    );
    expect(discoveryLine(swept)).toBe("Everyone who showed up backed YES with you");
    // A lone agreer is not a crowd — it falls to the plain split.
    const lone = buildPastChallenge(event({ reached: 5, responders: [who("a", "YES")] }));
    expect(discoveryLine(lone)).toBe("1 backed YES with you");
  });

  it("states the raw split when I held no side", () => {
    const pc = buildPastChallenge(
      event({ reached: 6, yourSide: null, responders: [who("a", "YES"), who("b", "YES"), who("c", "NO")] }),
    );
    expect(discoveryLine(pc)).toBe("2 backed YES · 1 backed NO");
  });

  it("says nothing when nobody showed up", () => {
    expect(discoveryLine(buildPastChallenge(event({ reached: 8 })))).toBeNull();
  });
});

describe("your Tribe, when there was a Tribe there", () => {
  it("reads the Tribe crowd and how many landed with me", () => {
    // saylor(): 8 tribe on YES + 1 tribe on NO = 9 tribe responders, 8 with me.
    expect(tribeLine(saylor())).toBe("Your Tribe: 8 of 9 with you");
  });

  it("is held back below two Tribe answers and below a side of my own", () => {
    const one = buildPastChallenge(event({ reached: 3, responders: [who("a", "YES", "tribe")] }));
    expect(tribeLine(one)).toBeNull();
    const noSide = buildPastChallenge(
      event({ reached: 3, yourSide: null, responders: [who("a", "YES", "tribe"), who("b", "YES", "tribe")] }),
    );
    expect(tribeLine(noSide)).toBeNull();
  });
});

describe("the ending carries no shame", () => {
  it("puts a quiet one on the question", () => {
    expect(completionSupport(buildPastChallenge(event({ reached: 8 })))).toBe(
      "Quiet one. Not every question finds its people.",
    );
  });
  it("states an unheard Challenge plainly", () => {
    expect(completionSupport(buildPastChallenge(event({ reached: 0 })))).toBe("Off the table.");
  });
  it("says nothing extra once people showed up", () => {
    expect(completionSupport(saylor())).toBeNull();
  });
});

describe("the orientation summary counts challenges, not call rows", () => {
  it("aggregates events, answers and both rates", () => {
    const items = [
      saylor(), // reached 30, showedUp 18, agreed 12 / decided 18
      buildPastChallenge(
        event({ marketId: 2, reached: 10, responders: [who("a", "YES"), who("b", "YES")] }),
      ), // reached 10, showedUp 2, agreed 2 / decided 2
    ];
    const o = pastOverview(items);
    expect(o.challenges).toBe(2);
    expect(o.responses).toBe(20);
    expect(o.showedUpPct).toBe(Math.round((20 / 40) * 100)); // 50
    expect(o.agreedPct).toBe(Math.round((14 / 20) * 100)); // 70
  });

  it("leaves a rate null rather than printing a fabricated zero", () => {
    const empty = pastOverview([]);
    expect(empty.challenges).toBe(0);
    expect(empty.showedUpPct).toBeNull();
    expect(empty.agreedPct).toBeNull();
    // A no-side event contributes answers but no agreement denominator.
    const noSide = pastOverview([
      buildPastChallenge(event({ reached: 4, yourSide: null, responders: [who("a", "YES")] })),
    ]);
    expect(noSide.showedUpPct).toBe(25);
    expect(noSide.agreedPct).toBeNull();
  });
});

describe("human chronological grouping", () => {
  it("sorts into rolling eras, newest first, and drops the empty ones", () => {
    const now = 100 * DAY;
    const items = [
      buildPastChallenge(event({ marketId: 1, atMs: now - 1 * DAY })), // week
      buildPastChallenge(event({ marketId: 2, atMs: now - 3 * DAY })), // week
      buildPastChallenge(event({ marketId: 3, atMs: now - 20 * DAY })), // month
      buildPastChallenge(event({ marketId: 4, atMs: now - 200 * DAY })), // earlier
    ];
    const eras = groupPast(items, now);
    expect(eras.map((e) => e.key)).toEqual(["week", "month", "earlier"]);
    expect(eras[0].items.map((i) => i.marketId)).toEqual([1, 2]); // newest first
  });

  it("puts a future-skewed row in the newest era, not Earlier", () => {
    const now = 100 * DAY;
    const eras = groupPast([buildPastChallenge(event({ atMs: now + DAY }))], now);
    expect(eras).toHaveLength(1);
    expect(eras[0].key).toBe("week");
  });
});

describe("vocabulary", () => {
  it("says the reciprocal in the same words the card uses", () => {
    expect(showedUpForLine({ who: "Maya" })).toBe("You showed up for Maya");
  });

  it("never says a word that makes a disagreer an enemy or the page a game", () => {
    const battery = [
      saylor(),
      buildPastChallenge(event({ reached: 0 })),
      buildPastChallenge(event({ reached: 8 })), // quiet
      buildPastChallenge(event({ reached: 5, responders: [who("a", "YES"), who("b", "YES")] })),
      buildPastChallenge(
        event({ reached: 6, yourSide: null, responders: [who("a", "YES"), who("b", "NO")] }),
      ),
      buildPastChallenge(event({ reached: 4, closeReason: "creator", responders: [who("a", "NO")] })),
    ];
    for (const pc of battery) {
      const said = pastVocabulary(pc).toLowerCase();
      for (const banned of PAST_BANNED_WORDS) expect(said).not.toContain(banned);
    }
  });
});

describe("otherSide", () => {
  it("flips a side and only a side", () => {
    expect(otherSide("YES")).toBe("NO");
    expect(otherSide("NO")).toBe("YES");
  });
});
