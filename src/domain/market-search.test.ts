import { describe, expect, it } from "vitest";
import { rankMarkets } from "./market-search";

const catalog = [
  { id: 1, title: "Will Bitcoin become more valuable than gold before 2035?" },
  { id: 2, title: "Is iPhone better than Android?" },
  { id: 3, title: "Do you think working is actually slavery?" },
  { id: 4, title: "Did you catch yourself smiling today?" },
  { id: 5, title: "Is being a social media influencer a real profession?" },
];

const top = (q: string) => rankMarkets(q, catalog)[0]?.id ?? null;

describe("rankMarkets", () => {
  it("finds a market by any keyword in it", () => {
    expect(top("bitcoin")).toBe(1);
    expect(top("gold")).toBe(1);
    expect(top("iphone")).toBe(2);
  });

  it("matches stems and plurals", () => {
    expect(top("work")).toBe(3);
    expect(top("smile")).toBe(4);
    expect(top("influencers")).toBe(5);
  });

  it("tolerates typos", () => {
    expect(top("bitcion")).toBe(1);
    expect(top("influencar")).toBe(5);
  });

  it("understands related concepts", () => {
    expect(top("job")).toBe(3);
    expect(top("apple")).toBe(2);
    expect(top("happy")).toBe(4);
  });

  it("ignores word order and filler words", () => {
    expect(top("gold vs bitcoin")).toBe(1);
    expect(top("is the iphone any better")).toBe(2);
  });

  it("prefers full coverage over one loud word", () => {
    const r = rankMarkets("iphone android", catalog);
    expect(r[0].id).toBe(2);
    expect(r[0].coverage).toBe(1);
  });

  it("returns nothing for a query with no meaningful match", () => {
    expect(rankMarkets("zzzzqqq", catalog)).toHaveLength(0);
    expect(rankMarkets("a", catalog)).toHaveLength(0);
  });

  it("uses momentum only to break relevance ties", () => {
    const docs = [
      { id: 10, title: "Is coffee good?", interest: 0 },
      { id: 11, title: "Is coffee good?", interest: 1 },
    ];
    expect(rankMarkets("coffee", docs)[0].id).toBe(11);
  });
});
