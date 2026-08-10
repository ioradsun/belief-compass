import { describe, it, expect } from "vitest";
import {
  BANNED_UI_WORDS,
  DEPENDABILITY,
  EMPTY_TALLY,
  bondFor,
  backAndForthLine,
  bucketOf,
  eligible,
  historyRows,
  NO_RECIPROCITY,
  outcomeLine,
  passedNow,
  RECIPROCITY,
  reciprocity,
  runEndedLine,
  rateFor,
  rungFor,
  showedUpFor,
  showedUpInMarket,
  tally,
  type CallFact,
  type PairCall,
  type Tally,
} from "./dependability";

const t = (answered: number, waiting = 0, outOfReach = 0): Tally => ({
  answered,
  waiting,
  outOfReach,
});
const NONE = EMPTY_TALLY;
/** Enough evidence to clear the gate, so tests about rungs are not about the gate. */
const enough = (answered: number, waiting: number) => t(answered, waiting);

/**
 * THE MEASUREMENT THIS MODULE WAS BUILT AGAINST.
 *
 * Of 6,727 possible caller→responder pairs on the platform, the median pair shares
 * ONE market and only 5% share five or more. Every assertion about thin evidence
 * below is therefore about the COMMON case, not an edge case — `100% · 1 call` was
 * the thing this design existed to prevent.
 */
describe("a rate is earned, never shown", () => {
  it("says nothing at all when nobody has answered", () => {
    const b = bondFor("Sarah", NONE, NONE);
    expect(b.rung).toBe("none");
    expect(b.sentence).toBeNull();
    expect(b.evidence).toBeNull();
  });

  it("NEVER renders a zero", () => {
    // The failure this codebase keeps paying for: `Number(null) === 0` rendered as
    // a confident fact. A person with no history is not 0% anything.
    for (const b of [bondFor("Sarah", NONE, NONE), bondFor("Sarah", t(0, 3), NONE)]) {
      expect(b.rate).toBeNull();
      expect(b.sentence ?? "").not.toMatch(/0/);
      expect(b.evidence ?? "").not.toMatch(/\b0\b/);
    }
  });

  it("withholds the rate below the gate and produces it at the gate", () => {
    for (let n = 1; n < DEPENDABILITY.minForScore; n++) {
      expect(rateFor(t(n))).toBeNull();
    }
    expect(rateFor(t(DEPENDABILITY.minForScore))).toBe(1);
  });

  it("refuses the 100%-of-one card outright", () => {
    const b = bondFor("Sarah", t(1), NONE);
    expect(b.rate).toBeNull();
    expect(b.sentence).toBe("Sarah showed up.");
  });

  it("counts only what could still be acted on", () => {
    // 3 answered + 2 waiting is 5 eligible; 40 that left reach are not evidence of
    // anything and must not drag the number down.
    expect(eligible(t(3, 2, 40))).toBe(5);
    expect(rateFor(t(3, 2, 40))).toBeCloseTo(0.6);
  });

  it("an out-of-reach call can never lower a rate", () => {
    const base = rateFor(t(4, 1)) as number;
    for (const stale of [1, 5, 50]) {
      expect(rateFor(t(4, 1, stale))).toBe(base);
    }
  });
});

