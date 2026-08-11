import { describe, it, expect } from "vitest";
import {
  POST_ACTION_BANNED,
  challengeLabel,
  realizedLine,
  refusalIsCanonical,
  resolvePostAction,
  WRITE_FAILED_SUPPORT,
  WRITE_FAILED_TITLE,
  WRITE_RETRY_LABEL,
  type Audience,
  type BuyInput,
  type CreateMarketInput,
  type PostActionExperience,
  type PostActionInput,
  type SellInput,
} from "./post-action";

const aud = (over: Partial<Audience> = {}): Audience => ({
  status: "available",
  total: 13,
  singleRecipientName: null,
  formingOnly: false,
  ...over,
});

const buy = (over: Partial<BuyInput> = {}): BuyInput => ({
  action: "first_buy",
  role: "believer",
  side: "YES",
  after: { yes: 10, no: 0 },
  firstBeliever: false,
  flipped: false,
  answered: null,
  nextIncoming: null,
  outgoing: "none",
  outgoingProgress: null,
  capacity: { active: 0, total: 3 },
  audience: aud(),
  ...over,
});

const sell = (over: Partial<SellInput> = {}): SellInput =>
  ({
    action: "partial_sell",
    role: "believer",
    side: "YES",
    after: { yes: 4, no: 0 },
    realizedGainUsd: null,
    proceedsUsd: null,
    remainingValueUsd: null,
    outgoing: "none",
    outgoingProgress: null,
    capacity: { active: 0, total: 3 },
    audience: aud(),
    ...over,
  }) as SellInput;

const create = (over: Partial<CreateMarketInput> = {}): CreateMarketInput => ({
  action: "create_market",
  role: "market_maker",
  side: null,
  outgoing: "none",
  outgoingProgress: null,
  capacity: { active: 0, total: 3 },
  audience: aud(),
  ...over,
});

/**
 * THE TYPE IS THE FIRST TEST.
 *
 * These do not assert behaviour — they assert that impossible states cannot be
 * CONSTRUCTED. Each `@ts-expect-error` fails the build if the union ever widens
 * enough to admit the combination again, which is a stronger guarantee than any
 * runtime branch could give.
 */
describe("impossible states do not typecheck", () => {
  it("refuses a creation authored by a mere believer", () => {
    // @ts-expect-error a creation is authored by definition
    const bad: CreateMarketInput = { ...create(), role: "believer" };
    expect(bad).toBeTruthy();
  });

  it("refuses a creation that answered somebody", () => {
    // @ts-expect-error nobody brings you into your own question
    const bad: CreateMarketInput = { ...create(), answered: { count: 1, primaryCallerName: "M" } };
    expect(bad).toBeTruthy();
  });

  it("refuses a directionless buy", () => {
    // @ts-expect-error there is no purchase without a side
    const bad: BuyInput = { ...buy(), side: null };
    expect(bad).toBeTruthy();
  });

  it("refuses a market exit that still holds something", () => {
    // @ts-expect-error leaving a market means nothing is left
    const bad: SellInput = { ...sell({ action: "market_exit" }), after: { yes: 4, no: 0 } };
    expect(bad).toBeTruthy();
  });

  it("refuses buy-only fields on a sell", () => {
    // @ts-expect-error a sell never offers the next question
    const bad: SellInput = { ...sell(), nextIncoming: { name: "John" } };
    expect(bad).toBeTruthy();
  });
});

describe("one next action, in one order", () => {
  it("offers the chain first when there is room and an audience", () => {
    expect(resolvePostAction(buy()).primary).toEqual({
      kind: "challenge",
      label: "Challenge all 13",
    });
  });

  it("offers Make room when the audience exists but the table is full", () => {
    const r = resolvePostAction(buy({ capacity: { active: 3, total: 3 } }));
    expect(r.primary.kind).toBe("make_room");
    expect(r.challengeModule?.kind).toBe("make_room");
  });

  it("points at a waiting person before a generic next question", () => {
    const r = resolvePostAction(
      buy({ audience: aud({ status: "none", total: 0 }), nextIncoming: { name: "John" } }),
    );
    expect(r.primary).toEqual({ kind: "answer", label: "Answer John" });
  });

  it("never offers a Challenge while one is already live on this market", () => {
    const r = resolvePostAction(buy({ outgoing: "live" }));
    expect(r.primary.kind).not.toBe("challenge");
    expect(r.challengeModule).toBeNull();
  });
});

