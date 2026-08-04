import { describe, it, expect } from "vitest";
import {
  discoveryValue,
  discoveryBand,
  markSeen,
  DISCOVERY,
  type DiscoverySubject,
} from "./discovery";
import { scoreLiveAction } from "./significance";
import { CADENCE } from "./feed-cadence";
import type { FeedCandidate } from "./feed-event";

const NOW = Date.UTC(2026, 7, 4, 12);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const person = (o: Partial<DiscoverySubject> = {}): DiscoverySubject => ({
  wallet: "0xa",
  relationship: null,
  ...o,
});

/** A well-evidenced relationship — what the DNA engine actually produces. */
const proven = (o: Partial<DiscoverySubject> = {}): DiscoverySubject =>
  person({ sharedConvictions: 30, confidence: 0.8, topicCount: 4, ...o });

const value = (s: DiscoverySubject[], ctx = {}) => discoveryValue(s, { nowMs: NOW, ...ctx }).score;

describe("the question is who, not what", () => {
  it("a Twin outranks a stranger doing the same thing", () => {
    expect(value([proven({ relationship: "twin" })])).toBeGreaterThan(
      value([person({ daysHeld: 20, convictions: 8 })]),
    );
  });

  it("an Opp is worth as much as a Twin — both are people to meet", () => {
    // `inverse` is the stored name for the product's Opp.
    const twin = value([proven({ relationship: "twin" })]);
    const opp = value([proven({ wallet: "0xb", relationship: "inverse" })]);
    expect(Math.abs(twin - opp)).toBeLessThan(0.1);
    expect(discoveryBand(opp)).toBe(discoveryBand(twin));
  });

  it("the strongest opposite outranks the milder one, as the words say", () => {
    // Stored `inverse` reads as "Opp"; stored `opp` reads as "Rival".
    expect(value([proven({ relationship: "inverse" })])).toBeGreaterThan(
      value([proven({ wallet: "0xb", relationship: "opp" })]),
    );
  });

  it("an event about nobody is not a discovery", () => {
    expect(discoveryValue([], { nowMs: NOW }).score).toBe(0);
    expect(value([person()])).toBe(0);
  });
});

describe("money is never evidence that a person is worth meeting", () => {
  it("no input carries a dollar amount at all", () => {
    // The guard is structural: a caller cannot express "they are rich" here.
    const keys = Object.keys(
      proven({ daysHeld: 90, founding: true, convictions: 12, since: ago(0) }),
    );
    expect(keys.some((k) => /usd|amount|value|size|balance|worth/i.test(k))).toBe(false);
  });

  it("a whale with no relationship stays below a well-evidenced Twin", () => {
    const whale = value([person({ daysHeld: 400, founding: true, convictions: 50 })]);
    expect(whale).toBeLessThan(value([proven({ wallet: "0xb", relationship: "twin" })]));
  });
});

describe("evidence gates the claim", () => {
  it("a perfect match on thin history is a coincidence, not a discovery", () => {
    const thin = value([person({ relationship: "twin", sharedConvictions: 2, confidence: 0.2 })]);
    const real = value([proven({ relationship: "twin" })]);
    expect(thin).toBeLessThan(real);
    expect(discoveryBand(thin)).not.toBe("strong");
  });

  it("both the count and the engine's confidence must hold", () => {
    const manyButUnsure = value([
      person({ relationship: "twin", sharedConvictions: 40, confidence: 0.15 }),
    ]);
    const fewButSure = value([
      person({ wallet: "0xb", relationship: "twin", sharedConvictions: 2, confidence: 0.95 }),
    ]);
    expect(manyButUnsure).toBeLessThan(0.4);
    expect(fewButSure).toBeLessThan(0.4);
  });

  it("breadth counts — four topics beats the same topic four times", () => {
    expect(value([proven({ relationship: "tribe", topicCount: 5 })])).toBeGreaterThan(
      value([proven({ wallet: "0xb", relationship: "tribe", topicCount: 1 })]),
    );
  });
});

describe("a relationship you just formed is the discovery", () => {
  it("a brand-new Twin outranks one you have had for months", () => {
    expect(value([proven({ relationship: "twin", since: ago(60_000) })])).toBeGreaterThan(
      value([proven({ wallet: "0xb", relationship: "twin", since: ago(400 * 86_400_000) })]),
    );
  });

  it("newness expires — it does not stay new forever", () => {
    const inside = value([proven({ relationship: "twin", since: ago(1) })]);
    const outside = value([
      proven({ wallet: "0xb", relationship: "twin", since: ago(DISCOVERY.freshWindowMs + 1000) }),
    ]);
    expect(inside).toBeGreaterThan(outside);
  });

  it("a future timestamp is never treated as new", () => {
    expect(
      value([proven({ relationship: "twin", since: new Date(NOW + 86_400_000).toISOString() })]),
    ).toBe(value([proven({ wallet: "0xb", relationship: "twin" })]));
  });
});

