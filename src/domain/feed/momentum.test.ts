import { describe, it, expect } from "vitest";
import {
  classifyMomentum,
  momentumReason,
  momentumBar,
  MOMENTUM,
  MOMENTUM_LENSES,
  MOMENTUM_LABELS,
  NO_MOMENTUM,
  type MomentumContext,
} from "./momentum";
import {
  marketChange,
  materialMoves,
  MATERIAL,
  type ChangeNow,
  type ChangeBase,
} from "@/domain/market-change";

const ctx = (o: Partial<MomentumContext> = {}): MomentumContext => ({
  window: "24h",
  believersYes: 0,
  believersNo: 0,
  moneyYesShare: null,
  inactiveForSeconds: null,
  tradedInWindow: false,
  ...o,
});

/**
 * A market whose YES side went from `base` to `now`, with a NO side that DRIFTS.
 *
 * The NO side is not held at a constant dollar figure, and that detail is load
 * bearing. A share is a fixed 0.001 ETH until somebody trades it, so an untraded
 * side's USD price rises with the exchange rate — measured, `chg_24h_yes` is
 * non-zero on all 2,764 rows for exactly this reason. A side pinned to the same
 * dollar figure across a window in which everything else rose is therefore NOT
 * an idle side; it is one somebody traded DOWN by the drift, and the engine
 * correctly reports it as a fall. Holding it constant here would have tested a
 * market that cannot exist and read the engine's correct answer as a bug.
 */
const change = (
  now: { believers: number; capitalUsd: number; priceUsd: number },
  base: { believers: number; capitalUsd: number; priceUsd: number },
  driftPct = 0,
) => {
  const basePrice = 1.9;
  const idle = { believers: 0, capitalUsd: 0, priceUsd: basePrice };
  const n: ChangeNow = { yes: now, no: { ...idle, priceUsd: basePrice * (1 + driftPct / 100) } };
  const b: ChangeBase = { yes: base, no: idle };
  return marketChange(n, b, "24h");
};

describe("the lens bar is reachable, which is the whole trap", () => {
  /**
   * `materialMoves` defaults to MATERIAL — the NEWS bar. A lens declaring a
   * lower threshold and then filtering that output would be filtering a list
   * everything below the higher bar had already been removed from. The bar must
   * travel INTO the derivation.
   *
   * This is the regression guard, and it is the most important test in the file:
   * without it the lens silently becomes the news bar under a different name.
   */
  it("sees a move the news bar rejects", () => {
    // +4% on capital: above MOMENTUM.minPct (3), below MATERIAL.minPct (5).
    const c = change(
      { believers: 2, capitalUsd: 104, priceUsd: 1.9 },
      {
        believers: 2,
        capitalUsd: 100,
        priceUsd: 1.9,
      },
    );
    expect(materialMoves(c)).toHaveLength(0);
    expect(classifyMomentum(c, ctx()).lenses).toContain("moving");
  });

  it("sees a single believer, which the news bar requires three of", () => {
    const c = change(
      { believers: 3, capitalUsd: 100, priceUsd: 1.9 },
      {
        believers: 2,
        capitalUsd: 100,
        priceUsd: 1.9,
      },
    );
    expect(MOMENTUM.minBelieverDelta).toBeLessThan(MATERIAL.minBelieverDelta);
    expect(materialMoves(c).some((m) => m.metric === "believers")).toBe(false);
    expect(classifyMomentum(c, ctx()).lenses).toContain("believers");
  });

  it("keeps the lens bar strictly below the news bar on every axis", () => {
    const bar = momentumBar("24h");
    expect(bar.minPct).toBeLessThan(MATERIAL.minPct);
    expect(bar.minBelieverDelta).toBeLessThan(MATERIAL.minBelieverDelta);
  });
});

