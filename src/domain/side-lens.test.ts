import { describe, it, expect } from "vitest";
import {
  LENS_META,
  LENS_ORDER,
  lensValue,
  lensFacts,
  lensStory,
  lensColdStart,
  lensMarkers,
  type LensMetric,
} from "./side-lens";
import type { SeriesPoint } from "./conviction-series";

/** A minimal series point; only the fields a lens reads need to be real. */
const pt = (o: Partial<SeriesPoint>): SeriesPoint => ({
  t: 0,
  believers: 0,
  capital: 0,
  price: null,
  believersPct: 0,
  capitalPct: 0,
  pricePct: null,
  ...o,
});

// ETH → "USD" for tests: 1 ETH = $10 keeps the numbers legible.
const money = (eth: number) => `$${Math.round(eth * 10)}`;

describe("lens metadata", () => {
  it("orders the lenses People → Money → Price", () => {
    expect(LENS_ORDER).toEqual(["believers", "capital", "price"]);
  });
  it("draws believers/capital as steps and price as a line", () => {
    expect(LENS_META.believers.kind).toBe("step");
    expect(LENS_META.capital.kind).toBe("step");
    expect(LENS_META.price.kind).toBe("line");
  });
  it("every lens has an explicit title", () => {
    for (const m of LENS_ORDER) expect(LENS_META[m as LensMetric].title).toMatch(/Trend$/);
  });
});

describe("lensValue keeps metrics independent", () => {
  const p = pt({ believers: 9, capital: 4.2, price: 0.7 });
  it("reads only the selected metric", () => {
    expect(lensValue(p, "believers")).toBe(9);
    expect(lensValue(p, "capital")).toBe(4.2);
    expect(lensValue(p, "price")).toBe(0.7);
  });
  it("returns null when price is absent", () => {
    expect(lensValue(pt({ believers: 3 }), "price")).toBeNull();
  });
});

describe("lensStory — believers", () => {
  const facts = (believerDelta: number) => lensFacts([pt({}), pt({ believers: believerDelta })]);
  it("counts new believers", () => {
    expect(lensStory("believers", "YES", facts(2), "today", money)).toBe(
      "2 believers joined YES today.",
    );
  });
  it("reads a single believer in the singular", () => {
    expect(lensStory("believers", "YES", facts(1), "today", money)).toBe(
      "One new believer backed YES today.",
    );
  });
  it("says so plainly when no one joined", () => {
    expect(lensStory("believers", "NO", facts(0), "today", money)).toBe(
      "No new believers backed NO today.",
    );
  });
});

describe("lensStory — capital", () => {
  it("money entering the side", () => {
    const f = lensFacts([pt({ capital: 0 }), pt({ capital: 8.2 })]);
    expect(lensStory("capital", "YES", f, "today", money)).toBe("$82 entered YES today.");
  });
  it("money leaving the side across several exits", () => {
    // Two equal exits (−2, −2): outflow is spread, so it's a plain drain, not
    // "one large exit". Net −4 ETH → $40 left.
    const f = lensFacts([pt({ capital: 10 }), pt({ capital: 8 }), pt({ capital: 6 })]);
    expect(lensStory("capital", "YES", f, "today", money)).toBe("$40 left YES today.");
  });
  it("calls out a single dominant exit", () => {
    // 10 → 2 in one step is the whole outflow: one large exit.
    const f = lensFacts([pt({ capital: 10 }), pt({ capital: 2 })]);
    expect(lensStory("capital", "YES", f, "today", money)).toBe(
      "Most capital left YES in one large exit.",
    );
  });
  it("reads steady when nothing moved", () => {
    const f = lensFacts([pt({ capital: 5 }), pt({ capital: 5 })]);
    expect(lensStory("capital", "NO", f, "this week", money)).toBe(
      "Capital in NO held steady this week.",
    );
  });
});

describe("lensStory — price", () => {
  it("climbed on a rise", () => {
    const f = lensFacts([pt({ price: 0.4, pricePct: 0 }), pt({ price: 0.6, pricePct: 50 })]);
    expect(lensStory("price", "YES", f, "today", money)).toBe("YES share price climbed today.");
  });
  it("weakened on a fall", () => {
    const f = lensFacts([pt({ price: 0.6, pricePct: 0 }), pt({ price: 0.4, pricePct: -33 })]);
    expect(lensStory("price", "YES", f, "today", money)).toBe("YES share price weakened today.");
  });
  it("flat within the deadband", () => {
    const f = lensFacts([pt({ price: 0.5, pricePct: 0 }), pt({ price: 0.5, pricePct: 0.2 })]);
    expect(lensStory("price", "NO", f, "today", money)).toBe(
      "NO share price has stayed flat today.",
    );
  });
  it("admits when the side has no price on record", () => {
    const f = lensFacts([pt({}), pt({})]);
    expect(lensStory("price", "YES", f, "today", money)).toBe("The market hasn't priced YES yet.");
  });
});

describe("lensColdStart", () => {
  it("explains a one-point series instead of drawing a flat line", () => {
    expect(lensColdStart("believers", [pt({})])).toMatch(/Waiting for more believers/);
    expect(lensColdStart("capital", [pt({})])).toMatch(/Too new to chart/);
  });
  it("price needs two real prices, not just two points", () => {
    expect(lensColdStart("price", [pt({ believers: 1 }), pt({ believers: 2 })])).toMatch(
      /Too new to chart/,
    );
    expect(lensColdStart("price", [pt({ price: 0.4 }), pt({ price: 0.5 })])).toBeNull();
  });
  it("is null when there is a real chart to draw", () => {
    expect(lensColdStart("believers", [pt({}), pt({ believers: 2 })])).toBeNull();
  });
});

describe("lensMarkers", () => {
  it("believers mark the biggest joins, at most two, on real steps", () => {
    const s = [
      pt({ t: 1, believers: 0 }),
      pt({ t: 2, believers: 3 }), // +3
      pt({ t: 3, believers: 4 }), // +1
    ];
    const m = lensMarkers("believers", s, money);
    expect(m).toHaveLength(1); // only up-steps exist
    expect(m[0]).toMatchObject({ label: "+3", dir: "up", t: 2 });
  });
  it("capital marks one inflow and one outflow", () => {
    const s = [
      pt({ t: 1, capital: 0 }),
      pt({ t: 2, capital: 8 }), // +$80
      pt({ t: 3, capital: 4 }), // −$40
    ];
    const m = lensMarkers("capital", s, money);
    expect(m.map((x) => x.label)).toEqual(["+$80", "−$40"]);
    expect(m.map((x) => x.dir)).toEqual(["up", "down"]);
  });
  it("price marks its high and low in time order", () => {
    const s = [
      pt({ t: 1, price: 0.5 }),
      pt({ t: 2, price: 0.8 }), // high
      pt({ t: 3, price: 0.3 }), // low
    ];
    const m = lensMarkers("price", s, money);
    expect(m).toEqual([
      { t: 2, label: "High", dir: "up" },
      { t: 3, label: "Low", dir: "down" },
    ]);
  });
  it("returns nothing when the price never moves", () => {
    const s = [pt({ t: 1, price: 0.5 }), pt({ t: 2, price: 0.5 })];
    expect(lensMarkers("price", s, money)).toEqual([]);
  });
});
