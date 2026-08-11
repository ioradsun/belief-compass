import { describe, it, expect } from "vitest";
import { completedAtMs, lifecycleEvents } from "./challenge-lifecycle";
import { semanticEvents } from "./challenge-events";
import type {
  CardRelayer,
  CardResponder,
  ChallengeCardProjection,
  Outgoing,
} from "@/domain/challenge-card";

const ME = "0xme";
const HOUR = 60 * 60 * 1000;
const NOW = 1_000 * HOUR;
const FRESH = NOW - 72 * HOUR;

let nextChallengeId = 100;
const relayer = (
  name: string,
  atMs: number,
  reach: number,
  challengeId = nextChallengeId++,
): CardRelayer => ({
  wallet: `0x${name.toLowerCase()}`,
  name,
  avatarUrl: null,
  challengeId,
  atMs,
  reach,
});

const responder = (name: string, atMs: number): CardResponder => ({
  wallet: `0x${name.toLowerCase()}`,
  name,
  avatarUrl: null,
  side: "YES",
  atMs,
});

const outgoing = (over: Partial<Outgoing> = {}): Outgoing => ({
  challengeId: 1,
  reached: 5,
  showedUp: 0,
  passed: 0,
  waiting: 5,
  responders: [],
  relayers: [],
  relayReach: 0,
  closedAtMs: null,
  ...over,
});

const card = (over: Partial<ChallengeCardProjection> = {}): ChallengeCardProjection => ({
  marketId: 1,
  question: "Will it?",
  incoming: null,
  outgoing: outgoing(),
  viewer: {
    canRelay: false,
    relayAudience: 0,
    relayRecipientName: null,
    capacity: { active: 1, total: 3 },
  },
  lineage: { startedBy: null, through: null, depth: 0 },
  marketClosed: false,
  state: "branch_live",
  ...over,
});

const ctx = { viewerWallet: ME, freshAfterMs: FRESH };
const kinds = (cards: ChallengeCardProjection[]) => lifecycleEvents(cards, ctx).map((e) => e.kind);

/* ── Relays ────────────────────────────────────────────────────────────────── */

