import { describe, it, expect } from "vitest";
import {
  POST_ACTION_BANNED,
  challengeLabel,
  realizedLine,
  resolvePostAction,
  type PostActionInput,
} from "./post-action";

const base = (over: Partial<PostActionInput> = {}): PostActionInput => ({
  action: "first_buy",
  role: "believer",
  side: "YES",
  before: { yes: 0, no: 0 },
  after: { yes: 10, no: 0 },
  afterKnown: true,
  answeredCallers: 0,
  primaryCallerName: null,
  outgoing: "none",
  capacity: { active: 0, total: 3 },
  audience: { status: "available", total: 13 },
  nextIncoming: null,
  realizedGainUsd: null,
  proceedsUsd: null,
  remainingValueUsd: null,
  ...over,
});

/**
 * §21's hierarchy, which is the spine of the whole screen: exactly one next
 * action, chosen in a fixed order, never rendered disabled.
 */
describe("one next action, in one order", () => {
  it("offers the chain first when there is room and an audience", () => {
    expect(resolvePostAction(base()).primary).toEqual({
      kind: "challenge",
      label: "Challenge all 13",
    });
  });

  it("offers Make room when the audience exists but the table is full", () => {
    const r = resolvePostAction(base({ capacity: { active: 3, total: 3 } }));
    expect(r.primary.kind).toBe("make_room");
    expect(r.challengeModule).toBe("make_room");
  });

  it("points at a waiting person before a generic next question", () => {
    const r = resolvePostAction(
      base({ audience: { status: "none", total: 0 }, nextIncoming: { name: "John" } }),
    );
    expect(r.primary).toEqual({ kind: "answer", label: "Answer John" });
  });

  it("falls back to Next Question, with no second CTA to repeat it", () => {
    const r = resolvePostAction(base({ audience: { status: "none", total: 0 } }));
    expect(r.primary.kind).toBe("next_question");
    expect(r.secondary).toBeNull();
  });

  it("never offers a Challenge while one is already live on this market", () => {
    // A second Challenge for the same market is not a thing anybody has.
    const r = resolvePostAction(base({ outgoing: "live" }));
    expect(r.primary.kind).not.toBe("challenge");
    expect(r.challengeModule).toBeNull();
  });
});

/**
 * UNKNOWN IS NOT ZERO — §2.11, and the failure this codebase keeps paying for.
 */
describe("a read that failed is not an empty network", () => {
  it("hides the module on a failed audience rather than saying nobody qualifies", () => {
    const r = resolvePostAction(base({ audience: { status: "failed", total: 0 } }));
    expect(r.challengeModule).toBeNull();
    expect(`${r.headline} ${r.support ?? ""}`.toLowerCase()).not.toContain("nobody");
  });

  it("hides it while loading, so the personal story paints first", () => {
    expect(
      resolvePostAction(base({ audience: { status: "loading", total: 0 } })).challengeModule,
    ).toBeNull();
  });
});

describe("what the buy screen leads with", () => {
  it("puts an answered call above every personal fact", () => {
    const r = resolvePostAction(base({ answeredCallers: 1, primaryCallerName: "Maya" }));
    expect(r.headline).toBe("You showed up for Maya.");
    expect(r.copyCategory).toBe("reciprocity");
    expect(r.consequence).not.toBe("reveal");
  });

  it("counts callers rather than listing them past one", () => {
    expect(resolvePostAction(base({ answeredCallers: 3 })).headline).toBe(
      "You showed up for 3 people.",
    );
  });

  it("says the SAME headline whichever side the reader took", () => {
    // The invariant the whole product rests on. A Rival who turns up turned up.
    const yes = resolvePostAction(
      base({ answeredCallers: 1, primaryCallerName: "Maya", side: "YES" }),
    );
    const no = resolvePostAction(
      base({ answeredCallers: 1, primaryCallerName: "Maya", side: "NO" }),
    );
    expect(yes.headline).toBe(no.headline);
    expect(yes.copyCategory).toBe(no.copyCategory);
    // Only the support sentence carries the side.
    expect(yes.support).toBe("You backed YES.");
    expect(no.support).toBe("You backed NO.");
  });

  it("says the branch is already live rather than offering a second one", () => {
    const r = resolvePostAction(
      base({ answeredCallers: 1, primaryCallerName: "Maya", outgoing: "live" }),
    );
    expect(r.consequence).toBe("branch_live");
    expect(r.challengeModule).toBeNull();
  });

  it("hands an organic first buy back to the personal reveal", () => {
    const r = resolvePostAction(base());
    expect(r.consequence).toBe("reveal");
    expect(r.copyCategory).toBe("first_or_early");
  });

  it("keeps a creator a Market Maker even when they back their own question", () => {
    const r = resolvePostAction(base({ role: "market_maker_and_believer" }));
    expect(r.copyCategory).toBe("market_maker");
    expect(r.headline).toMatch(/made the question/i);
  });
});

