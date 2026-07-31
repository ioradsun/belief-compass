import { describe, expect, it } from "vitest";
import {
  RELATIONSHIP_LABEL,
  STATUS_LABEL,
  believerStatus,
  caseRelationship,
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

describe("caseRelationship", () => {
  it("maps the network label to the one relationship badge", () => {
    expect(caseRelationship("twin")).toBe("twin");
    expect(caseRelationship("tribe")).toBe("tribe");
    expect(caseRelationship("opp")).toBe("rival");
    expect(caseRelationship("inverse")).toBe("inverse");
  });

  it("is Unmapped when there is no known relationship", () => {
    expect(caseRelationship("neutral")).toBe("unmapped");
    expect(caseRelationship(null)).toBe("unmapped");
    expect(caseRelationship(undefined)).toBe("unmapped");
  });

  it("labels every relationship", () => {
    for (const r of Object.keys(RELATIONSHIP_LABEL))
      expect(RELATIONSHIP_LABEL[r as never]).toBeTruthy();
  });
});

describe("believerStatus", () => {
  it("is a single optional note, money before time before newness", () => {
    expect(believerStatus(200, true)).toBe("whale");
    expect(believerStatus(45, false)).toBe("long_term");
    expect(believerStatus(0, false)).toBe("new");
    expect(believerStatus(10, false)).toBeNull();
  });

  it("labels every status", () => {
    for (const s of Object.keys(STATUS_LABEL)) expect(STATUS_LABEL[s as never]).toBeTruthy();
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

  it("puts your ties first, then big money, then the rest — with one status", () => {
    const people = [mk("plain", 999), mk("whale", 500, true, 40), mk("tribe", 10)];
    const rel = (w: string) => (w === "tribe" ? "tribe" : null);
    const ranked = rankBelievers(people, rel);
    expect(ranked.map((r) => r.relationship)).toEqual(["tribe", "unmapped", "unmapped"]);
    expect(ranked[1].believer.wallet).toBe("whale"); // money outranks a plain holder
    expect(ranked[1].status).toBe("whale");
  });

  it("breaks ties on stake within the same relationship", () => {
    const ranked = rankBelievers([mk("a", 5), mk("b", 50)], () => null);
    expect(ranked[0].believer.wallet).toBe("b");
  });
});

describe("heldFor", () => {
  it("reads as a human holding duration", () => {
    expect(heldFor(0)).toBe("New today");
    expect(heldFor(1)).toBe("Held 1 day");
    expect(heldFor(9)).toBe("Held 9 days");
    expect(heldFor(45)).toBe("Held 1 month");
    expect(heldFor(120)).toBe("Held 4 months");
    expect(heldFor(400)).toBe("Held 1 year");
  });
});