describe("a relay is a thing that happened, and the tape could not say so", () => {
  it("emits one event per person who kept it moving", () => {
    const events = lifecycleEvents(
      [
        card({
          state: "chain_moving",
          outgoing: outgoing({
            relayers: [relayer("John", NOW - HOUR, 8), relayer("Maya", NOW - 2 * HOUR, 3)],
            relayReach: 11,
          }),
        }),
      ],
      ctx,
    );
    expect(events.map((e) => e.actor.name)).toEqual(["John", "Maya"]);
  });

  /**
   * THEIR REACH, NOT THE BRANCH TOTAL. `relayReach` sums every relayer's tables;
   * spending it on one person's row credits them with tables somebody else
   * opened, and the tape's whole value is that the small numbers are checkable.
   */
  it("gives each relayer their own reach, never the branch total", () => {
    const events = lifecycleEvents(
      [
        card({
          outgoing: outgoing({
            relayers: [relayer("John", NOW - HOUR, 8), relayer("Maya", NOW - HOUR, 3)],
            relayReach: 11,
          }),
        }),
      ],
      ctx,
    );
    expect(events.map((e) => e.relayReach)).toEqual([8, 3]);
    expect(events.some((e) => e.relayReach === 11)).toBe(false);
  });

  /**
   * A ROW PLACED BY WHEN THE PAGE WAS BUILT IS A ROW CLAIMING SOMETHING JUST
   * HAPPENED. Dropping one entry loses one entry; dating it `now` corrupts the
   * order of every entry around it.
   */
  it("drops an undated relay rather than stamping it with now", () => {
    for (const atMs of [0, -1, Number.NaN])
      expect(
        kinds([card({ outgoing: outgoing({ relayers: [relayer("John", atMs, 8)] }) })]),
      ).toEqual([]);
  });

  it("drops a relay older than the window", () => {
    expect(
      kinds([card({ outgoing: outgoing({ relayers: [relayer("John", FRESH - 1, 8)] }) })]),
    ).toEqual([]);
    expect(
      kinds([card({ outgoing: outgoing({ relayers: [relayer("John", FRESH + 1, 8)] }) })]),
    ).toEqual(["relay"]);
  });

  /**
   * TWO ACTS BY ONE PERSON ARE TWO EVENTS, AND THE SCHEMA IS WHY.
   *
   * `challenges_active_market_idx` is unique on `(challenger_wallet, market_id)
   * WHERE closed_at IS NULL` — it prevents two SIMULTANEOUS Challenges and
   * nothing else. `put_on_table` refuses only `already_up`, the children read
   * carries no closed filter, and a `parent_call` may be relayed from again. So
   * John really can put the question up, take it down, and put it up again.
   *
   * Keyed by wallet, those two would become "11 more tables" dated this morning
   * when eight of them opened last week: two human actions folded into one
   * event carrying cumulative reach at the wrong moment.
   */
  it("keeps two relay acts by one person as two events", () => {
    const inputs = lifecycleEvents(
      [
        card({
          state: "chain_moving",
          outgoing: outgoing({
            relayers: [relayer("John", NOW - HOUR, 3, 51), relayer("John", NOW - 40 * HOUR, 8, 42)],
            relayReach: 11,
          }),
        }),
      ],
      ctx,
    );
    expect(inputs.map((e) => e.relayReach)).toEqual([3, 8]);

    // And the collapse must agree, or the split above is undone downstream.
    const events = semanticEvents(inputs);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.support)).toEqual([
      "The question is now on 3 more tables.",
      "The question is now on 8 more tables.",
    ]);
    // Neither row carries the other's tables, and neither carries the total.
    for (const e of events) expect(e.support).not.toContain("11");
    // Each keeps its own moment rather than both taking the later one.
    expect(new Set(events.map((e) => e.atMs)).size).toBe(2);
  });

  it("still collapses a trade and the answer stamp it produced", () => {
    // The act key is opt-in: rows without one behave exactly as before.
    const merged = semanticEvents([
      {
        kind: "new_believer",
        marketId: 1,
        actor: { wallet: "0xc", name: "Casey" },
        atMs: 1,
        side: "NO",
      },
      {
        kind: "challenge_response",
        marketId: 1,
        actor: { wallet: "0xc", name: "Casey" },
        atMs: 1,
        answeredCaller: { wallet: "0xj", name: "John" },
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].headline).toBe("CASEY BACKED NO");
  });

  it("says tables, never people, once composed", () => {
    const [e] = semanticEvents(
      lifecycleEvents(
        [card({ outgoing: outgoing({ relayers: [relayer("John", NOW - HOUR, 8)] }) })],
        ctx,
      ),
    );
    expect(e.headline).toBe("JOHN KEPT IT MOVING");
    expect(e.support).toBe("The question is now on 8 more tables.");
    expect(`${e.headline} ${e.support}`).not.toMatch(/people/i);
  });
});

/* ── Completion ────────────────────────────────────────────────────────────── */