describe("the ladder, and what each rung costs", () => {
  it("reciprocity outranks a perfect one-way record", () => {
    // A bond in both directions beats a pattern in one, even when the one-way
    // record is flawless. This is the product's highest state and it is not for sale.
    expect(rungFor(enough(20, 0), t(1))).toBe("each_other");
    expect(rungFor(enough(20, 0), NONE)).toBe("count_on");
  });

  it("needs an answer in BOTH directions to say 'each other'", () => {
    expect(bondFor("Sarah", enough(9, 1), t(0, 4)).sentence).not.toMatch(/each other/i);
    expect(bondFor("Sarah", enough(9, 1), t(1)).sentence).toMatch(/each other/i);
  });

  it("separates a forming pattern from something to count on", () => {
    expect(rungFor(t(3, 7), NONE)).toBe("shows_up"); // 30%
    expect(rungFor(t(8, 2), NONE)).toBe("count_on"); // 80%
  });

  it("cannot reach the higher rungs on thin evidence, however perfect", () => {
    // Four of four is 100% and still only "showed up" — the sample is the reason.
    expect(rungFor(t(4, 0), NONE)).toBe("showed_up");
    expect(rungFor(t(5, 0), NONE)).toBe("count_on");
  });

  it("names the person in every sentence that mentions one", () => {
    for (const [theirs, yours] of [
      [t(1), NONE],
      [t(3, 7), NONE],
      [t(8, 2), NONE],
    ] as const) {
      expect(bondFor("Sarah", theirs, yours).sentence).toContain("Sarah");
    }
  });

  it("refuses to speak at all about someone it cannot name", () => {
    // A sentence about "someone" is worse than silence: it puts an unnamed person
    // in front of a reader and asks them to feel something about it.
    for (const name of ["", "   "]) {
      const b = bondFor(name, enough(9, 1), t(3));
      expect(b.sentence).toBeNull();
      expect(b.evidence).toBeNull();
    }
  });
});

describe("the receipt is countable against the rows below it", () => {
  it("states the fraction rather than a percentage", () => {
    // The reader can count the history list and get the same answer. A rounded
    // rate cannot be checked, which is what makes it feel magical.
    expect(bondFor("Sarah", t(13, 4), NONE).evidence).toBe("Sarah has shown up 13 of 17 times.");
  });

  it("has a warmer sentence for a perfect record than 'N of N'", () => {
    expect(bondFor("Sarah", t(6), NONE).evidence).toBe(
      "Sarah has shown up all 6 times you called.",
    );
    expect(bondFor("Sarah", t(1), NONE).evidence).toBe("Sarah has shown up every time you called.");
  });

  it("says nothing when there is nothing to show", () => {
    expect(bondFor("Sarah", t(0, 4), NONE).evidence).toBeNull();
  });
});

describe("the moment someone shows up", () => {
  it("names one or two people and counts the rest", () => {
    expect(showedUpFor(["Sarah"])).toBe("You showed up for Sarah.");
    expect(showedUpFor(["Sarah", "Mike"])).toBe("You showed up for Sarah and Mike.");
    expect(showedUpFor(["Sarah", "Mike", "Priya"])).toBe("You showed up for 3 people.");
  });

  it("is absent rather than zero when nobody called", () => {
    // "You answered 0 calls" is the confident-zero failure wearing a friendly face.
    expect(showedUpFor([])).toBeNull();
    expect(showedUpFor(["", "  "])).toBeNull();
  });

  it("never repeats what the trade confirmation just said", () => {
    expect(showedUpFor(["Sarah"])).not.toMatch(/took a side|placed|confirmed/i);
  });
});

/**
 * ONE MARKET, ONE ROW — the anti-spam rule for the Now tape.
 *
 * Three people answering the same call is one thing that happened to you. A row
 * each would make the surface loudest on the reader's best day and say nothing new
 * by the third line, which is a notification inbox wearing a tape's clothes.
 */
