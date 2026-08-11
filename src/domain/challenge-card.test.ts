import { describe, it, expect } from "vitest";
import {
  CARD_BANNED_WORDS,
  broughtYouIn,
  cardStateFor,
  cardVocabulary,
  completionFor,
  keptItMovingHeadline,
  keptItMovingLine,
  lineageLine,
  progressLine,
  relayInvitation,
  responseHeadline,
  responseSideLine,
  tablesLine,
  youShowedUpFor,
  type CardPerson,
  type CardResponder,
  type CardState,
  type ChallengeCardProjection,
  type Incoming,
  type Outgoing,
} from "./challenge-card";

const person = (name: string): CardPerson => ({
  wallet: `0x${name.toLowerCase()}`,
  name,
  avatarUrl: null,
});

const responder = (name: string, side: "YES" | "NO" | null = "NO", atMs = 1): CardResponder => ({
  ...person(name),
  side,
  atMs,
});

const incoming = (over: Partial<Incoming> = {}): Incoming => ({
  callers: [person("Maya")],
  primaryCall: 7,
  primaryCaller: person("Maya"),
  primaryCallerSide: "YES",
  respondedAtMs: null,
  respondedSide: null,
  ...over,
});

const outgoing = (over: Partial<Outgoing> = {}): Outgoing => ({
  challengeId: 1,
  reached: 13,
  showedUp: 0,
  passed: 0,
  waiting: 13,
  responders: [],
  relayers: [],
  relayReach: 0,
  closedAtMs: null,
  ...over,
});

const card = (over: Partial<ChallengeCardProjection> = {}): ChallengeCardProjection => {
  const base: Omit<ChallengeCardProjection, "state"> = {
    marketId: 1,
    question: "Will AI replace most software engineers?",
    incoming: null,
    outgoing: null,
    viewer: {
      canRelay: false,
      relayAudience: 0,
      relayRecipientName: null,
      capacity: { active: 0, total: 3 },
    },
    lineage: { startedBy: null, through: null, depth: 0 },
    marketClosed: false,
    ...over,
  };
  return { ...base, state: cardStateFor(base) };
};

/* ── The state machine ─────────────────────────────────────────────────────── */

describe("one card, one state, decided in one place", () => {
  it("waits when somebody brought me in and I have not answered", () => {
    expect(card({ incoming: incoming() }).state).toBe("waiting");
  });

  it("becomes showed_up the moment I answer", () => {
    expect(card({ incoming: incoming({ respondedAtMs: 5 }) }).state).toBe("showed_up");
  });

  it("becomes branch_live when I put it up and nobody has answered", () => {
    expect(card({ outgoing: outgoing() }).state).toBe("branch_live");
  });

  it("becomes people_showing_up on the first response", () => {
    const c = card({
      outgoing: outgoing({ showedUp: 1, waiting: 12, responders: [responder("Casey")] }),
    });
    expect(c.state).toBe("people_showing_up");
  });

  /**
   * SOMEBODY CARRYING THE QUESTION FURTHER IS THE LARGEST EVENT, so it outranks
   * answers to it. A card that reported "3 of your people showed up" while one
   * of them had just put it in front of their own thirteen would be leading with
   * the smaller fact.
   */
  it("becomes chain_moving when a responder relays, outranking their answer", () => {
    const c = card({
      outgoing: outgoing({
        showedUp: 3,
        waiting: 10,
        responders: [responder("Casey")],
        relayers: [person("Casey")],
        relayReach: 8,
      }),
    });
    expect(c.state).toBe("chain_moving");
  });

  it("finishes when everybody terminal", () => {
    expect(card({ outgoing: outgoing({ showedUp: 0, passed: 13, waiting: 0 }) }).state).toBe(
      "finished",
    );
  });

  it("finishes when the creator took it down", () => {
    expect(card({ outgoing: outgoing({ closedAtMs: 9 }) }).state).toBe("finished");
  });

  /**
   * A CLOSED MARKET IS TERMINAL BEFORE ANYTHING ELSE. A card still asking would
   * invite an answer that can no longer be recorded.
   */
  it("finishes on market closure whatever else is true", () => {
    for (const over of [
      { incoming: incoming() },
      { outgoing: outgoing() },
      { outgoing: outgoing({ showedUp: 2, responders: [responder("Casey")] }) },
      { outgoing: outgoing({ relayers: [person("Casey")] }) },
    ])
      expect(card({ ...over, marketClosed: true }).state).toBe("finished");
  });

  it("never reports a state that is not in the union", () => {
    const states: CardState[] = [
      "waiting",
      "showed_up",
      "branch_live",
      "people_showing_up",
      "chain_moving",
      "finished",
    ];
    for (const inc of [null, incoming(), incoming({ respondedAtMs: 5 })])
      for (const out of [
        null,
        outgoing(),
        outgoing({ showedUp: 2, responders: [responder("Casey")] }),
        outgoing({ relayers: [person("Casey")] }),
        outgoing({ waiting: 0, passed: 13 }),
        outgoing({ closedAtMs: 1 }),
      ])
        for (const closed of [false, true])
          expect(states).toContain(
            card({ incoming: inc, outgoing: out, marketClosed: closed }).state,
          );
  });

  it("shows one card for a viewer who is on both sides of the same market", () => {
    // Brought in, answered, relayed, and people are answering. Exactly one state.
    const c = card({
      incoming: incoming({ respondedAtMs: 5, respondedSide: "NO" }),
      outgoing: outgoing({ showedUp: 2, waiting: 11, responders: [responder("Casey")] }),
    });
    expect(c.state).toBe("people_showing_up");
  });
});