describe("a read that failed is not an empty network", () => {
  it("hides the module rather than saying nobody qualifies", () => {
    for (const status of ["failed", "loading"] as const) {
      const r = resolvePostAction(buy({ audience: aud({ status, total: 0 }) }));
      expect(r.challengeModule, status).toBeNull();
      expect(`${r.headline} ${r.support ?? ""}`.toLowerCase()).not.toContain("nobody");
    }
  });
});

/**
 * THE CTA NAMES SOMEBODY FROM THE AUDIENCE, OR NAMES NOBODY.
 *
 * It used to read the PRIMARY CALLER — the person who challenged the viewer —
 * so an audience of one rendered "Challenge Maya" where Maya had just challenged
 * THEM. The wrong side of the relationship, on a button that contacts a
 * different person entirely.
 */
describe("the CTA can only name somebody it would actually reach", () => {
  it("names the sole recipient when the audience supplies one", () => {
    expect(challengeLabel(aud({ total: 1, singleRecipientName: "Maya" }))).toBe("Challenge Maya");
  });

  it("names nobody when the audience has not supplied a name", () => {
    expect(challengeLabel(aud({ total: 1 }))).toBe("Challenge them");
    expect(challengeLabel(aud({ total: 1 }))).not.toMatch(/all 1|\bundefined\b|\bnull\b/);
  });

  it("cannot be reached by the caller's name", () => {
    // Structural: the label takes an Audience, so there is nowhere to pass one.
    const r = resolvePostAction(
      buy({
        answered: { count: 1, primaryCallerName: "Maya" },
        audience: aud({ total: 1, singleRecipientName: "Casey" }),
      }),
    );
    expect(r.primary.label).toBe("Challenge Casey");
  });

  it("counts rather than listing past two", () => {
    expect(challengeLabel(aud({ total: 2 }))).toBe("Challenge both");
    expect(challengeLabel(aud({ total: 13 }))).toBe("Challenge all 13");
  });
});

describe("what the buy screen leads with", () => {
  it("puts an answered call above every personal fact", () => {
    const r = resolvePostAction(buy({ answered: { count: 1, primaryCallerName: "Maya" } }));
    expect(r.headline).toBe("You showed up for Maya.");
    expect(r.copyCategory).toBe("reciprocity");
  });

  it("never says '1 people'", () => {
    // The plural branch used to catch a count of one whose name was missing.
    const r = resolvePostAction(buy({ answered: { count: 1, primaryCallerName: "  " } }));
    expect(r.headline).toBe("You showed up for someone.");
    expect(r.headline).not.toMatch(/1 people/);
  });

  it("says the SAME headline whichever side the reader took", () => {
    const y = resolvePostAction(
      buy({ answered: { count: 1, primaryCallerName: "M" }, side: "YES" }),
    );
    const n = resolvePostAction(
      buy({ answered: { count: 1, primaryCallerName: "M" }, side: "NO" }),
    );
    expect(y.headline).toBe(n.headline);
    expect(y.support).toBe("You backed YES.");
    expect(n.support).toBe("You backed NO.");
  });

  it("says the branch is already live rather than offering a second one", () => {
    const r = resolvePostAction(
      buy({ answered: { count: 1, primaryCallerName: "M" }, outgoing: "live" }),
    );
    expect(r.consequence).toBe("branch_live");
    expect(r.challengeModule).toBeNull();
  });

  it("hands an organic first buy back to the personal reveal", () => {
    expect(resolvePostAction(buy()).consequence).toBe("reveal");
  });

  it("keeps a creator a Market Maker even when they back their own question", () => {
    expect(resolvePostAction(buy({ role: "market_maker_and_believer" })).copyCategory).toBe(
      "market_maker",
    );
  });

  it("does not call holding both sides a change of mind", () => {
    const r = resolvePostAction(
      buy({ action: "buy_opposite_side", side: "NO", after: { yes: 10, no: 5 } }),
    );
    expect(r.headline).toBe("You added NO.");
    expect(r.support).toBe("You now hold both sides.");
    expect(r.copyCategory).toBe("general");
  });
});