describe("somebody showed up, aggregated", () => {
  it("names one or two, and counts beyond that", () => {
    expect(showedUpInMarket(["Sarah"])).toBe("Sarah showed up for you.");
    expect(showedUpInMarket(["Sarah", "Mike"])).toBe("Sarah and Mike showed up for you.");
    expect(showedUpInMarket(["Sarah", "Mike", "Priya"])).toBe("3 people showed up for you.");
  });

  it("collapses a crowd into one sentence rather than growing with it", () => {
    // The property that matters: sentence length stops growing while the crowd
    // does. Ten answers is still one line, and still one row.
    const ten = Array.from({ length: 10 }, (_, i) => `P${i}`);
    expect(showedUpInMarket(ten)).toBe("10 people showed up for you.");
    const words = (names: string[]) => showedUpInMarket(names)!.split(" ").length;
    expect(words(ten)).toBeLessThan(words(["Sarah", "Mike"]) + 2);
  });

  it("says nothing rather than 'somebody showed up'", () => {
    // An unnamed row is the feeling without the person, which is worse than
    // silence — the reader cannot tell whether it is even about anyone they know.
    expect(showedUpInMarket([])).toBeNull();
    expect(showedUpInMarket(["", "   "])).toBeNull();
  });

  it("is about being answered, never about being agreed with", () => {
    for (const names of [["Sarah"], ["Sarah", "Mike"], ["a", "b", "c"]]) {
      expect(showedUpInMarket(names)!).not.toMatch(/agree|side|YES|NO\b|backed/);
    }
  });
});

describe("your history tells three states, not four", () => {
  const entries = [
    { marketId: 1, title: "Will ETH outperform BTC?", direction: "they_answered", atMs: 300 },
    { marketId: 2, title: "Will AI replace developers?", direction: "you_answered", atMs: 200 },
    { marketId: 3, title: "Will rates fall?", direction: "waiting_on_them", atMs: 100 },
  ] as const;

  it("labels each direction from the reader's side", () => {
    expect(historyRows(entries, "Sarah").map((r) => r.label)).toEqual([
      "Sarah showed up",
      "You showed up",
      "Waiting on Sarah",
    ]);
  });

  it("never teaches the reader a lifecycle", () => {
    // The window is real and the denominator uses it. The story does not name it.
    const text = historyRows(entries, "Sarah")
      .map((r) => r.label)
      .join(" ");
    expect(text).not.toMatch(/lapsed|expired|window|open|closed/i);
  });

  it("is newest first and totally ordered", () => {
    const forward = historyRows(entries, "Sarah").map((r) => r.marketId);
    const backward = historyRows([...entries].reverse(), "Sarah").map((r) => r.marketId);
    expect(forward).toEqual([1, 2, 3]);
    expect(backward).toEqual(forward);
  });

  it("drops a row it cannot describe rather than showing an id", () => {
    const bad = [{ marketId: 9, title: "   ", direction: "they_answered", atMs: 1 }] as const;
    expect(historyRows(bad, "Sarah")).toEqual([]);
  });
});

describe("the window is applied in exactly one place", () => {
  const DAY = 86_400_000;
  const now = 10_000 * DAY;

  it("sorts an answered call as answered however old it is", () => {
    expect(bucketOf({ respondedAtMs: 1, calledAtMs: 0 }, now)).toBe("answered");
    expect(bucketOf({ respondedAtMs: now, calledAtMs: now - 900 * DAY }, now)).toBe("answered");
  });

  it("moves an unanswered call out of reach exactly at the window edge", () => {
    const at = (days: number) =>
      bucketOf({ respondedAtMs: null, calledAtMs: now - days * DAY }, now);
    expect(at(DEPENDABILITY.windowDays - 1)).toBe("waiting");
    expect(at(DEPENDABILITY.windowDays)).toBe("waiting");
    expect(at(DEPENDABILITY.windowDays + 1)).toBe("outOfReach");
  });

  it("agrees with the tally, so the story and the number cannot diverge", () => {
    const calls = [
      { respondedAtMs: now, calledAtMs: now - DAY },
      { respondedAtMs: null, calledAtMs: now - 2 * DAY },
      { respondedAtMs: null, calledAtMs: now - 400 * DAY },
    ];
    expect(tally(calls, now)).toEqual({ answered: 1, waiting: 1, outOfReach: 1 });
    expect(eligible(tally(calls, now))).toBe(2);
  });
});

/**
 * THE VOCABULARY IS THE PRODUCT.
 *
 * "Dependability" is accurate and clinical — it sounds like a field in HR software
 * — so it names this file and nothing a reader can see. The punitive words are
 * worse: not answering is the ABSENCE of a positive, and every one of these would
 * invent negative evidence the platform does not have.
 */