describe("the currency is not momentum", () => {
  /**
   * Measured: every market's USD price moved +1.59% over one 24h window,
   * because a share is a fixed 0.001 ETH until someone trades it. A bar that
   * cannot see past that would put the entire platform in "Moving now" on any
   * day ETH moves.
   */
  it("ignores a move the whole cross-section shares", () => {
    const drift = 4;
    // Both sides rose exactly with the currency: nothing happened here.
    const c = change(
      { believers: 1, capitalUsd: 104, priceUsd: 1.976 },
      { believers: 1, capitalUsd: 100, priceUsd: 1.9 },
      drift,
    );
    expect(classifyMomentum(c, ctx(), 0).lenses).toContain("moving");
    expect(classifyMomentum(c, ctx(), drift).lenses).toEqual([]);
    expect(classifyMomentum(c, ctx(), drift).weight).toBe(0);
  });

  it("still sees a market that moved against the drift", () => {
    // Everything drifted +4%; this side fell 10%. Net −14%, unmistakably real.
    const c = change(
      { believers: 1, capitalUsd: 90, priceUsd: 1.71 },
      { believers: 1, capitalUsd: 100, priceUsd: 1.9 },
      4,
    );
    const f = classifyMomentum(c, ctx(), 4);
    expect(f.lenses).toContain("dropping");
    expect(f.top?.direction).toBe("down");
  });

  it("leaves counts alone — a believer is not denominated in anything", () => {
    const c = change(
      { believers: 4, capitalUsd: 100, priceUsd: 1.9 },
      {
        believers: 1,
        capitalUsd: 100,
        priceUsd: 1.9,
      },
    );
    expect(classifyMomentum(c, ctx(), 40).lenses).toContain("believers");
  });
});

describe("the bar is window-aware", () => {
  /**
   * 12 markets gained a believer over 24h; 94 did over 7 days. One threshold
   * cannot mean the same thing over both.
   */
  it("asks for more over a longer window", () => {
    expect(momentumBar("7d").minBelieverDelta).toBeGreaterThan(momentumBar("24h").minBelieverDelta);
    expect(momentumBar("30d").minBelieverDelta).toBeGreaterThanOrEqual(
      momentumBar("7d").minBelieverDelta,
    );
  });

  it("treats an unknown window as the tightest one rather than guessing", () => {
    expect(momentumBar("nonsense").minBelieverDelta).toBe(momentumBar("24h").minBelieverDelta);
  });
});

describe("dust never becomes momentum", () => {
  /**
   * 22% of funded sides hold under a cent, where every trade is thousands of
   * percent. A ratio alone would fill this lens with five-cent moves.
   */
  it("rejects a huge percentage on a trivial amount of money", () => {
    const c = change(
      { believers: 1, capitalUsd: 0.4, priceUsd: 1.9 },
      {
        believers: 1,
        capitalUsd: 0.1,
        priceUsd: 1.9,
      },
    );
    expect(classifyMomentum(c, ctx()).lenses).not.toContain("capital");
  });

  /**
   * The dollar floor belongs to capital only. A price is per-share (~$1.90), so
   * a real price move has a delta of cents — applying the floor to it would
   * delete every price move on the platform.
   */
  it("does not apply the capital floor to a per-share price", () => {
    const c = change(
      { believers: 1, capitalUsd: 100, priceUsd: 2.09 },
      {
        believers: 1,
        capitalUsd: 100,
        priceUsd: 1.9,
      },
    );
    const f = classifyMomentum(c, ctx());
    expect(f.top?.metric).toBe("price");
    expect(Math.abs(f.top!.delta)).toBeLessThan(MOMENTUM.minCapitalUsd);
    expect(f.lenses).toContain("moving");
  });
});

describe("states that are not moves", () => {
  it("calls a market contested when both sides are live and money is balanced", () => {
    const f = classifyMomentum(null, ctx({ believersYes: 3, believersNo: 2, moneyYesShare: 0.55 }));
    expect(f.lenses).toEqual(["contested"]);
  });

  it("does not call a one-sided market contested", () => {
    expect(
      classifyMomentum(null, ctx({ believersYes: 9, believersNo: 0, moneyYesShare: 0.5 })).lenses,
    ).not.toContain("contested");
    expect(
      classifyMomentum(null, ctx({ believersYes: 3, believersNo: 3, moneyYesShare: 0.95 })).lenses,
    ).not.toContain("contested");
  });

  it("calls a long silence broken by a trade 'waking up'", () => {
    const f = classifyMomentum(
      null,
      ctx({ tradedInWindow: true, inactiveForSeconds: (MOMENTUM.quietHours + 1) * 3600 }),
    );
    expect(f.lenses).toContain("waking");
    // The one signal materialMoves cannot see, so it must carry its own weight
    // or a market that broke a three-day silence would rank as if still.
    expect(f.weight).toBeGreaterThan(0);
  });

  it("does not call a market awake because it was quiet", () => {
    expect(
      classifyMomentum(null, ctx({ tradedInWindow: false, inactiveForSeconds: 999_999 })).lenses,
    ).not.toContain("waking");
  });

  it("says nothing about a still market", () => {
    expect(classifyMomentum(null, ctx())).toEqual(NO_MOMENTUM);
  });
});