/**
 * §6.I / §6.J — the one place this screen could invent a change of mind.
 */
describe("holding both sides is not a change of mind", () => {
  it("states the addition and refuses to call it a flip", () => {
    const r = resolvePostAction(
      base({ action: "buy_opposite_side", side: "NO", after: { yes: 10, no: 5 } }),
    );
    expect(r.headline).toBe("You added NO.");
    expect(r.support).toBe("You now hold both sides.");
    expect(`${r.headline} ${r.support}`.toLowerCase()).not.toMatch(/flip|changed your mind/);
  });

  it("keeps the copy neutral, never 'who stands with you'", () => {
    const r = resolvePostAction(
      base({ action: "buy_opposite_side", side: "NO", after: { yes: 10, no: 5 } }),
    );
    expect(r.copyCategory).toBe("general");
  });
});

describe("a sell never leaves the market, and never guesses", () => {
  const sell = (over: Partial<PostActionInput> = {}) =>
    resolvePostAction(base({ action: "partial_sell", after: { yes: 4, no: 0 }, ...over }));

  it("stays put and never offers Next Question", () => {
    for (const action of ["partial_sell", "side_exit", "market_exit"] as const) {
      const r = resolvePostAction(
        base({ action, after: action === "market_exit" ? { yes: 0, no: 0 } : { yes: 4, no: 0 } }),
      );
      expect(r.stayOnMarket, action).toBe(true);
      expect(r.primary.kind, action).not.toBe("next_question");
      expect(r.secondary?.kind ?? "", action).not.toBe("next_question");
    }
  });

  it("refuses to characterise a sale it cannot see the result of", () => {
    const r = sell({ afterKnown: false });
    expect(r.headline).toBe("Sale confirmed.");
    expect(r.support).toBe("Your position is updating.");
    // No claim either way, and no social offer on top of an unknown.
    expect(`${r.headline} ${r.support}`.toLowerCase()).not.toMatch(
      /out|took some off|still backing/,
    );
    expect(r.challengeModule).toBeNull();
  });

  it("says what is left, with a value only when it has one", () => {
    expect(sell({ remainingValueUsd: 41.2 }).support).toBe("Still backing YES with $41.20.");
    expect(sell({ remainingValueUsd: null }).support).toBe("Still backing YES.");
  });

  it("does not say 'you're out' to somebody who still holds the other side", () => {
    const r = resolvePostAction(
      base({ action: "side_exit", side: "YES", after: { yes: 0, no: 7 } }),
    );
    expect(r.headline).toBe("You left YES.");
    expect(r.support).toMatch(/Still backing NO/);
  });

  it("offers an ordinary believer no new Challenge after a full exit", () => {
    const r = resolvePostAction(
      base({ action: "market_exit", side: "YES", after: { yes: 0, no: 0 } }),
    );
    expect(r.headline).toBe("You're out.");
    expect(r.challengeModule).toBeNull();
    expect(r.primary.kind).toBe("back_to_market");
  });

  it("lets a Market Maker keep asking after their own exit", () => {
    // They are asking people to answer their QUESTION, not to copy a position.
    const r = resolvePostAction(
      base({ action: "market_exit", role: "market_maker", side: "YES", after: { yes: 0, no: 0 } }),
    );
    expect(r.headline).toBe("Your position is closed.");
    expect(r.support).toBe("Your question is still alive.");
    expect(r.primary.kind).toBe("challenge");
  });

  it("keeps a live Challenge visible instead of silently dropping it", () => {
    const r = resolvePostAction(
      base({ action: "market_exit", after: { yes: 0, no: 0 }, outgoing: "live" }),
    );
    expect(r.consequence).toBe("challenge_live");
  });
});