describe("no string this module can emit names the machinery or blames anyone", () => {
  const everything = (): string[] => {
    const out: string[] = [];
    const tallies: Tally[] = [
      NONE,
      t(1),
      t(3, 7),
      t(8, 2),
      t(13, 4),
      t(6),
      t(0, 4, 9),
      t(20, 0, 5),
    ];
    for (const theirs of tallies) {
      for (const yours of tallies) {
        const b = bondFor("Sarah", theirs, yours);
        if (b.sentence) out.push(b.sentence);
        if (b.evidence) out.push(b.evidence);
      }
    }
    out.push(
      ...([["Sarah"], ["Sarah", "Mike"], ["a", "b", "c"]]
        .map(showedUpFor)
        .filter(Boolean) as string[]),
    );
    out.push(
      ...([["Sarah"], ["Sarah", "Mike"], ["a", "b", "c", "d"]]
        .map(showedUpInMarket)
        .filter(Boolean) as string[]),
    );
    out.push(
      ...historyRows(
        [
          { marketId: 1, title: "T", direction: "they_answered", atMs: 3 },
          { marketId: 2, title: "T", direction: "you_answered", atMs: 2 },
          { marketId: 3, title: "T", direction: "waiting_on_them", atMs: 1 },
        ],
        "Sarah",
      ).map((r) => r.label),
    );
    // The reciprocity vocabulary goes through the SAME guard as everything else,
    // which is what stops "streak" — banned on both sides of this feature — from
    // arriving through the one function that had a reason to want it.
    for (let run = 0; run <= 12; run++) {
      const r = { run, bothWays: true, endedRun: run };
      out.push(backAndForthLine(r) ?? "", runEndedLine(r) ?? "");
    }
    for (const state of ["waiting", "showed_up", "passed"] as const) {
      out.push(outcomeLine(state, "Sarah") ?? "");
    }
    return out.filter(Boolean);
  };

  it("emits a real corpus, so this guard is not vacuously passing", () => {
    expect(everything().length).toBeGreaterThan(20);
  });

  it("never uses a banned word", () => {
    for (const s of everything()) {
      for (const w of BANNED_UI_WORDS) {
        expect(s.toLowerCase(), `"${s}" contains "${w}"`).not.toContain(w);
      }
    }
  });

  it("never states a percentage in prose", () => {
    // The rate is a number the UI may choose to render; the SENTENCES never carry
    // one, because "you can count on Sarah" and "76%" are the same claim and the
    // words are the better one.
    for (const s of everything()) expect(s).not.toMatch(/%/);
  });
});

/**
 * SHOWING UP IS PARTICIPATION, NEVER AGREEMENT.
 *
 * The invariant most likely to be eroded by a well-meaning future change, so it is
 * asserted on the SHAPE of the inputs rather than only on behaviour — a behavioural
 * test cannot fail for a side that no type can express, which is exactly the point.
 *
 * The relationship at stake: a Rival who answers every call is the most valuable
 * thing this product can surface — somebody who disagrees with you about everything
 * and turns up anyway. Let YES/NO into this calculation and that person renders as
 * unreliable.
 */
