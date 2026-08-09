import { describe, expect, it } from "vitest";
import {
  findConvictionWhale,
  whaleTenureText,
  WHALE,
  type WhaleCandidate,
} from "./conviction-whale";
import { currentHoldDays } from "./tenure";

const holder = (over: Partial<WhaleCandidate> = {}): WhaleCandidate => ({
  wallet: "0xaaa",
  side: "YES",
  daysHeld: 30,
  valueUsd: 100,
  ...over,
});

describe("who earns the seat", () => {
  it("gives it to the largest position among the established", () => {
    const w = findConvictionWhale([
      holder({ wallet: "0xsmall", valueUsd: 50 }),
      holder({ wallet: "0xbig", valueUsd: 500 }),
      holder({ wallet: "0xmid", valueUsd: 200 }),
    ]);
    expect(w?.wallet).toBe("0xbig");
  });

  it("carries the side, because the ring colour is the only thing that says it", () => {
    expect(findConvictionWhale([holder({ side: "NO" })])?.side).toBe("NO");
  });

  it("breaks a tie on size by the longer hold", () => {
    const w = findConvictionWhale([
      holder({ wallet: "0xnewer", valueUsd: 300, daysHeld: 9 }),
      holder({ wallet: "0xolder", valueUsd: 300, daysHeld: 40 }),
    ]);
    expect(w?.wallet).toBe("0xolder");
  });

  it("is deterministic when size and tenure both tie", () => {
    // Without a final key the badge could swap between two reads of one state,
    // which reads as a bug rather than a distinction.
    const pair = [
      holder({ wallet: "0xbbb", valueUsd: 300, daysHeld: 20 }),
      holder({ wallet: "0xaaa", valueUsd: 300, daysHeld: 20 }),
    ];
    expect(findConvictionWhale(pair)?.wallet).toBe("0xaaa");
    expect(findConvictionWhale([...pair].reverse())?.wallet).toBe("0xaaa");
  });
});

describe("the seat has to be earned", () => {
  it("cannot be bought by a huge position taken today", () => {
    // The whole point: size must be earned through time.
    const w = findConvictionWhale([
      holder({ wallet: "0xwhale_today", valueUsd: 100_000, daysHeld: 0 }),
      holder({ wallet: "0xsteady", valueUsd: 40, daysHeld: 12 }),
    ]);
    expect(w?.wallet).toBe("0xsteady");
  });

  it("excludes anyone one day short of the threshold", () => {
    expect(findConvictionWhale([holder({ daysHeld: WHALE.minDays - 1 })])).toBeNull();
    expect(findConvictionWhale([holder({ daysHeld: WHALE.minDays })])).not.toBeNull();
  });

  it("has no whale at all when nobody is established — never a best-available", () => {
    const w = findConvictionWhale([
      holder({ wallet: "0xa", valueUsd: 900, daysHeld: 2 }),
      holder({ wallet: "0xb", valueUsd: 800, daysHeld: 6 }),
    ]);
    expect(w).toBeNull();
  });

  it("ignores people who are no longer directional", () => {
    // Exited or hedged into MIXED: they hold no side to be the whale of.
    for (const side of ["MIXED", "INACTIVE", null]) {
      expect(findConvictionWhale([holder({ side })])).toBeNull();
    }
  });

  it("ignores a closed position, however long it was once held", () => {
    expect(findConvictionWhale([holder({ valueUsd: 0, daysHeld: 400 })])).toBeNull();
  });

  it("is silent on an empty market rather than guessing", () => {
    expect(findConvictionWhale([])).toBeNull();
  });

  it("survives unusable numbers without crowning a NaN", () => {
    expect(findConvictionWhale([holder({ daysHeld: Number.NaN })])).toBeNull();
    expect(findConvictionWhale([holder({ valueUsd: Number.NaN })])).toBeNull();
  });
});

describe("whaleTenureText", () => {
  it("floors the days rather than rounding a 19.9 up to 20", () => {
    expect(
      whaleTenureText({ wallet: "0xa", side: "YES", daysHeld: 19.9, tenureIsFloor: false }),
    ).toBe("19d");
  });

  it("marks a lower-bound tenure, so an unknowable start is never stated as exact", () => {
    expect(whaleTenureText({ wallet: "0xa", side: "YES", daysHeld: 43, tenureIsFloor: true })).toBe(
      "43d+",
    );
  });
});

/**
 * WHAT REPLACING THE OLD FLAG HAD TO CHANGE.
 *
 * `Believer.whale` used to mean "big money on this side" — $250, or $5000
 * absolute, up to two per side and so up to four per market, with no tenure
 * requirement at all. These pin the differences that made it worth replacing
 * rather than keeping alongside.
 */
describe("the seat is not the old size flag", () => {
  const rich = { wallet: "0xrich", side: "YES", daysHeld: 0, valueUsd: 9_000 };
  const steady = { wallet: "0xsteady", side: "YES", daysHeld: 30, valueUsd: 300 };

  it("does not crown $9,000 bought today, which the old flag would have", () => {
    // $9,000 cleared WHALE_ABS_USD outright. Tenure is the whole difference.
    expect(findConvictionWhale([rich, steady])?.wallet).toBe("0xsteady");
  });

  it("names exactly one holder, never one per side", () => {
    const w = findConvictionWhale([
      { wallet: "0xyes", side: "YES", daysHeld: 40, valueUsd: 900 },
      { wallet: "0xno", side: "NO", daysHeld: 40, valueUsd: 800 },
    ]);
    expect(w?.wallet).toBe("0xyes");
    expect(w?.side).toBe("YES");
  });

  it("has no dollar threshold — the market decides its own scale", () => {
    // The old flag ignored anyone under $250, so a small market had no whale
    // however long anyone had stood there.
    expect(
      findConvictionWhale([{ wallet: "0xa", side: "NO", daysHeld: 20, valueUsd: 12 }]),
    ).not.toBeNull();
  });
});

/**
 * ONE DEFINITION, EVERYWHERE. The Whale and the tape must agree about how long
 * a wallet has held, or the same person reads as established in one place and
 * new in another. Both now measure from directional_since via
 * src/domain/tenure.
 */
describe("Whale eligibility uses the same tenure as every other surface", () => {
  const NOW = Date.UTC(2026, 5, 1);
  const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
  const held = (since: string | null) => currentHoldDays(since, NOW) ?? 0;

  it("excludes a 43-day-old FIRST visit whose current hold restarted 2 days ago", () => {
    // The exact case the tape used to get wrong: exited, then came back.
    expect(
      findConvictionWhale([
        { wallet: "0xback", side: "YES", daysHeld: held(daysAgo(2)), valueUsd: 9_000 },
      ]),
    ).toBeNull();
  });

  it("includes a hold that survived adds and trims", () => {
    expect(
      findConvictionWhale([
        { wallet: "0xsteady", side: "YES", daysHeld: held(daysAgo(20)), valueUsd: 100 },
      ])?.wallet,
    ).toBe("0xsteady");
  });

  it("treats a flip as a new conviction, not a continuing one", () => {
    expect(
      findConvictionWhale([
        { wallet: "0xflipped", side: "NO", daysHeld: held(daysAgo(3)), valueUsd: 9_000 },
      ]),
    ).toBeNull();
  });

  it("claims nothing for someone with no current directional holding", () => {
    expect(
      findConvictionWhale([{ wallet: "0xout", side: "YES", daysHeld: held(null), valueUsd: 500 }]),
    ).toBeNull();
  });
});