describe("familiarity is not discovery", () => {
  it("the same face decays sharply within one feed", () => {
    const s = [proven({ relationship: "twin" })];
    const first = value(s);
    const third = value(s, { seen: new Map([["0xa", 3]]) });
    expect(third).toBeLessThan(first * 0.5);
  });

  it("is what stops one Twin taking over a session", () => {
    const seen = new Map<string, number>();
    const scores: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      scores.push(value([proven({ relationship: "twin" })], { seen }));
      markSeen(seen, ["0xa"]);
    }
    // Strictly non-increasing, and materially lower by the end.
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores[3]).toBeLessThan(scores[0] * 0.5);
  });

  it("counts wallets case-insensitively, as addresses arrive either way", () => {
    const seen = new Map<string, number>();
    markSeen(seen, ["0xABC"]);
    expect(seen.get("0xabc")).toBe(1);
  });
});

describe("strangers keep the network wide", () => {
  it("a long-held conviction makes a stranger worth opening", () => {
    expect(value([person({ daysHeld: 120 })])).toBeGreaterThan(value([person({ daysHeld: 1 })]));
  });

  it("a founding believer is a discovery even with no relationship", () => {
    expect(discoveryBand(value([person({ founding: true, daysHeld: 90 })]))).not.toBe("none");
  });

  it("a stranger with nothing behind them is not padded into one", () => {
    expect(value([person({ convictions: 0, daysHeld: 0 })])).toBe(0);
  });
});

describe("a group is one discovery, but a wider door", () => {
  it("five tribe members are not five times the discovery", () => {
    const one = value([proven({ relationship: "tribe" })]);
    const five = value(
      Array.from({ length: 5 }, (_, i) => proven({ wallet: `0x${i}`, relationship: "tribe" })),
    );
    expect(five).toBeLessThan(one * 1.5);
  });

  it("but several UNMET people beat the same person twice", () => {
    const seen = new Map([["0xa", 1]]);
    const crowd = value(
      Array.from({ length: 4 }, (_, i) => proven({ wallet: `0xnew${i}`, relationship: "tribe" })),
      { seen },
    );
    const repeat = value([proven({ relationship: "tribe" })], { seen });
    expect(crowd).toBeGreaterThan(repeat);
  });

  it("stays inside 0..1 however many people pile on", () => {
    const many = value(
      Array.from({ length: 40 }, (_, i) =>
        proven({ wallet: `0x${i}`, relationship: "twin", since: ago(1) }),
      ),
    );
    expect(many).toBeLessThanOrEqual(1);
  });
});

describe("the editorial test: a small move by someone you know", () => {
  const trade = (o: Partial<FeedCandidate>): FeedCandidate => ({
    kind: "trade_burst",
    side: "YES",
    amountUsd: 50,
    walletCount: 1,
    tradeCount: 1,
    marketBelievers: 200,
    ...o,
  });
  /** The mixer's blend of both dimensions — see feed-cadence. */
  const quality = (sig: number, disc: number) =>
    sig + (1 - sig) * CADENCE.discoveryLift * Math.min(1, disc);

  it("a $50 buy by your Twin outranks the biggest believer walking away", () => {
    const twin = quality(
      scoreLiveAction(trade({ relationship: "twin" })).score,
      value([proven({ relationship: "twin" })]),
    );
    // The strongest thing an ANONYMOUS individual can do: largest position, long
    // held, gone. Capped at the top of "high" by significance's own rule.
    const biggestLeft = quality(
      scoreLiveAction(trade({ amountUsd: 800 }), { fullExit: true, daysHeld: 60, rank: 1 }).score,
      value([person({ wallet: "0xz", daysHeld: 60 })]),
    );
    expect(twin).toBeGreaterThan(biggestLeft);
  });

  it("but not on the fourth time that Twin appears", () => {
    const seen = new Map([["0xa", 4]]);
    const tired = quality(
      scoreLiveAction(trade({ relationship: "twin" })).score,
      value([proven({ relationship: "twin" })], { seen }),
    );
    const fresh = quality(
      scoreLiveAction(trade({ relationship: "twin" })).score,
      value([proven({ relationship: "twin" })]),
    );
    expect(tired).toBeLessThan(fresh);
  });
});