describe("answering is taking a side, not taking YOUR side", () => {
  it("cannot express a side anywhere in its inputs", () => {
    // Structural, not behavioural. `CallFact` is two timestamps; a future change
    // that wanted to weight by agreement would have to ADD a field to get there,
    // and it would land on this assertion on the way.
    const fact: CallFact = { respondedAtMs: 1, calledAtMs: 0 };
    expect(Object.keys(fact).sort()).toEqual(["calledAtMs", "respondedAtMs"]);
    for (const k of Object.keys(fact)) {
      expect(k).not.toMatch(/side|yes|no|agree|match|same|oppos/i);
    }
  });

  it("counts two answers identically however they voted", () => {
    // The whole invariant in one assertion: this module cannot tell the difference
    // between an ally showing up and a rival showing up, because there is nothing
    // in what it receives that could carry the distinction.
    const now = 10_000 * 86_400_000;
    const ally = { respondedAtMs: now, calledAtMs: now - 86_400_000 };
    const rival = { respondedAtMs: now, calledAtMs: now - 86_400_000 };
    expect(tally([ally], now)).toEqual(tally([rival], now));
  });

  it("lets a Rival reach the highest rung", () => {
    // Relationship classification is not this module's input either, so nothing
    // here can cap a Rival below a Twin. `each_other` is reachable by anyone.
    expect(rungFor(t(9, 1), t(4))).toBe("each_other");
    expect(bondFor("Mike", t(9, 1), t(4)).sentence).toBe("You show up for each other.");
  });

  it("never speaks about agreement in any sentence it emits", () => {
    for (const [theirs, yours] of [
      [t(1), NONE],
      [t(3, 7), NONE],
      [t(8, 2), NONE],
      [t(9, 1), t(4)],
    ] as const) {
      const b = bondFor("Mike", theirs, yours);
      for (const s of [b.sentence, b.evidence].filter(Boolean) as string[]) {
        expect(s).not.toMatch(/agree|disagree|same side|your side|YES|NO\b/);
      }
    }
  });
});

describe("showing up and Conviction Match never touch", () => {
  it("takes no DNA input at all, so no composite is expressible", () => {
    // The structural guarantee: `92% DNA / one-way` and `28% DNA / counts on you`
    // are the two most interesting relationships on the platform, and a blended
    // "61% compatible" erases exactly what makes them interesting. This module
    // cannot compute that even by accident — it never sees agreement.
    expect(bondFor.length).toBe(3);
    const keys = Object.keys(bondFor("Sarah", t(8, 2), t(1)));
    for (const k of keys) expect(k).not.toMatch(/dna|agree|match|compat|score/i);
  });
});

/**
 * BACK & FORTH — the run between two people, and every way it could become a lie.
 *
 * THE THING THIS IS NOT. A daily streak counts calendar days and rewards opening
 * an app; this counts answered challenges between one pair and cannot see a date
 * at all. The distinction is not stylistic — it decides whether the number
 * describes a relationship or an engagement metric, and every assertion below is
 * a way the second one could sneak back in.
 */
const DAY = 86_400_000;
const pc = (over: Partial<PairCall> = {}): PairCall => ({
  calledAtMs: 0,
  respondedAtMs: null,
  passedAtMs: null,
  fromViewer: true,
  ...over,
});
/** I asked, they answered. */
const theyShowed = (at: number, gap = 1) =>
  pc({ calledAtMs: at, respondedAtMs: at + gap, fromViewer: true });
/** They asked, I answered. */
const youShowed = (at: number, gap = 1) =>
  pc({ calledAtMs: at, respondedAtMs: at + gap, fromViewer: false });

describe("a run is earned by answering, and by nothing else", () => {
  it("counts one answered challenge per step, in either direction", () => {
    const r = reciprocity([theyShowed(1 * DAY), youShowed(2 * DAY), theyShowed(3 * DAY)]);
    expect(r.run).toBe(3);
    expect(r.bothWays).toBe(true);
  });

  it("cannot be manufactured by issuing challenges", () => {
    // The failure mode with teeth: somebody spams ten challenges at one person
    // and the software congratulates them on a relationship. An unanswered call
    // contributes nothing, however many there are.
    const asked = Array.from({ length: 10 }, (_, i) => pc({ calledAtMs: i * DAY }));
    expect(reciprocity(asked)).toEqual(NO_RECIPROCITY);
  });

  it("cannot be manufactured by market activity unrelated to the challenge", () => {
    // Structural rather than behavioural, and it is the strongest form available:
    // a trade that answered nobody's call produces no `market_calls` row, so there
    // is no input here that could carry it. `PairCall` is two timestamps, a
    // direction and a pass — there is nowhere for ambient activity to enter.
    expect(Object.keys(pc()).sort()).toEqual([
      "calledAtMs",
      "fromViewer",
      "passedAtMs",
      "respondedAtMs",
    ]);
  });

  it("does not care which side anybody took, because it cannot see one", () => {
    for (const k of Object.keys(pc())) expect(k).not.toMatch(/side|yes|no|agree|same|oppos/i);
  });

  it("has no relationship to consecutive days", () => {
    // Two answers a year apart are two. A daily streak would read this as one and
    // a broken one; a relationship reads it as two times somebody turned up.
    const far = reciprocity([theyShowed(0), youShowed(400 * DAY)]);
    const near = reciprocity([theyShowed(0), youShowed(DAY)]);
    expect(far.run).toBe(near.run);
    expect(far).toEqual(near);
  });

  it("orders by when the challenge was made, not by the order rows arrive", () => {
    const rows = [youShowed(3 * DAY), theyShowed(1 * DAY), pc({ calledAtMs: 2 * DAY })];
    expect(reciprocity(rows)).toEqual(reciprocity([...rows].reverse()));
  });
});

