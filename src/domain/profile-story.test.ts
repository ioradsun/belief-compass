import { describe, expect, it } from "vitest";
import {
  usAct,
  nextAct,
  themAct,
  receipts,
  DENSITY,
  RECEIPTS,
  type ThemPosition,
} from "./profile-story";

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

describe("THE RECEIPTS — the proof under the headline", () => {
  const r = (id: number, v: "YES" | "NO", p: "YES" | "NO", domain: string | null = null) => ({
    marketId: id,
    title: `Market ${id}`,
    viewerSide: v,
    personSide: p,
    domain,
  });

  it("says nothing when the count in the hero already said it", () => {
    expect(receipts([r(1, "YES", "YES")]).rows).toEqual([]);
  });

  it("closes an all-aligned list with the pattern, not a verdict", () => {
    const out = receipts([r(1, "YES", "YES"), r(2, "NO", "NO"), r(3, "YES", "YES")]);
    expect(out.allAligned).toBe(true);
    expect(out.footer).toBe("Together on all 3");
    expect(out.rows.every((x) => x.agree)).toBe(true);
  });

  it("leads with the row that explains the percentage", () => {
    const out = receipts([r(1, "YES", "YES"), r(2, "YES", "NO"), r(3, "NO", "NO")]);
    expect(out.rows.map((x) => x.marketId)).toEqual([2, 1, 3]);
    expect(out.footer).toBe("Together on 2 of 3");
  });

  it("caps the visible rows and keeps the rest countable", () => {
    const many = Array.from({ length: 11 }, (_, i) => r(i + 1, "YES", "YES"));
    const out = receipts(many);
    expect(out.rows).toHaveLength(RECEIPTS.preview);
    expect(out.hidden).toBe(11 - RECEIPTS.preview);
  });

  it("does not group a short shared record", () => {
    const out = receipts([
      r(1, "YES", "YES", "Crypto"),
      r(2, "YES", "YES", "Crypto"),
      r(3, "NO", "NO", "Culture"),
    ]);
    expect(out.groups).toEqual([]);
  });

  it("groups by domain once there is enough to navigate", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => r(i + 1, "YES", "YES", "Crypto")),
      r(7, "YES", "NO", "Culture"),
      r(8, "NO", "YES", "Culture"),
    ];
    const out = receipts(rows);
    expect(out.groups.map((g) => [g.domain, g.together, g.total])).toEqual([
      ["Crypto", 6, 6],
      ["Culture", 0, 2],
    ]);
  });
});
