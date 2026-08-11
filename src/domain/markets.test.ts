import { describe, it, expect } from "vitest";
import {
  MARKETS_BANNED_WORDS,
  believersLine,
  cardVocabulary,
  challengeSummary,
  earningsLine,
  heldSide,
  identityLabel,
  latestLine,
  makerRank,
  partitionMarkets,
  sortBelievers,
  sortMakers,
  type Holding,
  type MarketEntry,
} from "./markets";
import { cardStateFor, type ChallengeCardProjection, type Outgoing } from "./challenge-card";

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

const person = (name: string) => ({ wallet: `0x${name}`, name, avatarUrl: null });
let nextChallengeId = 100;
const relayer = (name: string, atMs = 1, reach = 0) => ({
  ...person(name),
  challengeId: nextChallengeId++,
  atMs,
  reach,
});

const projection = (over: Partial<ChallengeCardProjection> = {}): ChallengeCardProjection => {
  const base: Omit<ChallengeCardProjection, "state"> = {
    marketId: 1,
    question: "Q?",
    incoming: null,
    outgoing: outgoing(),
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

const entry = (over: Partial<MarketEntry> = {}): MarketEntry => ({
  marketId: 1,
  question: "Will AI make middle management obsolete?",
  ownership: "market_maker",
  holding: { yes: 1, no: 0 },
  participation: { believers: 18, yes: 11, no: 7 },
  latest: { line: "Maya backed YES.", atMs: 100 },
  challenge: null,
  earningsUsd: 4.82,
  createdAtMs: 10,
  ...over,
});

/* ── Identity ──────────────────────────────────────────────────────────────── */

describe("a Market Maker is never reduced to a believer", () => {
  it("names both facts, authorship first", () => {
    expect(identityLabel("market_maker", { yes: 1, no: 0 })).toBe("MARKET MAKER · BACKING YES");
    expect(identityLabel("market_maker", { yes: 0, no: 1 })).toBe("MARKET MAKER · BACKING NO");
    expect(identityLabel("market_maker", { yes: 1, no: 1 })).toBe(
      "MARKET MAKER · HOLDING BOTH SIDES",
    );
  });

  it("stays a Market Maker while holding nothing", () => {
    // Authorship is permanent; a position is not.
    expect(identityLabel("market_maker", { yes: 0, no: 0 })).toBe("MARKET MAKER");
  });

  /**
   * AN UNSETTLED BALANCE IS NOT AN EXIT AND NOT A SIDE. It must neither demote
   * the badge nor invent a direction, so the label simply stops at the role.
   */
  it("names no side when holdings are unknown", () => {
    expect(identityLabel("market_maker", null)).toBe("MARKET MAKER");
    expect(identityLabel("believer", null)).toBe("BELIEVER");
  });

  it("labels a believer by what they hold", () => {
    expect(identityLabel("believer", { yes: 3, no: 0 })).toBe("BELIEVER · YES");
    expect(identityLabel("believer", { yes: 0, no: 3 })).toBe("BELIEVER · NO");
    expect(identityLabel("believer", { yes: 3, no: 3 })).toBe("BELIEVER · BOTH SIDES");
  });

  it("never says BELIEVER on a market the viewer created", () => {
    for (const h of [null, { yes: 0, no: 0 }, { yes: 1, no: 0 }, { yes: 1, no: 1 }] as Holding[])
      expect(identityLabel("market_maker", h)).not.toMatch(/believer/i);
  });

  it("reads a side only from holdings that exist", () => {
    expect(heldSide(null)).toBeNull();
    expect(heldSide({ yes: 0, no: 0 })).toBeNull();
    expect(heldSide({ yes: 2, no: 2 })).toBe("BOTH");
  });
});

/* ── The partition ─────────────────────────────────────────────────────────── */

describe("one market, one section", () => {
  it("puts a created-and-held market under Market Maker only", () => {
    const { makers, believers } = partitionMarkets([
      entry({ marketId: 1, ownership: "market_maker", holding: { yes: 5, no: 0 } }),
    ]);
    expect(makers.map((m) => m.marketId)).toEqual([1]);
    expect(believers).toEqual([]);
  });

  it("cannot place the same market in both, whatever the mix", () => {
    const entries = [
      entry({ marketId: 1, ownership: "market_maker" }),
      entry({ marketId: 2, ownership: "believer" }),
      entry({ marketId: 3, ownership: "market_maker", holding: null }),
      entry({ marketId: 4, ownership: "believer", holding: { yes: 1, no: 1 } }),
    ];
    const { makers, believers } = partitionMarkets(entries);
    const ids = [...makers, ...believers].map((e) => e.marketId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(entries.length);
  });
});

/* ── Challenge state is consumed, never recomputed ─────────────────────────── */

describe("the Challenge summary reads canonical state", () => {
  it("reports responses as the projection counted them", () => {
    const c = projection({
      outgoing: outgoing({
        showedUp: 3,
        waiting: 10,
        responders: [{ ...person("casey"), side: "NO", atMs: 1 }],
      }),
    });
    expect(challengeSummary(c)).toBe("Challenge: 3 of 13 showed up · 10 waiting");
  });

  it("reports a live branch as tables, never as people", () => {
    const line = challengeSummary(projection({ outgoing: outgoing({ reached: 13 }) }));
    expect(line).toBe("Challenge: The question is now on 13 more tables.");
    expect(line).not.toMatch(/people/);
  });

  it("reports a chain moving without recounting it", () => {
    const c = projection({
      outgoing: outgoing({ showedUp: 1, relayers: [relayer("casey")], relayReach: 8 }),
    });
    expect(c.state).toBe("chain_moving");
    expect(challengeSummary(c)).toBe("Challenge: casey kept it moving.");
  });

  it("reports completion from the lifecycle rather than a fraction of its own", () => {
    const c = projection({ outgoing: outgoing({ reached: 11, showedUp: 8, waiting: 0 }) });
    expect(challengeSummary(c)).toBe("Challenge: 8 of 11 showed up.");
  });

  /**
   * A NULL PROJECTION IS NOT "NO ACTIVE CHALLENGE". It is a read that did not
   * complete, or a market with no Challenge relationship — and the card must not
   * pick one of those to assert.
   */
  it("says nothing at all when there is no projection", () => {
    expect(challengeSummary(null)).toBeNull();
    expect(cardVocabulary(entry({ challenge: null }))).not.toMatch(/no active|no challenge/i);
  });

  it("leaves the incoming side to the Challenge rail", () => {
    // Being asked by somebody else is not "what is happening around a question
    // I own", and repeating it here would put one relationship on two surfaces.
    for (const state of ["waiting", "showed_up"] as const) {
      const c = projection({
        outgoing: null,
        incoming: {
          callers: [person("maya")],
          primaryCall: 1,
          primaryCaller: person("maya"),
          primaryCallerSide: "YES",
          respondedAtMs: state === "showed_up" ? 5 : null,
          respondedSide: null,
        },
      });
      expect(c.state).toBe(state);
      expect(challengeSummary(c)).toBeNull();
    }
  });

  it("never names a passer in the summary", () => {
    const c = projection({ outgoing: outgoing({ showedUp: 1, passed: 4, waiting: 8 }) });
    expect(challengeSummary(c)).toContain("4 passed");
    expect(challengeSummary(c)).not.toMatch(/passed on|by [A-Z]/);
  });
});

/* ── Unknown is not zero ───────────────────────────────────────────────────── */

describe("absence of evidence is not evidence of absence", () => {
  it("says nothing rather than zero believers when the count is unknown", () => {
    expect(believersLine({ believers: null, yes: null, no: null })).toBeNull();
    expect(believersLine({ believers: 0, yes: 0, no: 0 })).toBeNull();
    expect(believersLine({ believers: 1, yes: 1, no: 0 })).toBe("1 believer");
    expect(believersLine({ believers: 18, yes: 11, no: 7 })).toBe("18 believers");
  });

  it("says nothing rather than 'no activity' when the latest event is missing", () => {
    expect(latestLine(null)).toBeNull();
    expect(cardVocabulary(entry({ latest: null }))).not.toMatch(/no activity|nothing happened/i);
  });

  it("says nothing rather than $0.00 when earnings are unknown", () => {
    expect(earningsLine(null)).toBeNull();
    expect(earningsLine(0)).toBeNull();
    expect(earningsLine(4.82)).toBe("+$4.82 creator earnings");
    expect(earningsLine(-1.5)).toBe("−$1.50 creator earnings");
  });
});

/* ── Hierarchy and order ───────────────────────────────────────────────────── */

describe("human activity leads, money does not", () => {
  it("puts earnings last in everything a card says", () => {
    const said = cardVocabulary(entry());
    expect(said.indexOf("creator earnings")).toBe(
      Math.max(said.indexOf("creator earnings"), said.indexOf("believer"), said.indexOf("Latest:")),
    );
  });

  it("ranks a response above a relay above ordinary activity", () => {
    const responding = entry({
      challenge: projection({ outgoing: outgoing({ showedUp: 2, waiting: 11 }) }),
    });
    const relaying = entry({
      challenge: projection({ outgoing: outgoing({ showedUp: 1, relayers: [relayer("c")] }) }),
    });
    const traded = entry({ challenge: null, latest: { line: "Maya backed YES.", atMs: 1 } });
    const quiet = entry({ challenge: null, latest: null });
    expect(makerRank(responding)).toBeGreaterThan(makerRank(relaying));
    expect(makerRank(relaying)).toBeGreaterThan(makerRank(traded));
    expect(makerRank(traded)).toBeGreaterThan(makerRank(quiet));
  });

  it("sorts makers by what a person did, then by when", () => {
    const sorted = sortMakers([
      entry({ marketId: 1, challenge: null, latest: null }),
      entry({
        marketId: 2,
        challenge: projection({ outgoing: outgoing({ showedUp: 1, waiting: 12 }) }),
      }),
      entry({ marketId: 3, challenge: null, latest: { line: "x", atMs: 500 } }),
    ]);
    expect(sorted.map((e) => e.marketId)).toEqual([2, 3, 1]);
  });

  it("is stable for two markets with nothing to separate them", () => {
    const a = entry({ marketId: 7, challenge: null, latest: null, createdAtMs: 1 });
    const b = entry({ marketId: 3, challenge: null, latest: null, createdAtMs: 1 });
    expect(sortMakers([a, b]).map((e) => e.marketId)).toEqual([3, 7]);
    expect(sortBelievers([a, b]).map((e) => e.marketId)).toEqual([3, 7]);
  });

  it("leads believer markets with whatever moved most recently", () => {
    const sorted = sortBelievers([
      entry({ marketId: 1, latest: { line: "x", atMs: 10 } }),
      entry({ marketId: 2, latest: { line: "y", atMs: 900 } }),
    ]);
    expect(sorted.map((e) => e.marketId)).toEqual([2, 1]);
  });
});

/* ── Vocabulary ────────────────────────────────────────────────────────────── */

describe("words this page must never use", () => {
  const shapes = (): MarketEntry[] => {
    const out: MarketEntry[] = [];
    for (const ownership of ["market_maker", "believer"] as const)
      for (const holding of [null, { yes: 0, no: 0 }, { yes: 1, no: 0 }, { yes: 1, no: 1 }])
        for (const challenge of [
          null,
          projection(),
          projection({ outgoing: outgoing({ showedUp: 2, passed: 1, waiting: 10 }) }),
          projection({
            outgoing: outgoing({ relayers: [relayer("c")], relayReach: 8, showedUp: 1 }),
          }),
          projection({ outgoing: outgoing({ reached: 11, showedUp: 11, waiting: 0 }) }),
          projection({ outgoing: outgoing({ reached: 11, showedUp: 0, passed: 11, waiting: 0 }) }),
        ])
          for (const latest of [null, { line: "Maya backed YES.", atMs: 1 }])
            for (const earningsUsd of [null, 0, 4.82])
              out.push(entry({ ownership, holding, challenge, latest, earningsUsd }));
    return out;
  };

  it("never says any of them, in any shape a card can take", () => {
    for (const e of shapes()) {
      const said = cardVocabulary(e).toLowerCase();
      for (const banned of MARKETS_BANNED_WORDS)
        expect(said, `${banned} :: ${said}`).not.toContain(banned);
    }
  });

  it("never describes recipient reach as people", () => {
    for (const e of shapes()) {
      const said = cardVocabulary(e);
      const reach = e.challenge?.outgoing?.reached;
      if (!reach) continue;
      // The reach number may appear ("13 more tables") but never beside "people".
      expect(said).not.toMatch(new RegExp(`${reach}\\s+(more\\s+)?people`));
    }
  });
});