describe("a sell never leaves the market, and never guesses", () => {
  it("refuses to characterise a sale it cannot see the result of", () => {
    const r = resolvePostAction(sell({ after: null }));
    expect(r.headline).toBe("Sale confirmed.");
    expect(r.support).toBe("Your position is updating.");
    expect(r.challengeModule).toBeNull();
  });

  it("says what is left, with a value only when it has one", () => {
    expect(resolvePostAction(sell({ remainingValueUsd: 41.2 })).support).toBe(
      "Still backing YES with $41.20.",
    );
    expect(resolvePostAction(sell()).support).toBe("Still backing YES.");
  });

  it("does not say 'you're out' to somebody who still holds the other side", () => {
    const r = resolvePostAction(
      sell({ action: "side_exit", side: "YES", after: { yes: 0, no: 7 } }),
    );
    expect(r.headline).toBe("You left YES.");
    expect(r.support).toMatch(/Still backing NO/);
  });

  it("offers an ordinary believer no new Challenge after a full exit", () => {
    const r = resolvePostAction(sell({ action: "market_exit", after: { yes: 0, no: 0 } }));
    expect(r.headline).toBe("You're out.");
    expect(r.challengeModule).toBeNull();
    expect(r.primary.kind).toBe("back_to_market");
  });

  it("lets a Market Maker keep asking after their own exit", () => {
    const r = resolvePostAction(
      sell({ action: "market_exit", role: "market_maker", after: { yes: 0, no: 0 } }),
    );
    expect(r.headline).toBe("Your position is closed.");
    expect(r.support).toBe("Your question is still alive.");
    expect(r.primary.kind).toBe("challenge");
  });

  it("calls proceeds returned, never profit", () => {
    const r = resolvePostAction(
      sell({ action: "market_exit", after: { yes: 0, no: 0 }, proceedsUsd: 18.42 }),
    );
    expect(r.support).toBe("Closed YES. $18.42 returned.");
  });

  it("states a realised gain only when there is one", () => {
    expect(realizedLine(null)).toBeNull();
    expect(realizedLine(0)).toBeNull();
    expect(realizedLine(4.2)).toBe("+$4.20 realized");
    expect(realizedLine(-4.2)).toBe("−$4.20 realized");
  });
});

describe("the create screen", () => {
  it("leads with the market", () => {
    const r = resolvePostAction(create());
    expect(r.headline).toBe("Your market is live.");
    expect(r.copyCategory).toBe("market_maker");
  });

  it("never renders View Market as both actions", () => {
    // With no audience the primary BECOMES View Market, so the secondary must go.
    const r = resolvePostAction(create({ audience: aud({ status: "none", total: 0 }) }));
    expect(r.primary.kind).toBe("view_market");
    expect(r.secondary).toBeNull();
  });

  it("never calls a creator's own Challenge a relay — nobody brought them in", () => {
    expect(resolvePostAction(create()).challengeModule?.kind).toBe("organic");
  });
});

/**
 * THE CORPUS. Every branch the resolver can reach, varied across every axis
 * that can change its answer — so the guards below are about the whole surface
 * rather than about a handful of cases somebody happened to think of.
 */
