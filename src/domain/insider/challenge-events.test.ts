import { describe, it, expect } from "vitest";
import {
  INSIDER_CHALLENGE_BANNED,
  collapseEvents,
  eventRank,
  eventVocabulary,
  semanticEvent,
  semanticEvents,
  type ChallengeEventInput,
  type ChallengeEventKind,
} from "./challenge-events";

const casey = { wallet: "0xcasey", name: "Casey" };
const john = { wallet: "0xjohn", name: "John" };
const maya = { wallet: "0xmaya", name: "Maya" };

const ev = (over: Partial<ChallengeEventInput> = {}): ChallengeEventInput => ({
  kind: "new_believer",
  marketId: 1,
  actor: maya,
  atMs: 100,
  ...over,
});

const say = (i: ChallengeEventInput) => eventVocabulary(semanticEvent(i));

/* ── One human action, one event ───────────────────────────────────────────── */

describe("a trade that answers a Challenge is one event, not two", () => {
  /**
   * THE MECHANICAL WRITES ARE TWO ROWS AND THE HUMAN ACT IS ONE. Rendered
   * separately the tape says "Casey traded NO" and then "Casey answered John's
   * Challenge" — one person, one decision, told twice, with the second telling
   * stealing the point of the first.
   */
  it("collapses the trade and the answer into the answer", () => {
    const events = semanticEvents([
      ev({ kind: "new_believer", actor: casey, side: "NO", believersNow: 14 }),
      ev({ kind: "challenge_response", actor: casey, answeredCaller: john }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].headline).toBe("CASEY BACKED NO");
    expect(events[0].support).toBe("Answered John's Challenge.");
  });

  it("keeps the losing row's facts, only discarding its kind", () => {
    // The side came from the trade; the caller came from the stamp. Both survive.
    const [e] = semanticEvents([
      ev({ kind: "challenge_response", actor: casey, answeredCaller: john }),
      ev({ kind: "new_believer", actor: casey, side: "NO" }),
    ]);
    expect(e.headline).toContain("NO");
    expect(e.support).toContain("John");
  });

  it("does not depend on which row arrived first", () => {
    const a = semanticEvents([
      ev({ kind: "new_believer", actor: casey, side: "NO" }),
      ev({ kind: "challenge_response", actor: casey, answeredCaller: john }),
    ]);
    const b = semanticEvents([
      ev({ kind: "challenge_response", actor: casey, answeredCaller: john }),
      ev({ kind: "new_believer", actor: casey, side: "NO" }),
    ]);
    expect(a).toEqual(b);
  });

  it("keeps two different people in the same market apart", () => {
    expect(
      collapseEvents([ev({ actor: casey, side: "NO" }), ev({ actor: maya, side: "YES" })]),
    ).toHaveLength(2);
  });

  it("keeps one person's acts in different markets apart", () => {
    expect(
      collapseEvents([ev({ marketId: 1, actor: casey }), ev({ marketId: 2, actor: casey })]),
    ).toHaveLength(2);
  });
});

/* ── The sentences ─────────────────────────────────────────────────────────── */

describe("each event says what it can prove", () => {
  it("celebrates a first believer without naming a count", () => {
    const e = semanticEvent(ev({ kind: "first_believer", actor: maya, side: "YES" }));
    expect(e.headline).toBe("YOUR FIRST BELIEVER SHOWED UP");
    expect(e.support).toBe("Maya backed YES.");
  });

  it("counts believers only when the count is known", () => {
    expect(semanticEvent(ev({ side: "NO", believersNow: 14 })).support).toBe("14 believers now.");
    expect(semanticEvent(ev({ side: "NO", believersNow: 1 })).support).toBe("1 believer now.");
    // Null is not zero, and "0 believers now" under somebody backing a side is
    // a sentence that contradicts the headline above it.
    expect(semanticEvent(ev({ side: "NO", believersNow: null })).support).toBeNull();
    expect(semanticEvent(ev({ side: "NO", believersNow: 0 })).support).toBeNull();
  });

  it("says a relay reached tables, never people", () => {
    const e = semanticEvent(ev({ kind: "relay", actor: john, relayReach: 8 }));
    expect(e.headline).toBe("JOHN KEPT IT MOVING");
    expect(e.support).toBe("The question is now on 8 more tables.");
    expect(eventVocabulary(e)).not.toMatch(/people/);
  });

  it("singularises one table", () => {
    expect(semanticEvent(ev({ kind: "relay", relayReach: 1 })).support).toBe(
      "The question is now on 1 more table.",
    );
  });

  /**
   * "STILL IN" IS A CLAIM ABOUT HOLDINGS, and only a balance can establish it.
   * Said about somebody who fully exited it is exactly the small confident lie
   * this tape cannot afford.
   */
  it("says 'still in' only when holdings prove it", () => {
    expect(semanticEvent(ev({ kind: "reduced", side: "YES", stillIn: true })).support).toBe(
      "Still in.",
    );
    expect(semanticEvent(ev({ kind: "reduced", side: "YES", stillIn: false })).support).toBeNull();
    expect(semanticEvent(ev({ kind: "reduced", side: "YES", stillIn: null })).support).toBeNull();
  });

  it("reports completion from the lifecycle pair or not at all", () => {
    expect(
      semanticEvent(ev({ kind: "challenge_complete", completion: { showedUp: 8, reached: 11 } })),
    ).toMatchObject({ headline: "YOUR CHALLENGE IS CLOSED", support: "8 of 11 showed up." });
    expect(
      semanticEvent(ev({ kind: "challenge_complete", completion: { showedUp: 11, reached: 11 } })),
    ).toMatchObject({ headline: "EVERYONE SHOWED UP", support: null });
    // No canonical pair, no fraction invented.
    expect(semanticEvent(ev({ kind: "challenge_complete", completion: null })).support).toBeNull();
  });

  it("names a Challenge answer even when the caller is unknown", () => {
    // The act is provable; the person who asked may not have resolved.
    expect(
      semanticEvent(ev({ kind: "challenge_response", actor: casey, side: "NO" })).support,
    ).toBe("Answered a Challenge.");
  });

  it("survives an act with no side rather than inventing one", () => {
    for (const kind of ["added", "reduced", "left_side", "new_believer"] as ChallengeEventKind[]) {
      const e = semanticEvent(ev({ kind, side: null }));
      expect(e.headline).not.toMatch(/YES|NO/);
      expect(e.headline.length).toBeGreaterThan(0);
    }
  });
});

/* ── Priority ──────────────────────────────────────────────────────────────── */

describe("human activity leads, and answering leads it", () => {
  it("ranks the brief's order", () => {
    const order: ChallengeEventKind[] = [
      "challenge_response",
      "first_believer",
      "new_believer",
      "relay",
      "challenge_complete",
      "added",
      "reduced",
      "left_side",
    ];
    for (let i = 1; i < order.length; i++)
      expect(eventRank(order[i - 1])).toBeGreaterThan(eventRank(order[i]));
  });

  it("puts a response above a position change even when the change is newer", () => {
    const [first] = semanticEvents([
      ev({ kind: "added", actor: maya, atMs: 900, marketId: 2 }),
      ev({ kind: "challenge_response", actor: casey, answeredCaller: john, atMs: 100 }),
    ]);
    expect(first.kind).toBe("challenge_response");
  });

  it("breaks a tie within a kind by recency", () => {
    const [first] = semanticEvents([
      ev({ kind: "added", actor: maya, atMs: 10, marketId: 1 }),
      ev({ kind: "added", actor: casey, atMs: 900, marketId: 2 }),
    ]);
    expect(first.actorWallet).toBe(casey.wallet);
  });

  it("can emit no money event at all", () => {
    // A tape that ranked earnings would be a ledger with a headline font. There
    // is no kind for it, so there is nothing to rank.
    const kinds: ChallengeEventKind[] = [
      "challenge_response",
      "first_believer",
      "new_believer",
      "relay",
      "challenge_complete",
      "added",
      "reduced",
      "left_side",
    ];
    for (const k of kinds) expect(k).not.toMatch(/earn|fee|payout|revenue/);
  });
});

/* ── Privacy ───────────────────────────────────────────────────────────────── */

describe("the same boundary as the Chain view", () => {
  /**
   * STRUCTURAL. A passer, an eligible-but-unasked wallet and somebody waiting in
   * a stranger's branch have no field on the input type, so no component can
   * render them and no future reader can be asked to supply them "for context".
   */
  it("has nowhere to put anybody who did not act", () => {
    const shape = ev();
    for (const forbidden of ["passers", "audience", "waiting", "eligible", "recipients"])
      expect(Object.keys(shape)).not.toContain(forbidden);
  });

  it("never says any banned word, in any event it can produce", () => {
    const shapes: ChallengeEventInput[] = [];
    const kinds: ChallengeEventKind[] = [
      "challenge_response",
      "first_believer",
      "new_believer",
      "relay",
      "challenge_complete",
      "added",
      "reduced",
      "left_side",
    ];
    for (const kind of kinds)
      for (const side of ["YES", "NO", null] as const)
        for (const believersNow of [null, 0, 14])
          for (const relayReach of [null, 0, 8])
            for (const completion of [
              null,
              { showedUp: 8, reached: 11 },
              { showedUp: 11, reached: 11 },
            ])
              for (const stillIn of [null, true, false])
                for (const answeredCaller of [null, john])
                  shapes.push(
                    ev({
                      kind,
                      side,
                      believersNow,
                      relayReach,
                      completion,
                      stillIn,
                      answeredCaller,
                    }),
                  );

    for (const s of shapes) {
      const said = say(s).toLowerCase();
      for (const banned of INSIDER_CHALLENGE_BANNED)
        expect(said, `${banned} :: ${said}`).not.toContain(banned);
    }
  });

  it("never turns a recipient count into a headcount of people", () => {
    const e = semanticEvent(ev({ kind: "relay", relayReach: 42 }));
    expect(eventVocabulary(e)).not.toMatch(/42\s+(more\s+)?people/);
  });
});
