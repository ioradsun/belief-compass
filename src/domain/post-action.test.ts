import { describe, it, expect } from "vitest";
import {
  POST_ACTION_BANNED,
  challengeLabel,
  realizedLine,
  resolvePostAction,
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
  ...over,
});

const buy = (over: Partial<BuyInput> = {}): BuyInput => ({
  action: "first_buy",
  role: "believer",
  side: "YES",
  after: { yes: 10, no: 0 },
  answered: null,
  nextIncoming: null,
  outgoing: "none",
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
    capacity: { active: 0, total: 3 },
    audience: aud(),
    ...over,
  }) as SellInput;

const create = (over: Partial<CreateMarketInput> = {}): CreateMarketInput => ({
  action: "create_market",
  role: "market_maker",
  side: null,
  outgoing: "none",
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
    expect(r.challengeModule).toBe("make_room");
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
    expect(resolvePostAction(create()).challengeModule).toBe("organic");
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
        audiences.push({ status, total, singleRecipientName });

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