describe("money says only what the canonical numbers prove", () => {
  it("calls proceeds returned, never profit", () => {
    const r = resolvePostAction(
      base({ action: "market_exit", side: "YES", after: { yes: 0, no: 0 }, proceedsUsd: 18.42 }),
    );
    expect(r.support).toBe("Closed YES. $18.42 returned.");
    expect((r.support ?? "").toLowerCase()).not.toContain("profit");
  });

  it("states a realised gain only when there is one", () => {
    expect(realizedLine(null)).toBeNull();
    expect(realizedLine(0)).toBeNull();
    expect(realizedLine(4.2)).toBe("+$4.20 realized");
    expect(realizedLine(-4.2)).toBe("−$4.20 realized");
  });
});

describe("the create screen", () => {
  it("leads with the market and ends at View Market", () => {
    const r = resolvePostAction(
      base({ action: "create_market", role: "market_maker", side: null }),
    );
    expect(r.headline).toBe("Your market is live.");
    expect(r.copyCategory).toBe("market_maker");
    expect(r.secondary).toEqual({ kind: "view_market", label: "View Market" });
  });

  it("never calls a creator's own Challenge a relay — nobody brought them in", () => {
    const r = resolvePostAction(
      base({ action: "create_market", role: "market_maker", side: null, answeredCallers: 2 }),
    );
    expect(r.challengeModule).toBe("organic");
  });

  it("goes to View Market rather than Next Question with no audience", () => {
    const r = resolvePostAction(
      base({
        action: "create_market",
        role: "market_maker",
        audience: { status: "none", total: 0 },
      }),
    );
    expect(r.primary.kind).toBe("view_market");
  });
});

describe("the CTA reads like a person wrote it", () => {
  it("names one person, counts many, and never says 'all 2'", () => {
    expect(challengeLabel(1, "Maya")).toBe("Challenge Maya");
    expect(challengeLabel(2)).toBe("Challenge both");
    expect(challengeLabel(13)).toBe("Challenge all 13");
  });
});

describe("the words this screen may never say", () => {
  /** Every branch the resolver can reach, so the guard is not vacuous. */
  const everything = () => {
    const out: string[] = [];
    const actions = [
      "create_market",
      "first_buy",
      "buy_more",
      "buy_opposite_side",
      "partial_sell",
      "side_exit",
      "market_exit",
    ] as const;
    for (const action of actions)
      for (const role of ["market_maker", "believer", "market_maker_and_believer"] as const)
        for (const status of ["loading", "available", "none", "failed"] as const)
          for (const active of [0, 3])
            for (const answeredCallers of [0, 1, 3])
              for (const afterKnown of [true, false])
                for (const after of [
                  { yes: 0, no: 0 },
                  { yes: 4, no: 0 },
                  { yes: 4, no: 2 },
                ]) {
                  const r = resolvePostAction(
                    base({
                      action,
                      role,
                      after,
                      afterKnown,
                      answeredCallers,
                      primaryCallerName: "Maya",
                      capacity: { active, total: 3 },
                      audience: { status, total: status === "available" ? 13 : 0 },
                      proceedsUsd: 18.42,
                      remainingValueUsd: 41.2,
                    }),
                  );
                  out.push(r.headline, r.support ?? "", r.primary.label, r.secondary?.label ?? "");
                }
    return out.filter(Boolean);
  };

  it("emits a real corpus, so this guard is not vacuously passing", () => {
    expect(new Set(everything()).size).toBeGreaterThan(10);
  });

  it("never uses a banned word in any branch", () => {
    for (const s of everything())
      for (const w of POST_ACTION_BANNED)
        expect(s.toLowerCase(), `"${s}" contains "${w}"`).not.toContain(w);
  });

  it("never promises a relationship transition it cannot prove", () => {
    // "Two answers away from your Tribe" is a counterfactual nothing can compute.
    for (const s of everything())
      expect(s.toLowerCase()).not.toMatch(/away from your tribe|become a rival|add them to your/);
  });

  it("always returns exactly one primary action, and at most one module", () => {
    for (const action of ["first_buy", "partial_sell", "market_exit", "create_market"] as const) {
      const r = resolvePostAction(base({ action }));
      expect(r.primary.label.length).toBeGreaterThan(0);
      expect(r.primary.kind).not.toBe(r.secondary?.kind);
    }
  });

  it("keeps every headline inside the length budget", () => {
    for (const s of everything()) expect(s.split(/\s+/).length).toBeLessThanOrEqual(18);
  });
});