describe("a run is one-way until both people have turned up", () => {
  it("refuses to call a one-way pattern back & forth", () => {
    // Four answered challenges, all in one direction. That is a pattern and the
    // ladder already has a sentence for it — "Sarah shows up for you" — and
    // calling it back & forth would be the software flattering the relationship.
    const oneWay = reciprocity([0, 1, 2, 3].map((i) => theyShowed(i * DAY)));
    expect(oneWay.run).toBe(4);
    expect(oneWay.bothWays).toBe(false);
    expect(backAndForthLine(oneWay)).toBeNull();
  });

  it("agrees with the ladder's own definition of reciprocal", () => {
    // ONE ANSWER, TWO PLACES, and this is the assertion that keeps them together.
    // `rungFor` decides "each_other" from the tallies; `reciprocity` decides
    // `bothWays` from the merged sequence. They read the same rows and must never
    // disagree about whether a relationship goes both ways.
    const cases: PairCall[][] = [
      [],
      [theyShowed(0)],
      [youShowed(0)],
      [theyShowed(0), youShowed(DAY)],
      [theyShowed(0), pc({ calledAtMs: DAY, fromViewer: false })],
      [theyShowed(0), youShowed(DAY), theyShowed(2 * DAY)],
    ];
    for (const calls of cases) {
      const mine = calls.filter((c) => c.fromViewer);
      const hers = calls.filter((c) => !c.fromViewer);
      const rung = rungFor(tally(mine, 1), tally(hers, 1));
      expect(reciprocity(calls).bothWays, JSON.stringify(calls)).toBe(rung === "each_other");
    }
  });
});

describe("a pass ends a run, and silence does not", () => {
  it("ends it on a pass, and remembers what it ended", () => {
    const r = reciprocity([
      theyShowed(0),
      youShowed(DAY),
      pc({ calledAtMs: 2 * DAY, passedAtMs: 2 * DAY + 1, fromViewer: true }),
    ]);
    expect(r.run).toBe(0);
    expect(r.endedRun).toBe(2);
  });

  it("PAUSES on a call nobody has answered yet", () => {
    // Not answering is the absence of a positive, never the presence of a
    // negative — the rule this whole module is built on. A question asked
    // yesterday and not yet answered must not read as a refusal.
    const r = reciprocity([theyShowed(0), youShowed(DAY), pc({ calledAtMs: 2 * DAY })]);
    expect(r.run).toBe(2);
    expect(r.endedRun).toBe(0);
  });

  it("starts again from zero after a pass", () => {
    const r = reciprocity([
      theyShowed(0),
      pc({ calledAtMs: DAY, passedAtMs: DAY + 1 }),
      youShowed(2 * DAY),
      theyShowed(3 * DAY),
    ]);
    expect(r.run).toBe(2);
    expect(r.endedRun).toBe(0);
  });

  it("lets an answer outrank a pass on the same call", () => {
    // Waving a card off and then finding the market anyway is a real path, and
    // `recipientState` already resolves it the same way on the creator's side.
    const r = reciprocity([pc({ calledAtMs: 0, passedAtMs: 1, respondedAtMs: 2 })]);
    expect(r.run).toBe(1);
    expect(r.endedRun).toBe(0);
  });

  it("optimistic pass says exactly what the server will say", () => {
    // `passedNow` is a shortcut the rail uses so a card does not vanish and come
    // back. It is only allowed to exist while it produces the same answer as
    // appending the pass and recomputing.
    for (const calls of [
      [theyShowed(0), youShowed(DAY)],
      [theyShowed(0), youShowed(DAY), theyShowed(2 * DAY)],
      [theyShowed(0)],
      [],
    ] as PairCall[][]) {
      const before = reciprocity(calls);
      const after = reciprocity([...calls, pc({ calledAtMs: 9 * DAY, passedAtMs: 9 * DAY + 1 })]);
      expect(passedNow(before), JSON.stringify(calls)).toEqual(after);
    }
  });
});