/* ── Showing up is never about agreement ───────────────────────────────────── */

describe("the showing-up headline never changes with agreement", () => {
  it("reads identically for a same-side and an opposite-side answer", () => {
    const same = responseHeadline([responder("Casey", "YES")]);
    const opposite = responseHeadline([responder("Casey", "NO")]);
    const none = responseHeadline([responder("Casey", null)]);
    expect(same).toBe("Casey showed up");
    expect(opposite).toBe(same);
    expect(none).toBe(same);
  });

  it("counts rather than names once there are several", () => {
    expect(responseHeadline([responder("Casey"), responder("Mike"), responder("Dana")])).toBe(
      "3 of your people showed up",
    );
  });

  it("puts the agreement one line below, warmly in both directions", () => {
    expect(responseSideLine(responder("Casey", "YES"), "YES")).toBe("Casey backed YES with you.");
    expect(responseSideLine(responder("Casey", "NO"), "YES")).toBe("Casey went NO.");
    // Never "against you" — a Rival's answer is the most interesting thing here.
    expect(responseSideLine(responder("Casey", "NO"), "YES")).not.toMatch(/against/i);
  });

  it("states the bare side when the viewer holds none", () => {
    expect(responseSideLine(responder("Casey", "NO"), null)).toBe("Casey backed NO.");
  });

  it("says nothing rather than guessing a side it does not have", () => {
    expect(responseSideLine(responder("Casey", null), "YES")).toBeNull();
  });

  it("keeps the reciprocity headline side-blind too", () => {
    expect(youShowedUpFor([person("Maya")])).toBe("You showed up for Maya");
    expect(youShowedUpFor([person("Maya"), person("Sundeep"), person("John")])).toBe(
      "You showed up for 3 people",
    );
  });
});

/* ── Several callers are one social object ─────────────────────────────────── */

