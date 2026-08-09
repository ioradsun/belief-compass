import { describe, expect, it } from "vitest";
import {
  findConvictionWhale,
  whaleTenureText,
  WHALE,
  type WhaleCandidate,
} from "./conviction-whale";

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