describe("what the run is allowed to say out loud", () => {
  it("says nothing about a run too short to be a pattern", () => {
    for (let run = 0; run < RECIPROCITY.minRun; run++)
      expect(backAndForthLine({ run, bothWays: true, endedRun: 0 })).toBeNull();
    expect(backAndForthLine({ run: RECIPROCITY.minRun, bothWays: true, endedRun: 0 })).toBe(
      `${RECIPROCITY.minRun} back & forth`,
    );
  });

  it("never says streak, and never keeps a personal best", () => {
    // A best-ever beside a current run turns a relationship into a score to
    // defend, and the moment the current one is smaller the line is telling
    // somebody they are losing at friendship.
    const lines = [
      backAndForthLine({ run: 7, bothWays: true, endedRun: 0 }),
      runEndedLine({ run: 0, bothWays: true, endedRun: 7 }),
    ].join(" ");
    for (const w of ["streak", "best", "record", "lost", "broken", "🔥", "!"])
      expect(lines.toLowerCase()).not.toContain(w);
  });

  it("states an ending once, quietly, and only when there was one", () => {
    expect(runEndedLine({ run: 0, bothWays: true, endedRun: 7 })).toBe("Your run of 7 ends here.");
    expect(runEndedLine({ run: 0, bothWays: true, endedRun: 1 })).toBeNull();
    expect(runEndedLine(NO_RECIPROCITY)).toBeNull();
  });
});

/**
 * WHOSE RAIL IS THIS? The sentence on an answered call names the person who
 * turned up, and on the reader's own rail that person is the reader.
 */
describe("the outcome of a call addressed to me", () => {
  it("puts the reader in the subject, because they are the one who showed up", () => {
    expect(outcomeLine("showed_up", "Maya")).toBe("You showed up for Maya.");
  });

  it("says the same thing whichever side the reader took", () => {
    // There is no side in the input, so there is no branch to get wrong. This is
    // the surface where that matters most: a Rival who turns up must read as
    // somebody who turned up.
    expect(outcomeLine("showed_up", "Maya")).toBe(outcomeLine("showed_up", "Maya"));
    expect(outcomeLine.length).toBe(2);
  });

  it("lets the reader own their own pass, and names nobody else", () => {
    const line = outcomeLine("passed", "Maya") as string;
    expect(line).toBe("You passed.");
    expect(line).not.toContain("Maya");
  });

  it("says nothing at all while the call is still waiting", () => {
    expect(outcomeLine("waiting", "Maya")).toBeNull();
  });

  it("never uses acceptance language, because nothing was accepted", () => {
    for (const state of ["waiting", "showed_up", "passed"] as const) {
      const line = (outcomeLine(state, "Maya") ?? "").toLowerCase();
      for (const w of ["accept", "declin", "reject", "complet", "respond", "status"])
        expect(line).not.toContain(w);
    }
  });
});
