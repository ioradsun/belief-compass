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
import { marketBook } from "@/domain/market-book";
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

  it("reports totals now with the window-open base beside them", () => {
    const tape = [
      // Before the 24h window: 1 believer, 1 ETH, price 1.0.
      buy("a", "YES", 1, 1.0, now - 3 * day),
      // Inside the window: +1 believer, +1 ETH, price → 1.5.
      buy("b", "YES", 1, 1.5, now - 2 * hour),
    ];
    const s = sideCaseSummary(tape, "YES", "24h", now)!;
    expect(s.believers).toBe(2); // cumulative total now
    expect(s.believersBase).toBe(1); // 1 → 2 over the window
    expect(s.capitalEth).toBeCloseTo(2);
    expect(s.capitalBaseEth).toBeCloseTo(1); // 1 → 2 ETH
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
    expect(oneDay.believersBase).toBe(1); // 1 → 2 today
    expect(oneHour.believersBase).toBe(2); // nothing new in the last hour
    expect(oneHour.believers).toBe(2); // but the total is unchanged
  });

  const sell = (w: string, side: "YES" | "NO", eth: number, price: number, t: number): TapeTrade => ({
    w,
    side,
    action: "SELL",
    eth,
    price,
    t,
  });

  it("shows believers LEAVING — the number, the %, and the series all decline together", () => {
    // Two believers enter before the window; one fully exits inside it. The old
    // cumulative-buyers series could never draw this; net-directional must.
    const tape = [
      buy("a", "YES", 1, 1, now - 3 * day),
      buy("b", "YES", 1, 1, now - 2 * day),
      sell("b", "YES", 1, 1, now - 2 * hour), // b exits inside the 24h window
    ];
    const s = sideCaseSummary(tape, "YES", "24h", now)!;
    expect(s.believers).toBe(1); // b is gone
    expect(s.believersBase).toBe(2); // 2 → 1 over the window
    // The drawn series ends at the lower value — a real decline, not a flat line.
    expect(s.series[s.series.length - 1].believers).toBe(1);
    expect(s.series[0].believers).toBe(2); // window opened with 2
  });

  it("excludes a wallet holding BOTH sides from the side's believer count (mixed)", () => {
    const tape = [
      buy("a", "YES", 2, 1, now - 2 * hour), // pure YES believer
      buy("c", "YES", 1, 1, now - 90 * 60_000), // c starts YES…
      buy("c", "NO", 1, 1, now - 60 * 60_000), // …then also NO → mixed, counts for neither
    ];
    const s = sideCaseSummary(tape, "YES", "24h", now)!;
    expect(s.believers).toBe(1); // only a; c is mixed
  });

  it("reconciles exactly with the canonical marketBook (chart == headline source)", () => {
    const tape = [
      buy("a", "YES", 3, 1, now - 3 * day),
      buy("b", "YES", 2, 1.2, now - 2 * hour),
      buy("d", "NO", 1, 1, now - hour),
    ];
    const s = sideCaseSummary(tape, "YES", "24h", now)!;
    const bk = marketBook(tape, now, "24h");
    expect(s.believers).toBe(bk.believers.yes.current);
    expect(s.capitalEth).toBeCloseTo(bk.capitalEth.yes.current);
    // The last series point equals the headline current — first/last/current agree.
    expect(s.series[s.series.length - 1].believers).toBe(bk.believers.yes.current);
    expect(s.series[s.series.length - 1].capital).toBeCloseTo(bk.capitalEth.yes.current);
  });

  it("switching timeframe changes only the window, never the metric definition", () => {
    const tape = [
      buy("a", "YES", 1, 1, now - 10 * day),
      buy("b", "YES", 1, 1, now - 5 * day),
      buy("c", "YES", 1, 1, now - 30 * 60_000), // inside 1h
    ];
    const all = sideCaseSummary(tape, "YES", "all", now)!;
    const oneHour = sideCaseSummary(tape, "YES", "1h", now)!;
    // Same current total regardless of window (definition is timeframe-invariant).
    expect(all.believers).toBe(3);
    expect(oneHour.believers).toBe(3);
    // Only the base differs. Since-open opened with nobody — an origin, which
    // `gain` refuses to express as a rate; the hour opened with 2.
    expect(all.believersBase).toBe(0);
    expect(oneHour.believersBase).toBe(2);
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