function corpus(): { input: PostActionInput; out: PostActionExperience }[] {
  const rows: PostActionInput[] = [];

  /**
   * ONE AXIS AT A TIME, FROM EVERY SHAPE OF BASE.
   *
   * A full cartesian sweep is ~300k rows and takes longer to assert than the
   * whole suite takes to run — so it was silently cut down, which is how a
   * "comprehensive" corpus becomes decorative. Sweeping each axis independently
   * against every base shape covers every value the brief names, keeps the
   * count in the hundreds, and stays honest about what it proves: each axis is
   * varied, their interactions are not exhaustively crossed.
   */
  const bases: PostActionInput[] = [
    create(),
    create({ role: "market_maker_and_believer", side: "YES" }),
    buy(),
    buy({ answered: { count: 1, primaryCallerName: "Maya" } }),
    buy({ answered: { count: 1, primaryCallerName: "  " } }),
    buy({ answered: { count: 3, primaryCallerName: "Maya" } }),
    buy({ action: "buy_more" }),
    buy({ action: "buy_opposite_side", side: "NO", after: { yes: 10, no: 5 } }),
    sell(),
    sell({ action: "side_exit", after: { yes: 0, no: 7 } }),
    sell({ action: "market_exit", after: { yes: 0, no: 0 } }),
  ];

  const audiences: Audience[] = [];
  for (const status of ["loading", "available", "none", "failed"] as const)
    for (const total of [0, 1, 2, 13])
      for (const singleRecipientName of [null, "Casey"])
        for (const formingOnly of [false, true])
          audiences.push({ status, total, singleRecipientName, formingOnly });

  for (const base of bases) {
    rows.push(base);
    for (const audience of audiences) rows.push({ ...base, audience });
    for (const outgoing of ["none", "live", "completed", "removed"] as const)
      rows.push({ ...base, outgoing });
    for (const capacity of [
      { active: 0, total: 3 },
      { active: 2, total: 3 },
      { active: 3, total: 3 },
      { active: 9, total: 3 },
    ])
      rows.push({ ...base, capacity });
    for (const role of ["market_maker", "believer", "market_maker_and_believer"] as const) {
      // A creation cannot be authored by a believer, and the type says so.
      if (base.action === "create_market" && role === "believer") continue;
      rows.push({ ...base, role } as PostActionInput);
    }
    if (base.action !== "create_market")
      for (const side of ["YES", "NO"] as const) rows.push({ ...base, side });
    if (base.action === "create_market")
      for (const side of [null, "YES", "NO"] as const) rows.push({ ...base, side });
    if (
      base.action === "first_buy" ||
      base.action === "buy_more" ||
      base.action === "buy_opposite_side"
    ) {
      for (const nextIncoming of [null, { name: "John" }]) rows.push({ ...base, nextIncoming });
      for (const answered of [
        null,
        { count: 1, primaryCallerName: "Maya" },
        { count: 1, primaryCallerName: "" },
        { count: 2, primaryCallerName: "Maya" },
      ])
        rows.push({ ...base, answered });
      for (const after of [
        { yes: 10, no: 0 },
        { yes: 10, no: 5 },
        { yes: 0, no: 7 },
      ])
        rows.push({ ...base, after });
    }
    if (
      base.action === "partial_sell" ||
      base.action === "side_exit" ||
      base.action === "market_exit"
    ) {
      for (const realizedGainUsd of [null, 0, 4.2, -4.2]) rows.push({ ...base, realizedGainUsd });
      for (const proceedsUsd of [null, 18.42]) rows.push({ ...base, proceedsUsd });
      for (const remainingValueUsd of [null, 41.2]) rows.push({ ...base, remainingValueUsd });
      // The unknown balance, which every sell shape must survive.
      rows.push({ ...base, after: null } as PostActionInput);
    }
  }

  return rows.map((input) => ({ input, out: resolvePostAction(input) }));
}

