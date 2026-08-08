import { describe, expect, it } from "vitest";
import { usAct, nextAct, themAct, DENSITY, type ThemPosition } from "./profile-story";

const pos = (o: Partial<ThemPosition> & { marketId: number }): ThemPosition => ({
  title: `Market ${o.marketId}`,
  side: "YES",
  valueUsd: 0,
  daysHeld: 0,
  tenureIsFloor: false,
  category: null,
  ...o,
});

describe("US — what are we", () => {
  it("says nothing at all when the two have never met", () => {
    expect(usAct({ shared: 0, together: 0, apart: 0 })).toBeNull();
  });

  it("states the arithmetic and one plain sentence over a single market", () => {
    const us = usAct({ shared: 1, together: 1, apart: 0, alignedTopics: ["Entertainment"] })!;
    expect(us.matchPct).toBe(100);
    expect(us.evidence).toBe("1 of 1 together");
    expect(us.sentence).toBe("You both backed the same side on Entertainment.");
    expect(us.thin).toBe(true);
  });

  it("never invents an insight out of thin evidence", () => {
    const us = usAct({ shared: 3, together: 2, apart: 1 })!;
    expect(us.sentence).toBeNull();
    expect(us.evidence).toBe("2 of 3 together");
  });

  it("stops calling the record thin once it is long enough to mean something", () => {
    expect(usAct({ shared: 12, together: 10, apart: 2 })!.thin).toBe(false);
  });

  it("reports opposition as plainly as agreement", () => {
    expect(usAct({ shared: 1, together: 0, apart: 1 })!.sentence).toBe(
      "You landed on opposite sides once.",
    );
  });
});

describe("NEXT — what could we do now", () => {
  const join = { marketId: 5, title: "Will Bitcoin hit $150K this year?", side: "YES" as const };

  it("disappears entirely when there is nothing to do", () => {
    expect(nextAct({ name: "cryptsam" })).toBeNull();
    expect(nextAct({ name: "cryptsam", joinCandidate: null, callFromThem: null })).toBeNull();
  });

  it("invites you into a market they hold", () => {
    const a = nextAct({ name: "cryptsam", joinCandidate: join })!;
    expect(a.kind).toBe("join");
    expect(a.detail).toBe("cryptsam believes YES");
    expect(a.cta).toBe("Take a look →");
  });

  it("puts an outstanding call above a position", () => {
    const a = nextAct({
      name: "cryptsam",
      joinCandidate: join,
      callFromThem: { marketId: 9, title: "Will ETH flip BTC?", side: "NO" },
    })!;
    expect(a.kind).toBe("call");
    expect(a.marketId).toBe(9);
    expect(a.cta).toBe("Answer the call →");
  });

  it("does not claim a side for a question they only wrote", () => {
    const a = nextAct({
      name: "cryptsam",
      callFromThem: { marketId: 9, title: "Will ETH flip BTC?", side: null },
    })!;
    expect(a.detail).toBe("cryptsam opened this question");
  });
});

describe("THEM — one section, adapting to density", () => {
  it("does not build a taxonomy over one conviction", () => {
    const t = themAct([pos({ marketId: 1 })], { medianDays: 14 });
    expect(t.grouped).toBe(false);
    expect(t.summary).toBe("1 conviction · typically held 14 days");
    expect(t.hidden).toBe(0);
  });

  it("groups only once there is something to navigate", () => {
    const many = Array.from({ length: DENSITY.groupAt }, (_, i) => pos({ marketId: i + 1 }));
    expect(themAct(many).grouped).toBe(true);
    expect(themAct(many.slice(0, DENSITY.groupAt - 1)).grouped).toBe(false);
  });

  it("leads with the strongest commitment", () => {
    const t = themAct([
      pos({ marketId: 1, valueUsd: 2 }),
      pos({ marketId: 2, valueUsd: 40 }),
      pos({ marketId: 3, valueUsd: 40, daysHeld: 90 }),
    ]);
    expect(t.rows.map((r) => r.marketId)).toEqual([3, 2, 1]);
  });

  it("omits the tenure clause rather than printing a zero", () => {
    expect(themAct([pos({ marketId: 1 })], { medianDays: 0 }).summary).toBe("1 conviction");
    expect(themAct([pos({ marketId: 1 })], { medianDays: null }).summary).toBe("1 conviction");
  });

  it("keeps the count honest when only a page of rows was loaded", () => {
    expect(themAct([pos({ marketId: 1 })], { total: 37 }).summary).toBe("37 convictions");
  });
});

describe("the non-repetition invariant", () => {
  it("does not repeat the invited market inside a list short enough to read whole", () => {
    const t = themAct([pos({ marketId: 1 }), pos({ marketId: 2 })], { excludeMarketId: 2 });
    expect(t.rows.map((r) => r.marketId)).toEqual([1]);
  });

  it("keeps the inventory complete once the list is long", () => {
    const many = Array.from({ length: 20 }, (_, i) => pos({ marketId: i + 1 }));
    const t = themAct(many, { excludeMarketId: 2 });
    expect(t.rows).toHaveLength(20);
  });
});