describe("the reason is specific or it is not printed", () => {
  const reasons = () => {
    const cases = [
      change(
        { believers: 4, capitalUsd: 100, priceUsd: 1.9 },
        { believers: 1, capitalUsd: 100, priceUsd: 1.9 },
      ),
      change(
        { believers: 1, capitalUsd: 160, priceUsd: 1.9 },
        { believers: 1, capitalUsd: 100, priceUsd: 1.9 },
      ),
      change(
        { believers: 1, capitalUsd: 100, priceUsd: 2.3 },
        { believers: 1, capitalUsd: 100, priceUsd: 1.9 },
      ),
      change(
        { believers: 1, capitalUsd: 40, priceUsd: 1.9 },
        { believers: 1, capitalUsd: 100, priceUsd: 1.9 },
      ),
      change(
        { believers: 1, capitalUsd: 25, priceUsd: 1.9 },
        { believers: 0, capitalUsd: 0, priceUsd: 1.9 },
      ),
    ];
    return cases
      .map((c) => classifyMomentum(c, ctx()).top)
      .filter((m) => m != null)
      .map((m) => momentumReason(m!, "24h"));
  };

  it("names the metric, the side, the direction and the size", () => {
    for (const r of reasons()) {
      expect(r).toMatch(/YES|NO|market/);
      expect(r.length).toBeGreaterThan(10);
    }
  });

  it("never uses a vague word the brief forbids", () => {
    const banned = /trending|popular|recommended|you may like|hot right now/i;
    for (const r of reasons()) expect(r).not.toMatch(banned);
  });

  it("says direction in words, not only in a sign", () => {
    const down = change(
      { believers: 1, capitalUsd: 40, priceUsd: 1.9 },
      {
        believers: 1,
        capitalUsd: 100,
        priceUsd: 1.9,
      },
    );
    const top = classifyMomentum(down, ctx()).top!;
    expect(momentumReason(top, "24h")).toMatch(/leaving|down|lost/);
  });

  it("calls first money an arrival, never a percentage", () => {
    const first = change(
      { believers: 1, capitalUsd: 25, priceUsd: 1.9 },
      {
        believers: 0,
        capitalUsd: 0,
        priceUsd: 1.9,
      },
    );
    const top = classifyMomentum(first, ctx()).top!;
    expect(top.kind).toBe("arrival");
    expect(momentumReason(top, "24h")).toMatch(/First/);
    expect(momentumReason(top, "24h")).not.toMatch(/%/);
  });

  it("names the window it is talking about", () => {
    const c = change(
      { believers: 4, capitalUsd: 100, priceUsd: 1.9 },
      {
        believers: 1,
        capitalUsd: 100,
        priceUsd: 1.9,
      },
    );
    const top = classifyMomentum(c, ctx()).top!;
    expect(momentumReason(top, "24h")).toContain("today");
    expect(momentumReason(top, "7d")).toContain("7d");
  });
});

describe("the vocabulary is complete and labelled", () => {
  it("labels every lens", () => {
    for (const l of MOMENTUM_LENSES) expect(MOMENTUM_LABELS[l]?.length).toBeGreaterThan(0);
  });

  it("returns lenses in a stable declared order, not insertion order", () => {
    const c = change(
      { believers: 4, capitalUsd: 160, priceUsd: 2.3 },
      {
        believers: 1,
        capitalUsd: 100,
        priceUsd: 1.9,
      },
    );
    const f = classifyMomentum(c, ctx({ believersYes: 4, believersNo: 2, moneyYesShare: 0.5 }));
    const order = f.lenses.map((l) => MOMENTUM_LENSES.indexOf(l));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