describe("multiple challengers become one card", () => {
  it("names the primary and counts the rest", () => {
    expect(broughtYouIn([person("Maya")])).toBe("Maya brought you in");
    expect(broughtYouIn([person("Maya"), person("Sundeep")])).toBe("Maya + 1 other brought you in");
    expect(broughtYouIn([person("Maya"), person("Sundeep"), person("John")])).toBe(
      "Maya + 2 others brought you in",
    );
  });

  /**
   * THE DISPLAYED PRIMARY AND THE LINEAGE PARENT ARE THE SAME PERSON.
   *
   * Showing the strongest relationship while assigning ancestry to somebody else
   * would make the provenance line and the chain disagree about who brought this
   * reader in — one visible, one permanent.
   */
  it("leads with the caller who owns the lineage", () => {
    const c = card({
      incoming: incoming({
        callers: [person("Maya"), person("Sundeep"), person("John")],
        primaryCaller: person("Maya"),
      }),
    });
    expect(c.incoming?.callers[0].name).toBe(c.incoming?.primaryCaller?.name);
    expect(broughtYouIn(c.incoming!.callers)).toMatch(/^Maya/);
  });

  it("keeps the card when one of several callers removes theirs", () => {
    // Maya removed; Sundeep still brought them in. The card is not deleted
    // because one source disappeared.
    expect(broughtYouIn([person("Sundeep")])).toBe("Sundeep brought you in");
  });
});

/* ── Counts say what they are ──────────────────────────────────────────────── */

describe("counts never claim more than the ledger holds", () => {
  it("reads reach as tables, never as people", () => {
    expect(tablesLine(13)).toBe("The question is now on 13 more tables.");
    expect(tablesLine(1)).toBe("The question is now on 1 more table.");
    expect(tablesLine(13)).not.toMatch(/people/);
    expect(tablesLine(0)).toBeNull();
  });

  it("shows waiting and passed only once they exist", () => {
    expect(progressLine({ reached: 13, showedUp: 1, passed: 0, waiting: 12 })).toBe(
      "1 of 13 showed up · 12 waiting",
    );
    expect(progressLine({ reached: 13, showedUp: 3, passed: 1, waiting: 0 })).toBe(
      "3 of 13 showed up · 1 passed",
    );
    // A standing "0 passed" invites watching a rejection counter.
    expect(progressLine({ reached: 13, showedUp: 0, passed: 0, waiting: 13 })).toBe(
      "0 of 13 showed up · 12 waiting".replace("12", "13"),
    );
    expect(progressLine({ reached: 0, showedUp: 0, passed: 0, waiting: 0 })).toBeNull();
  });

  it("never names a passer anywhere on the card", () => {
    const c = card({
      outgoing: outgoing({ showedUp: 1, passed: 2, waiting: 10, responders: [responder("Casey")] }),
    });
    // Passers are absent from `responders` by construction, not anonymised.
    expect(c.outgoing?.responders.map((r) => r.name)).toEqual(["Casey"]);
    expect(cardVocabulary(c)).toMatch(/2 passed/);
  });

  it("distinguishes people who relayed from the tables they reached", () => {
    expect(keptItMovingHeadline([person("Casey")])).toBe("Casey kept it moving");
    expect(keptItMovingLine([person("Casey")], 8)).toBe("The question is now on 8 more tables.");
    expect(keptItMovingHeadline([person("Casey"), person("Alex"), person("Nia")])).toBe(
      "Your Challenge is traveling",
    );
    expect(keptItMovingLine([person("Casey"), person("Alex"), person("Nia")], 42)).toBe(
      "3 people kept it moving.",
    );
    // 42 opportunities must never be reported as 42 people.
    expect(keptItMovingLine([person("Casey"), person("Alex"), person("Nia")], 42)).not.toContain(
      "42",
    );
  });
});

/* ── Ending, and the empty case ────────────────────────────────────────────── */