describe("every branch, asserted together", () => {
  const all = corpus();

  it("covers a real surface rather than a handful of cases", () => {
    expect(all.length).toBeGreaterThan(400);
    expect(new Set(all.map((r) => r.out.headline)).size).toBeGreaterThan(8);
    expect(new Set(all.map((r) => r.out.primary.label)).size).toBeGreaterThan(5);
  });

  it("always returns exactly one primary action", () => {
    for (const { out } of all) expect(out.primary.label.trim().length).toBeGreaterThan(0);
  });

  it("never repeats the primary as the secondary", () => {
    for (const { out } of all) {
      if (!out.secondary) continue;
      expect(out.secondary.kind).not.toBe(out.primary.kind);
      expect(out.secondary.label).not.toBe(out.primary.label);
    }
  });

  it("never sends a sell to the next question", () => {
    for (const { input, out } of all) {
      if (
        !input.action.includes("sell") &&
        input.action !== "side_exit" &&
        input.action !== "market_exit"
      )
        continue;
      expect(out.stayOnMarket).toBe(true);
      expect(out.primary.kind).not.toBe("next_question");
      expect(out.secondary?.kind ?? "").not.toBe("next_question");
    }
  });

  it("never offers a Challenge for a market already carrying one", () => {
    for (const { input, out } of all) {
      if (input.outgoing !== "live") continue;
      expect(out.primary.kind).not.toBe("challenge");
      expect(out.challengeModule).not.toBe("relay");
      expect(out.challengeModule).not.toBe("organic");
    }
  });

  it("never mismatches a number and its noun", () => {
    for (const { out } of all) {
      const text = `${out.headline} ${out.support ?? ""} ${out.primary.label}`;
      expect(text).not.toMatch(/\b1 (people|tables|others)\b/);
      expect(text).not.toMatch(/\b(?!1\b)\d+ (person|table)\b/);
      expect(text).not.toMatch(/\ball 1\b/);
      expect(text).not.toMatch(/undefined|null|NaN/);
    }
  });

  it("never uses a banned word", () => {
    for (const { out } of all) {
      const text =
        `${out.headline} ${out.support ?? ""} ${out.primary.label} ${out.secondary?.label ?? ""}`.toLowerCase();
      for (const w of POST_ACTION_BANNED) expect(text, text).not.toContain(w);
    }
  });

  it("never promises a relationship transition it cannot prove", () => {
    for (const { out } of all)
      expect(`${out.headline} ${out.support ?? ""}`.toLowerCase()).not.toMatch(
        /away from your tribe|become a rival|add them to your/,
      );
  });

  it("keeps every line inside the length budget", () => {
    for (const { out } of all) {
      expect(out.headline.split(/\s+/).length).toBeLessThanOrEqual(12);
      expect((out.support ?? "").split(/\s+/).length).toBeLessThanOrEqual(18);
    }
  });
});

/**
 * THE BASELINE COPY MATRIX, ROW BY ROW.
 *
 * Each `it` below is one row of the approved matrix. They are deliberately
 * literal about the words: this screen is the product's single most-read moment
 * and the difference between "You're out" and "You left YES" is the difference
 * between a true sentence and a false one about somebody who still holds half a
 * position.
 */