describe("completion comes from the lifecycle or not at all", () => {
  it("dates a taken-down Challenge by its closure", () => {
    const o = outgoing({ closedAtMs: NOW - HOUR, showedUp: 3, reached: 5, waiting: 2 });
    expect(completedAtMs(o)).toBe(NOW - HOUR);
  });

  /**
   * A CHALLENGE THAT COMPLETED BECAUSE EVERYBODY ANSWERED HAS NO CLOSURE STAMP.
   * The lifecycle ended; nobody ended it. The last answer is when that happened.
   */
  it("dates a fully-answered Challenge by its last answer", () => {
    const o = outgoing({
      reached: 2,
      showedUp: 2,
      waiting: 0,
      responders: [responder("Maya", NOW - 5 * HOUR), responder("Casey", NOW - HOUR)],
    });
    expect(completedAtMs(o)).toBe(NOW - HOUR);
  });

  it("returns zero rather than a guess when nothing proves an ending", () => {
    expect(completedAtMs(outgoing({ waiting: 3 }))).toBe(0);
    expect(completedAtMs(null)).toBe(0);
    // Reached zero is not a completed Challenge, it is one that reached nobody.
    expect(completedAtMs(outgoing({ reached: 0, waiting: 0 }))).toBe(0);
  });

  it("emits the completion with the canonical pair", () => {
    const [e] = lifecycleEvents(
      [
        card({
          state: "finished",
          outgoing: outgoing({ closedAtMs: NOW - HOUR, showedUp: 8, reached: 11, waiting: 3 }),
        }),
      ],
      ctx,
    );
    expect(e.kind).toBe("challenge_complete");
    expect(e.completion).toEqual({ showedUp: 8, reached: 11 });
    expect(semanticEvents([e])[0].support).toBe("8 of 11 showed up.");
  });

  it("reaches EVERYONE SHOWED UP, which no state could produce before", () => {
    const [e] = semanticEvents(
      lifecycleEvents(
        [
          card({
            state: "finished",
            outgoing: outgoing({
              reached: 2,
              showedUp: 2,
              waiting: 0,
              responders: [responder("Maya", NOW - 2 * HOUR), responder("Casey", NOW - HOUR)],
            }),
          }),
        ],
        ctx,
      ),
    );
    expect(e.headline).toBe("EVERYONE SHOWED UP");
    expect(e.support).toBeNull();
  });

  it("only speaks for a card the lifecycle already called finished", () => {
    for (const state of ["branch_live", "people_showing_up", "chain_moving"] as const)
      expect(
        kinds([card({ state, outgoing: outgoing({ closedAtMs: NOW - HOUR, showedUp: 1 }) })]),
      ).toEqual([]);
  });

  /**
   * CONVICTION OBSERVES CLOSURE; IT DOES NOT DECLARE IT. `marketClosed` is
   * hardcoded false until an indexer supplies it, so a completion row resting on
   * it would be the inference this codebase keeps refusing to make — dressed as
   * a headline.
   */
  it("refuses a closed market as evidence a Challenge completed", () => {
    expect(
      kinds([
        card({
          state: "finished",
          marketClosed: true,
          outgoing: outgoing({ closedAtMs: NOW - HOUR, showedUp: 3, reached: 5 }),
        }),
      ]),
    ).toEqual([]);
  });

  it("drops a completion older than the window", () => {
    expect(
      kinds([card({ state: "finished", outgoing: outgoing({ closedAtMs: FRESH - 1 }) })]),
    ).toEqual([]);
  });
});

/* ── The boundary ──────────────────────────────────────────────────────────── */

describe("it selects moments and owns no lifecycle of its own", () => {
  it("says nothing about a card with no branch of the viewer's own", () => {
    expect(kinds([card({ outgoing: null, state: "waiting" })])).toEqual([]);
  });

  it("says nothing at all without a reader", () => {
    expect(
      lifecycleEvents([card({ state: "finished", outgoing: outgoing({ closedAtMs: NOW }) })], {
        viewerWallet: "   ",
        freshAfterMs: FRESH,
      }),
    ).toEqual([]);
  });

  /**
   * ANSWERS ARE NOT HERE ON PURPOSE. `showedUpForMe` already emits them,
   * aggregated one row per market, because three people answering one question
   * is one thing that happened to the reader — a row each would make the tape
   * loudest on their best day.
   */
  it("emits no answer events, leaving the aggregated family alone", () => {
    const events = lifecycleEvents(
      [
        card({
          state: "people_showing_up",
          outgoing: outgoing({
            showedUp: 2,
            waiting: 1,
            responders: [responder("Maya", NOW - HOUR), responder("Casey", NOW - HOUR)],
          }),
        }),
      ],
      ctx,
    );
    for (const e of events) expect(e.kind).not.toBe("challenge_response");
  });

  /**
   * STRUCTURAL PRIVACY. Passers and waiting recipients exist as COUNTS on the
   * projection and as people nowhere on it, so no event this builds can name
   * one — the leak is impossible rather than merely avoided.
   */
  it("can name only people who acted", () => {
    const events = lifecycleEvents(
      [
        card({
          state: "chain_moving",
          outgoing: outgoing({
            passed: 4,
            waiting: 6,
            relayers: [relayer("John", NOW - HOUR, 8)],
            responders: [responder("Maya", NOW - HOUR)],
          }),
        }),
      ],
      ctx,
    );
    for (const e of events) expect(["John", "You"]).toContain(e.actor.name);
  });

  it("carries a relay and a completion from the same card without either eating the other", () => {
    expect(
      kinds([
        card({
          state: "finished",
          outgoing: outgoing({
            relayers: [relayer("John", NOW - 2 * HOUR, 8)],
            closedAtMs: NOW - HOUR,
            showedUp: 3,
            reached: 5,
          }),
        }),
      ]),
    ).toEqual(["relay", "challenge_complete"]);
  });
});
