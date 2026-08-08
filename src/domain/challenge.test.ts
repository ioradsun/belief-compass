import { describe, it, expect } from "vitest";
import {
  composeChallenges,
  reasonFor,
  challengeLock,
  callReachLine,
  CHALLENGE,
  CALLER_RELATIONS,
  type CallEvidence,
  type CallerRelation,
  type NamedPerson,
} from "./challenge";

const T0 = Date.parse("2026-08-07T00:00:00Z");
const p = (name: string | null, wallet = `0x${name ?? "anon"}`): NamedPerson => ({ wallet, name });

const call = (over: Partial<CallEvidence> = {}): CallEvidence => ({
  marketId: 1,
  title: "Will ETH outperform BTC?",
  caller: p("Mike"),
  relation: "opp",
  act: "trade",
  together: null,
  shared: null,
  callerSide: "YES",
  atMs: T0,
  ...over,
});

/**
 * THE RULE IS INHERITED, NOT REINVENTED. `for-you.ts` refused to show a row it
 * could not justify; Challenge refuses for the same reason and with the same
 * mechanism — `reasonFor` returns null and the row ceases to exist. There is no
 * fallback string anywhere in the path, by design.
 */
describe("a call that cannot name its caller is not a call", () => {
  it("gives every surviving challenge a non-empty reason", () => {
    const rows = composeChallenges(
      CALLER_RELATIONS.map((relation, i) => call({ marketId: i + 1, relation })),
    );
    expect(rows).toHaveLength(CALLER_RELATIONS.length);
    for (const r of rows) expect(r.reason.trim().length).toBeGreaterThan(0);
  });

  it("refuses an unnamed caller rather than saying 'someone'", () => {
    // A call is one person asking you a question. "Someone took YES" is news,
    // and news lives one tab across in the tape.
    expect(reasonFor(call({ caller: p(null) }))).toBeNull();
    expect(reasonFor(call({ caller: { wallet: "0xa", name: "   " } }))).toBeNull();
  });

  it("refuses a trade whose side we do not know", () => {
    // We cannot quote someone asking a question if we cannot say what they did.
    expect(reasonFor(call({ callerSide: null }))).toBeNull();
    expect(reasonFor(call({ callerSide: "MIXED" as never }))).toBeNull();
  });

  it("refuses a market with no title", () => {
    // The gate lives in composeChallenges now, not in the sentence. call-line
    // never sees a title, so asserting this on `reasonFor` would have quietly
    // stopped testing anything the moment composition moved out.
    expect(composeChallenges([call({ title: "  " })])).toEqual([]);
  });

  it("drops the unjustifiable instead of softening it", () => {
    expect(composeChallenges([call({ caller: p(null) }), call({ callerSide: null })])).toEqual([]);
  });
});

/**
 * THE SUBSTANTIVE CHANGE FROM for-you.ts. The old Rival row required the viewer
 * to already hold a side — it could only say "took the other side of your YES".
 * Challenge targets markets the viewer has NOT answered, so there is no other
 * side yet, and claiming one would be inventing a position they do not hold.
 */
describe("a Challenge never implies a side the viewer has not taken", () => {
  it("states who called and what they did", () => {
    // The exact sentence is call-line's business and varies by design — six open
    // Challenges used to read as one row six times. What this file guards is
    // that the CALL is stated: who, and what they did.
    const r = reasonFor(call({ caller: p("Mike"), relation: "opp", callerSide: "YES" })) as string;
    expect(r).toContain("Mike");
    expect(r).toContain("YES");
  });

  it("needs no viewer side at all — there is no viewerSide to pass", () => {
    // The property, stated structurally: CallEvidence has no field for it, so a
    // reason cannot depend on one even by accident.
    expect(Object.keys(call())).not.toContain("viewerSide");
    expect(reasonFor(call())).not.toContain("other side");
  });

  it("never says 'the other side'", () => {
    for (const relation of CALLER_RELATIONS) {
      for (const callerSide of ["YES", "NO"] as const) {
        const r = reasonFor(call({ relation, callerSide }))!;
        expect(r).not.toMatch(/other side/i);
      }
    }
  });

  it("no longer names the relation inside the sentence", () => {
    // The card carries TRIBE / RIVAL as a badge. Saying it again mid-sentence
    // was the redundancy that made every row look alike.
    for (const relation of CALLER_RELATIONS) {
      const r = reasonFor(call({ relation, caller: p("Mike") })) as string;
      expect(r).not.toMatch(/your (Twin|Tribe|Rival|Opp)\b/);
    }
  });

  it("treats a creation as a question asked, not a side taken", () => {
    const r = reasonFor(call({ act: "market_created", callerSide: null, caller: p("Ana") }))!;
    expect(r).toContain("Ana");
    expect(r).not.toMatch(/took|backed|went|already in/);
  });
});