describe("the approved copy matrix", () => {
  describe("buy", () => {
    it("names one person who was answered, and never pluralises a count of one", () => {
      const r = resolvePostAction(
        buy({ answered: { count: 1, primaryCallerName: "Maya" }, side: "YES" }),
      );
      expect(r.headline).toBe("You showed up for Maya.");
      expect(r.support).toBe("You backed YES.");
      expect(r.primary.kind).toBe("challenge");
    });

    it("counts several without naming any of them", () => {
      const r = resolvePostAction(buy({ answered: { count: 3, primaryCallerName: "Maya" } }));
      expect(r.headline).toBe("You showed up for 3 people.");
      expect(r.headline).not.toContain("Maya");
    });

    it("leads with being first, and still hands the reveal the moment", () => {
      const r = resolvePostAction(buy({ firstBeliever: true, side: "NO" }));
      expect(r.headline).toBe("You're first.");
      expect(r.support).toBe("You're the first believer on NO.");
      expect(r.consequence).toBe("reveal");
    });

    it("confirms an ordinary organic buy and defers to the reveal", () => {
      const r = resolvePostAction(buy());
      expect(r.headline).toBe("That's a real call.");
      expect(r.consequence).toBe("reveal");
    });

    it("says conviction grew when more of the same side is bought", () => {
      const r = resolvePostAction(buy({ action: "buy_more", side: "YES" }));
      expect(r.headline).toBe("You added to YES.");
      expect(r.support).toBe("Your conviction grew.");
    });

    it("calls holding both sides what it is, and never a flip", () => {
      const r = resolvePostAction(
        buy({ action: "buy_opposite_side", side: "NO", after: { yes: 5, no: 5 }, flipped: false }),
      );
      expect(r.headline).toBe("You added NO.");
      expect(r.support).toBe("You now hold both sides.");
      expect(r.headline).not.toMatch(/flip/i);
      // Neutral framing: "see who stands with you" is wrong for somebody holding both.
      expect(r.copyCategory).toBe("general");
    });

    it("calls a proven flip a flip, and only when the old side is gone", () => {
      const r = resolvePostAction(
        buy({ action: "buy_opposite_side", side: "NO", after: { yes: 0, no: 9 }, flipped: true }),
      );
      expect(r.headline).toBe("Your position flipped to NO.");
    });

    it("keeps a Market Maker a Market Maker on their own question", () => {
      const r = resolvePostAction(buy({ role: "market_maker_and_believer", side: "YES" }));
      expect(r.headline).toBe("You made the question. Now you're in.");
      expect(r.identity).toBe("Market Maker · Backing YES");
      // NEVER reduced to a believer badge on a market they authored.
      expect(r.identity).not.toMatch(/believer/i);
    });

    it("says the branch is already live rather than offering a second Challenge", () => {
      const r = resolvePostAction(
        buy({
          answered: { count: 1, primaryCallerName: "Maya" },
          outgoing: "live",
          outgoingProgress: { shown: 3, reached: 11 },
        }),
      );
      expect(r.consequence).toBe("branch_live");
      expect(r.consequenceLine).toBe("3 of 11 have shown up.");
      expect(r.primary.kind).not.toBe("challenge");
    });

    it("says a Challenge is live without a fraction when the read did not complete", () => {
      const r = resolvePostAction(buy({ outgoing: "live", outgoingProgress: null }));
      expect(r.consequence).toBe("branch_live");
      // Half this sentence is checkable and the other half would be invented.
      expect(r.consequenceLine).toBeNull();
    });

    it("offers Next Question, never a disabled Challenge, when nobody qualifies", () => {
      const r = resolvePostAction(buy({ audience: aud({ status: "none", total: 0 }) }));
      expect(r.primary).toEqual({ kind: "next_question", label: "Next Question" });
      expect(r.challengeModule).toBeNull();
    });

    it("makes no audience claim at all when the audience read failed", () => {
      const r = resolvePostAction(buy({ audience: aud({ status: "failed", total: 0 }) }));
      expect(r.challengeModule).toBeNull();
      expect(r.primary.kind).toBe("next_question");
      // The reader must never learn an enhancement was attempted and failed.
      expect(`${r.headline} ${r.support ?? ""}`).not.toMatch(/qualif|nobody|could not|failed/i);
    });
  });

  describe("the challenge module says what is true of this audience", () => {
    it("frames a relay as keeping the chain moving", () => {
      const r = resolvePostAction(buy({ answered: { count: 1, primaryCallerName: "Maya" } }));
      expect(r.challengeModule?.kind).toBe("relay");
      expect(r.challengeModule?.title).toBe("Keep the chain moving");
    });

    it("frames an organic buy as belief nobody can answer back", () => {
      expect(resolvePostAction(buy()).challengeModule?.title).toBe(
        "Belief is easy when no one can answer back",
      );
    });

    it("refuses to promise a Tribe to somebody whose audience is all Still Forming", () => {
      const r = resolvePostAction(buy({ audience: aud({ total: 6, formingOnly: true }) }));
      expect(r.challengeModule?.kind).toBe("still_forming");
      expect(r.challengeModule?.title).toBe("The map is still taking shape");
      expect(r.challengeModule?.support).toBe("Every honest answer makes it clearer.");
      // The CTA still reaches all six — the framing changed, not the offer.
      expect(r.primary.label).toBe("Challenge all 6");
    });

    it("still forming outranks the relay framing, because the promise is the risk", () => {
      const r = resolvePostAction(
        buy({
          answered: { count: 1, primaryCallerName: "Maya" },
          audience: aud({ total: 6, formingOnly: true }),
        }),
      );
      expect(r.challengeModule?.kind).toBe("still_forming");
    });
  });

  describe("sell", () => {
    it("never leaves the market and never offers Next Question", () => {
      for (const action of ["partial_sell", "side_exit", "market_exit"] as const) {
        const r = resolvePostAction(
          sell({
            action,
            after: action === "market_exit" ? { yes: 0, no: 0 } : { yes: 3, no: 0 },
          } as Partial<SellInput>),
        );
        expect(r.stayOnMarket).toBe(true);
        for (const cta of [r.primary, r.secondary]) expect(cta?.kind).not.toBe("next_question");
      }
    });

    it("says what is left after taking some off", () => {
      const r = resolvePostAction(
        sell({
          after: { yes: 4, no: 0 },
          remainingValueUsd: 41.2,
          audience: aud({ total: 0, status: "none" }),
        }),
      );
      expect(r.headline).toBe("You took some off.");
      expect(r.support).toBe("Still backing YES with $41.20.");
    });

    it("frames a sell Challenge around where people land, not around leaving", () => {
      const r = resolvePostAction(sell({ audience: aud({ total: 8 }) }));
      expect(r.primary.label).toBe("Challenge all 8");
      expect(r.challengeModule?.support).toBe("See where your people land.");
    });

    it("offers the chain, not the market twice, when a Challenge is already live here", () => {
      const r = resolvePostAction(
        sell({ outgoing: "live", outgoingProgress: { shown: 3, reached: 9 } }),
      );
      expect(r.consequence).toBe("challenge_live");
      expect(r.consequenceLine).toBe("3 of 9 have shown up.");
      expect(r.primary.kind).toBe("back_to_market");
      expect(r.secondary?.kind).toBe("see_chain");
    });

    it("does NOT say 'you're out' to somebody who still holds the other side", () => {
      const r = resolvePostAction(
        sell({
          action: "side_exit",
          side: "YES",
          after: { yes: 0, no: 7 },
          remainingValueUsd: 24.1,
        }),
      );
      expect(r.headline).toBe("You left YES.");
      expect(r.support).toBe("Still backing NO with $24.10.");
      expect(r.headline).not.toMatch(/you're out/i);
    });

    it("says a believer is out, returns proceeds, and offers nothing social", () => {
      const r = resolvePostAction(
        sell({
          action: "market_exit",
          role: "believer",
          side: "YES",
          after: { yes: 0, no: 0 },
          proceedsUsd: 18.42,
        }),
      );
      expect(r.headline).toBe("You're out.");
      expect(r.support).toBe("Closed YES. $18.42 returned.");
      expect(r.challengeModule).toBeNull();
      expect(r.primary.kind).toBe("back_to_market");
      expect(r.secondary).toBeNull();
      // Proceeds are what came back. A gain is what was made.
      expect(r.support).not.toMatch(/profit/i);
    });

    it("lets a Market Maker who exited still ask about their own question", () => {
      const r = resolvePostAction(
        sell({
          action: "market_exit",
          role: "market_maker_and_believer",
          after: { yes: 0, no: 0 },
          audience: aud({ total: 11 }),
        }),
      );
      expect(r.headline).toBe("Your position is closed.");
      expect(r.support).toBe("Your question is still alive.");
      expect(r.primary.label).toBe("Challenge all 11");
      // Asking people to answer the question, not to copy a position they left.
      expect(r.identity).toBe("Market Maker");
    });

    it("characterises nothing when the post-sell balance is unknown", () => {
      const r = resolvePostAction(sell({ after: null }));
      expect(r.headline).toBe("Sale confirmed.");
      expect(r.support).toBe("Your position is updating.");
      for (const wrong of ["out", "left", "took some off"])
        expect(r.headline.toLowerCase()).not.toContain(wrong);
    });
  });

  describe("create", () => {
    it("invites rather than congratulating when there are people to ask", () => {
      const r = resolvePostAction(create({ audience: aud({ total: 13 }) }));
      expect(r.headline).toBe("Your market is live.");
      expect(r.support).toBe("The question began with you. It doesn't have to end there.");
      expect(r.primary.label).toBe("Challenge all 13");
      expect(r.secondary).toEqual({ kind: "view_market", label: "View Market" });
    });

    it("never turns a successful creation into an empty-network message", () => {
      const r = resolvePostAction(create({ audience: aud({ status: "none", total: 0 }) }));
      expect(r.support).toBe("You gave the question a place to live.");
      expect(r.primary).toEqual({ kind: "view_market", label: "View Market" });
      // One destination rendered twice reads as a bug.
      expect(r.secondary).toBeNull();
      expect(`${r.headline} ${r.support}`).not.toMatch(/nobody|no one|qualif|empty/i);
    });

    it("offers Make room rather than swallowing the moment at a full table", () => {
      const r = resolvePostAction(create({ capacity: { active: 3, total: 3 } }));
      expect(r.primary).toEqual({ kind: "make_room", label: "Make room" });
      expect(r.challengeModule?.title).toBe("Your table is full");
      expect(r.challengeModule?.support).toBe("Three questions already have a place.");
      expect(r.secondary?.kind).toBe("view_market");
    });

    it("keeps the Market Maker identity when the creator seeded a position", () => {
      const r = resolvePostAction(create({ role: "market_maker_and_believer", side: "YES" }));
      expect(r.identity).toBe("Market Maker · Backing YES");
    });

    it("never sends a creator to Next Question", () => {
      for (const audience of [aud(), aud({ status: "none", total: 0 }), aud({ status: "failed" })])
        for (const capacity of [
          { active: 0, total: 3 },
          { active: 3, total: 3 },
        ]) {
          const r = resolvePostAction(create({ audience, capacity }));
          for (const cta of [r.primary, r.secondary]) expect(cta?.kind).not.toBe("next_question");
        }
    });
  });
});

/**
 * UNKNOWN IS NOT ZERO — the invariant, now applied to all three actions.
 *
 * A buy's `after` used to be a required `Holdings`, so the adapter filled it
 * with `{ yes: 0, no: 0 }` purely to satisfy the type. That is a fabricated
 * reading, and the type could not tell it from a real one.
 */
describe("a confirmed action proves the action; a balance proves the holdings", () => {
  it("still says what a buy did when the balance has not landed", () => {
    const r = resolvePostAction(buy({ after: null, side: "YES" }));
    expect(r.headline).toBe("That's a real call.");
    expect(r.support).toBe("You backed YES.");
  });

  it("claims neither both-sides nor a flip without a reading", () => {
    const r = resolvePostAction(buy({ action: "buy_opposite_side", side: "NO", after: null }));
    expect(r.headline).toBe("You added NO.");
    // Both of these need a balance, and neither is guessed in either direction.
    expect(r.support).toBeNull();
    expect(r.headline).not.toMatch(/flip/i);
  });

  it("keeps a Market Maker who just bought their own question a Market Maker", () => {
    /**
     * THE BUG THIS CLOSES. Role was derived from `after`, so for the width of a
     * refetch a creator who had just backed their own YES was classified
     * `market_maker` — saying less than the confirmed transaction already proved.
     */
    const r = resolvePostAction(
      buy({ role: "market_maker_and_believer", side: "YES", after: null }),
    );
    expect(r.headline).toBe("You made the question. Now you're in.");
    expect(r.identity).toBe("Market Maker · Backing YES");
  });
});

describe("a refused write is a transient fact, not a new post-action state", () => {
  it("keeps refusals out of the experience entirely", () => {
    // `put_on_table` rolls back whole, so nothing about this market or person
    // changed. The experience is identical before and after a failed press.
    const before = resolvePostAction(buy());
    expect(before).not.toHaveProperty("status");
    expect(before).not.toHaveProperty("error");
  });

  it("treats a lost race as the canonical state arriving late, not a failure", () => {
    // Another tab put this market up, or filled the table, or the audience moved.
    // Re-reading makes the screen say the true thing on its own.
    for (const reason of ["already_up", "full", "no_audience", "no_reach"] as const)
      expect(refusalIsCanonical(reason)).toBe(true);
  });

  it("treats a genuine write failure as a failure worth saying out loud", () => {
    for (const reason of ["failed", "bad_parent", "audience_unavailable"] as const)
      expect(refusalIsCanonical(reason)).toBe(false);
  });

  it("says nothing changed, and says it without a database in it", () => {
    const said = `${WRITE_FAILED_TITLE} ${WRITE_FAILED_SUPPORT} ${WRITE_RETRY_LABEL}`;
    expect(WRITE_FAILED_SUPPORT).toBe("Nothing changed.");
    for (const jargon of ["rpc", "sql", "postgres", "constraint", "transaction", "error", "500"])
      expect(said.toLowerCase()).not.toContain(jargon);
    for (const banned of POST_ACTION_BANNED) expect(said.toLowerCase()).not.toContain(banned);
  });
});