describe("how a Challenge ends", () => {
  it("celebrates a full house without a number nobody needs", () => {
    expect(completionFor({ reached: 11, showedUp: 11 })).toEqual({
      headline: "Everyone showed up",
      support: null,
    });
  });

  it("reports a partial result plainly", () => {
    expect(completionFor({ reached: 11, showedUp: 8 })).toEqual({
      headline: "Your Challenge is complete",
      support: "8 of 11 showed up.",
    });
  });

  /**
   * NO SHAME. Somebody who asked eleven people and heard nothing is the most
   * likely person to stop using the product, and a card reading as a scoreboard
   * they lost is how that happens. Nobody failed.
   */
  it("carries no shame when nobody answered", () => {
    const quiet = completionFor({ reached: 11, showedUp: 0 });
    expect(quiet).toEqual({
      headline: "Quiet one",
      support: "Not every question finds its people.",
    });
    for (const blame of ["nobody", "no one", "failed", "unanswered", "ignored"])
      expect(`${quiet.headline} ${quiet.support}`.toLowerCase()).not.toContain(blame);
  });

  it("reports a removal as a freed spot, not as a loss", () => {
    expect(completionFor({ reached: 0, showedUp: 0 })).toEqual({
      headline: "Off the table",
      support: "One Challenge spot opened.",
    });
  });
});

describe("lineage says only what can be walked", () => {
  it("builds the provenance line from the pointers it has", () => {
    expect(lineageLine({ startedBy: "Maya", through: "Sundeep", depth: 3 })).toBe(
      "Started by Maya · reached you through Sundeep · 3 links deep",
    );
  });

  it("does not repeat one person as both ends of a one-link chain", () => {
    expect(lineageLine({ startedBy: "Maya", through: "Maya", depth: 1 })).toBe("Started by Maya");
  });

  it("says nothing at a root", () => {
    expect(lineageLine({ startedBy: null, through: null, depth: 0 })).toBeNull();
  });
});

describe("the relay invitation", () => {
  it("counts the people who have not answered", () => {
    expect(relayInvitation(13)).toBe("13 of your people haven't answered.");
    expect(relayInvitation(0)).toBeNull();
  });
});

/* ── The vocabulary gate ───────────────────────────────────────────────────── */

describe("words this surface must never use", () => {
  const everyShape = (): ChallengeCardProjection[] => {
    const out: ChallengeCardProjection[] = [];
    for (const inc of [null, incoming(), incoming({ respondedAtMs: 5, respondedSide: "NO" })])
      for (const o of [
        null,
        outgoing(),
        outgoing({ showedUp: 3, passed: 1, waiting: 9, responders: [responder("Casey")] }),
        outgoing({ relayers: [person("Casey")], relayReach: 8, showedUp: 1 }),
        outgoing({ reached: 11, showedUp: 11, waiting: 0 }),
        outgoing({ reached: 11, showedUp: 0, passed: 11, waiting: 0 }),
        outgoing({ closedAtMs: 1, reached: 0 }),
      ])
        for (const closed of [false, true])
          out.push(
            card({
              incoming: inc,
              outgoing: o,
              marketClosed: closed,
              viewer: {
                canRelay: true,
                relayAudience: 13,
                relayRecipientName: null,
                capacity: { active: 1, total: 3 },
              },
              lineage: { startedBy: "Maya", through: "Sundeep", depth: 3 },
            }),
          );
    return out;
  };

  it("never says any of them, in any shape the card can take", () => {
    for (const c of everyShape()) {
      const said = cardVocabulary(c).toLowerCase();
      for (const banned of CARD_BANNED_WORDS)
        expect(said, `${c.state}: ${said}`).not.toContain(banned);
    }
  });

  it("never describes reach as people", () => {
    for (const c of everyShape()) {
      const said = cardVocabulary(c);
      const claimsPeople = /(\d+) (?:more )?people/.exec(said);
      if (!claimsPeople) continue;
      const n = Number(claimsPeople[1]);
      // Any "N people" must be a count of humans the ledger actually holds —
      // responders or relayers — never recipient opportunities.
      const humans = new Set<number>([
        c.outgoing?.showedUp ?? 0,
        c.outgoing?.relayers.length ?? 0,
        c.incoming?.callers.length ?? 0,
        c.viewer.relayAudience,
      ]);
      expect(humans, said).toContain(n);
    }
  });
});