describe("one market, one call, from whoever has most standing to ask", () => {
  it("keeps the strongest relation when several people called", () => {
    const rows = composeChallenges([
      call({ marketId: 7, relation: "tribe", caller: p("Tribe") }),
      call({ marketId: 7, relation: "twin", caller: p("Twin") }),
      call({ marketId: 7, relation: "opp", caller: p("Rival") }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].relation).toBe("twin");
  });

  it("breaks a same-relation collision by recency", () => {
    const rows = composeChallenges([
      call({ marketId: 7, caller: p("Old"), atMs: T0 }),
      call({ marketId: 7, caller: p("New"), atMs: T0 + 60_000 }),
    ]);
    expect(rows[0].caller.name).toBe("New");
  });

  it("NEVER shows a market the viewer has already acted in", () => {
    // The single most important exclusion: an answered call is not a quieter
    // call, it is not a call.
    const rows = composeChallenges([call({ marketId: 1 }), call({ marketId: 2 })], {
      answered: new Set([1]),
    });
    expect(rows.map((r) => r.marketId)).toEqual([2]);
  });

  it("puts a Twin's older question above a Tribe member's newer one", () => {
    const rows = composeChallenges([
      call({ marketId: 2, relation: "tribe", atMs: T0 + 999_999 }),
      call({ marketId: 1, relation: "twin", atMs: T0 - 999_999 }),
    ]);
    expect(rows.map((r) => r.relation)).toEqual(["twin", "tribe"]);
  });

  it("is a total order, so the panel cannot reshuffle between loads", () => {
    const rows = [5, 2, 9].map((marketId) => call({ marketId }));
    const forward = composeChallenges(rows).map((r) => r.marketId);
    const backward = composeChallenges([...rows].reverse()).map((r) => r.marketId);
    expect(backward).toEqual(forward);
    expect(forward).toEqual([2, 5, 9]);
  });

  it("stays a set of open questions rather than a second feed", () => {
    const many = Array.from({ length: 30 }, (_, i) => call({ marketId: i + 1 }));
    expect(composeChallenges(many)).toHaveLength(CHALLENGE.maxOpen);
  });

  it("is empty when nobody qualifies, which is most viewers today", () => {
    expect(composeChallenges([])).toEqual([]);
  });
});

/**
 * THE LOCK REUSES THE CANONICAL STAGE GATE. `dnaStage` already puts
 * "recognizable" at exactly five decisions. A second five defined here would be
 * a second answer to one question.
 */
describe("the lock opens at the stage the DNA engine already defines", () => {
  it("is locked below five decisions and open at five", () => {
    for (const d of [0, 1, 2, 3, 4]) expect(challengeLock(d).unlocked, `${d}`).toBe(false);
    for (const d of [5, 6, 40]) expect(challengeLock(d).unlocked, `${d}`).toBe(true);
  });

  it("shows the destination rather than hiding it", () => {
    const lock = challengeLock(3);
    expect(lock.title).toBe("Find Your People");
    expect(lock.filled).toBe(3);
    expect(lock.total).toBe(5);
    expect(lock.detail).toBe("2 more and we'll know who your Tribe and Rivals are.");
  });

  it("speaks to someone who has done nothing yet without shaming them", () => {
    const lock = challengeLock(0);
    expect(lock.filled).toBe(0);
    expect(lock.detail).toBe("Take 5 sides and we'll work out who your people are.");
    expect(lock.detail).not.toMatch(/^0\b/);
  });

  it("stops filling the bar once the thing it gates has opened", () => {
    // The bar measures the unlock, not the next stage. A bar that keeps growing
    // after the door opens is measuring something nobody asked about.
    for (const d of [5, 15, 40]) {
      const lock = challengeLock(d);
      expect(lock.filled).toBe(5);
      expect(lock.total).toBe(5);
      expect(lock.detail).toBeNull();
    }
  });

  it("unlocking grants access, it does not manufacture relationships", () => {
    // An unlocked but empty panel is a correct state. The lock says nothing
    // about whether anyone qualifies — only the DNA engine decides that.
    expect(challengeLock(50).unlocked).toBe(true);
    expect(composeChallenges([])).toEqual([]);
  });
});

/**
 * WHERE THE REVERSE EVENT WENT. `answeredNotices` used to be tested here — it
 * composed a dismissible "SARAH SHOWED UP" card for the top of the rail. The fact
 * was right and the lifespan was wrong, so it moved to @/domain/dependability
 * where it accumulates into a relationship rather than expiring into localStorage.
 * Its tests moved with it; see "the ladder, and what each rung costs".
 */

describe("call reach is honest about a channel that does not exist", () => {
  it("names who became eligible", () => {
    expect(callReachLine({ tribe: 8, rivals: 2 })).toBe("8 Tribe · 2 Rivals");
    expect(callReachLine({ tribe: 0, rivals: 1 })).toBe("1 Rival");
  });

  it("says nothing rather than showing a zero scoreboard", () => {
    // "0 Tribe · 0 Rivals" reads as a game being lost. A network still forming
    // is not a failure, and the honest rendering of it is silence.
    expect(callReachLine({ tribe: 0, rivals: 0 })).toBeNull();
  });

  it("never claims anyone was notified", () => {
    const line = callReachLine({ tribe: 3, rivals: 1 })!;
    expect(line).not.toMatch(/notif/i);
    expect(line).not.toMatch(/sent|alert|messag/i);
  });
});

/**
 * THE INVARIANT THE WHOLE MECHANISM RESTS ON.
 *
 * Challenge manufactures shared experience. Conviction Match measures similarity
 * WITHIN that experience. Tribe/Rival describes the resulting pattern. Three jobs,
 * and Challenge only has the first — so answering YES and answering NO must
 * satisfy a Challenge in exactly the same way, at every layer.
 */
describe("answering YES or NO satisfies a Challenge identically", () => {
  it("composes the same row whichever side the caller took", () => {
    const yes = composeChallenges([call({ callerSide: "YES" })])[0];
    const no = composeChallenges([call({ callerSide: "NO" })])[0];
    // Everything except the stated side is identical: same relation, same record,
    // same eligibility. The side is reported, never acted on.
    expect({ ...yes, reason: null, callerSide: null }).toEqual({
      ...no,
      reason: null,
      callerSide: null,
    });
  });

  it("keeps the sentence free of any agreement framing, on every relation", () => {
    // The two clauses this replaced: "This could be the one you split on" and
    // "Agreeing here would be new". Both implied a Challenge wanted a particular
    // answer. `callLine` no longer receives the relation at all, so the whole
    // relation axis cannot reach the copy.
    for (const relation of CALLER_RELATIONS)
      for (const callerSide of ["YES", "NO"] as const) {
        const [row] = composeChallenges([call({ relation, callerSide })]);
        const r = row.reason.toLowerCase();
        for (const w of ["agree", "disagree", "split on", "same way", "tribe", "rival"])
          expect(r, `"${row.reason}" (${relation}/${callerSide})`).not.toContain(w);
      }
  });

  it("never lets the relationship change the sentence", () => {
    // Same market, same caller, four different relations → one sentence. The
    // relationship reaches the reader through the badge and the Conviction Match
    // line, where it is a measured fact rather than a nudge.
    const lines = new Set(
      CALLER_RELATIONS.map((relation) => composeChallenges([call({ relation })])[0].reason),
    );
    expect(lines.size).toBe(1);
  });
});
