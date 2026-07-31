import { describe, it, expect } from "vitest";
import {
  composePulse,
  marketState,
  recentActivity,
  activityMetrics,
  pulseInputFromTape,
  type PulseInput,
} from "./pulse";
import type { TapeTrade } from "./conviction-series";

const base: PulseInput = {
  yesBelievers: 0,
  noBelievers: 0,
  yesCapital: 0,
  noCapital: 0,
  periodNewBelievers: 0,
  periodExitedBelievers: 0,
  periodNetCapital: 0,
  periodPriceChange: null,
  selectedPeriod: "24h",
};
const inp = (o: Partial<PulseInput>): PulseInput => ({ ...base, ...o });

describe("marketState", () => {
  it("never calls a 35–1 market divided", () => {
    const s = marketState(
      inp({ yesBelievers: 35, noBelievers: 1, yesCapital: 252.24, noCapital: 2.2 }),
    );
    expect(s.label).toBe("Overwhelming consensus");
    expect(s.explanation).toBe(
      "35 of 36 current believers back the same side, with nearly all capital there too.",
    );
  });

  it("classifies nothing on an empty market", () => {
    expect(marketState(base).label).toBe("No conviction yet");
  });

  it("does not call one believer a consensus", () => {
    expect(marketState(inp({ yesBelievers: 1 })).label).toBe("First conviction");
  });

  it("states the facts for two opposed believers", () => {
    const s = marketState(inp({ yesBelievers: 1, noBelievers: 1 }));
    expect(s.label).toBe("Early split");
    expect(s.explanation).toBe("Two believers have entered, one on each side.");
  });

  it("uses exact counts under 50 believers", () => {
    expect(marketState(inp({ yesBelievers: 4, noBelievers: 1 })).explanation).toContain(
      "4 of 5 current believers",
    );
  });

  it("may use a percentage at 50 believers or more", () => {
    expect(marketState(inp({ yesBelievers: 40, noBelievers: 20 })).explanation).toContain("67%");
  });

  it("names the dimension when only capital is one-sided", () => {
    const s = marketState(inp({ yesBelievers: 5, noBelievers: 5, yesCapital: 900, noCapital: 50 }));
    expect(s.label).toBe("Evenly split");
    expect(s.explanation).toContain("most capital is concentrated on one side");
  });

  it("reports a believer majority whose capital is balanced", () => {
    const s = marketState(inp({ yesBelievers: 8, noBelievers: 2, yesCapital: 100, noCapital: 95 }));
    expect(s.label).toBe("Strong majority");
    expect(s.explanation).toContain("committed capital remains more balanced");
  });

  it("reports a smaller group holding the capital", () => {
    const s = marketState(inp({ yesBelievers: 7, noBelievers: 3, yesCapital: 20, noCapital: 200 }));
    expect(s.label).toBe("Clear lead");
    expect(s.explanation).toContain("smaller group holds most of the capital");
  });

  it("never says divided above a 55% believer share", () => {
    for (const [y, n] of [
      [6, 4],
      [7, 3],
      [9, 1],
      [35, 1],
    ] as const) {
      const s = marketState(inp({ yesBelievers: y, noBelievers: n }));
      expect(s.label.toLowerCase()).not.toMatch(/divided|split|balanced/);
    }
  });
});

describe("recentActivity", () => {
  it("says nothing happened when nothing happened", () => {
    expect(recentActivity(base).label).toBe("Quiet period");
  });

  it("only says grew when both metrics grew", () => {
    expect(recentActivity(inp({ periodNewBelievers: 2, periodNetCapital: 84 })).label).toBe(
      "Conviction grew",
    );
    expect(recentActivity(inp({ periodNewBelievers: 2, periodNetCapital: -40 })).label).toBe(
      "Interest grew, commitment fell",
    );
  });

  it("separates flat participation from capital", () => {
    expect(recentActivity(inp({ periodNetCapital: 84 })).label).toBe("Existing believers added");
    expect(recentActivity(inp({ periodNetCapital: -38 })).label).toBe("Capital pulled back");
  });

  it("reports exits", () => {
    expect(recentActivity(inp({ periodExitedBelievers: 2 })).label).toBe("Participation narrowed");
    expect(recentActivity(inp({ periodExitedBelievers: 2, periodNetCapital: 50 })).label).toBe(
      "Fewer believers, more capital",
    );
  });
});

describe("activityMetrics", () => {
  it("shows believers, money, then price", () => {
    expect(
      activityMetrics(inp({ periodNewBelievers: 1, periodNetCapital: 3, periodPriceChange: -1.5 })),
    ).toBe("+1 believer · +$3 committed · Price −1.5%");
  });

  it("drops noise", () => {
    expect(activityMetrics(inp({ periodPriceChange: 0 }))).toBe("");
  });
});

describe("pulseInputFromTape", () => {
  const now = Date.UTC(2026, 0, 2, 12, 0, 0);
  const t = (o: Partial<TapeTrade>): TapeTrade => ({
    w: "a",
    side: "YES",
    action: "BUY",
    eth: 1,
    price: 0.5,
    t: now - 60_000,
    ...o,
  });

  it("counts current directional believers and side capital", () => {
    const i = pulseInputFromTape(
      [t({ w: "a" }), t({ w: "b", side: "NO", eth: 2 }), t({ w: "c" })],
      "24h",
      now,
      10,
    );
    expect(i.yesBelievers).toBe(2);
    expect(i.noBelievers).toBe(1);
    expect(i.yesCapital).toBe(20);
    expect(i.noCapital).toBe(20);
    expect(i.periodNewBelievers).toBe(3);
  });

  it("does not count a window-external entrant as new", () => {
    const i = pulseInputFromTape([t({ t: now - 5 * 86_400_000 })], "24h", now, 10);
    expect(i.yesBelievers).toBe(1);
    expect(i.periodNewBelievers).toBe(0);
  });

  it("counts a full exit", () => {
    const i = pulseInputFromTape([t({}), t({ action: "SELL" })], "24h", now, 10);
    expect(i.yesBelievers).toBe(0);
    expect(i.periodExitedBelievers).toBe(1);
    expect(i.periodNetCapital).toBe(0);
  });
});

describe("composePulse", () => {
  it("renders the two questions separately", () => {
    const p = composePulse(
      inp({
        yesBelievers: 35,
        noBelievers: 1,
        yesCapital: 252.24,
        noCapital: 2.2,
        periodNewBelievers: 1,
        periodNetCapital: 3,
        periodPriceChange: -1.5,
      }),
    );
    expect(p).toMatchObject({
      periodShort: "1D",
      stateLabel: "Overwhelming consensus",
      activityLabel: "Conviction grew",
      activityMetrics: "+1 believer · +$3 committed · Price −1.5%",
    });
  });
});
