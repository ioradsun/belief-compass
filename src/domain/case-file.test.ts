import { describe, expect, it } from "vitest";
import {
  GROUP_LABEL,
  believerGroup,
  heldFor,
  rankBelievers,
  sideCaseSummary,
  type RankableBeliever,
} from "@/domain/case-file";
import type { TapeTrade } from "@/domain/conviction-series";

const now = 1_000_000_000_000;
const hour = 3_600_000;
const day = 86_400_000;

const buy = (w: string, side: "YES" | "NO", eth: number, price: number, t: number): TapeTrade => ({
  w,
  side,
  action: "BUY",
  eth,
  price,
  t,
});

describe("sideCaseSummary", () => {
  it("returns null when the side has no trades", () => {
    expect(sideCaseSummary([buy("a", "NO", 1, 1, now)], "YES", "24h", now)).toBeNull();
  });

  it("reports totals now with % change measured over the window", () => {
    const tape = [
      // Before the 24h window: 1 believer, 1 ETH, price 1.0.
      buy("a", "YES", 1, 1.0, now - 3 * day),
      // Inside the window: +1 believer, +1 ETH, price → 1.5.
      buy("b", "YES", 1, 1.5, now - 2 * hour),
    ];
    const s = sideCaseSummary(tape, "YES", "24h", now)!;
    expect(s.believers).toBe(2); // cumulative total now
    expect(s.believersPct).toBe(100); // 1 → 2 over the window
    expect(s.capitalEth).toBeCloseTo(2);
    expect(s.capitalPct).toBe(100); // 1 → 2 ETH
    expect(s.priceEth).toBeCloseTo(1.5);
    expect(s.pricePct).toBeCloseTo(50); // 1.0 → 1.5
    expect(s.headline).toBeTruthy();
  });

  it("measures a shorter window against a nearer baseline", () => {
    const tape = [
      buy("a", "YES", 1, 1, now - 2 * day),
      buy("b", "YES", 1, 1, now - 2 * hour), // inside 24h, outside 1h
    ];
    const oneDay = sideCaseSummary(tape, "YES", "24h", now)!;
    const oneHour = sideCaseSummary(tape, "YES", "1h", now)!;
    expect(oneDay.believersPct).toBe(100); // 1 → 2 today
    expect(oneHour.believersPct).toBe(0); // nothing new in the last hour
    expect(oneHour.believers).toBe(2); // but the total is unchanged
  });
});

describe("believerGroup", () => {
  it("maps a viewer relationship to its case label", () => {
    expect(believerGroup("twin", false)).toBe("twin");
    expect(believerGroup("opp", false)).toBe("rival");
    expect(believerGroup("inverse", false)).toBe("inverse");
    expect(believerGroup("neutral", false)).toBe("match");
  });

  it("falls back to whale then plain believer with no relationship", () => {
    expect(believerGroup(null, true)).toBe("whale");
    expect(believerGroup(null, false)).toBe("believer");
    expect(believerGroup(undefined, false)).toBe("believer");
  });

  it("has a label for every group", () => {
    for (const g of Object.keys(GROUP_LABEL)) expect(GROUP_LABEL[g as never]).toBeTruthy();
  });
});

describe("rankBelievers", () => {
  const mk = (wallet: string, valueUsd: number, whale = false, daysHeld = 0): RankableBeliever => ({
    wallet,
    conviction: valueUsd,
    valueUsd,
    daysHeld,
    whale,
  });

  it("puts your people first, then big money, then the rest", () => {
    const people = [mk("plain", 999), mk("whale", 500, true), mk("tribe", 10)];
    const rel = (w: string) => (w === "tribe" ? "tribe" : null);
    const ranked = rankBelievers(people, rel);
    expect(ranked.map((r) => r.group)).toEqual(["tribe", "whale", "believer"]);
  });

  it("breaks ties on stake within the same group", () => {
    const ranked = rankBelievers([mk("a", 5), mk("b", 50)], () => null);
    expect(ranked[0].believer.wallet).toBe("b");
  });
});

describe("heldFor", () => {
  it("reads as a human holding duration", () => {
    expect(heldFor(0)).toBe("new today");
    expect(heldFor(1)).toBe("held 1 day");
    expect(heldFor(9)).toBe("held 9 days");
    expect(heldFor(45)).toBe("held 1 month");
    expect(heldFor(120)).toBe("held 4 months");
    expect(heldFor(400)).toBe("held 1 year");
  });
});
