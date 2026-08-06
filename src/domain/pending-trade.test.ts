import { describe, it, expect } from "vitest";
import {
  parsePending,
  pendingState,
  blocksNewTrade,
  pendingCopy,
  PENDING_TRADE,
  type PendingTrade,
} from "./pending-trade";

const T = (o: Partial<PendingTrade> = {}): PendingTrade => ({
  hash: "0xabc",
  wallet: "0xviewer",
  marketId: 7,
  side: "YES",
  action: "BUY",
  submittedAt: 1_000_000,
  ...o,
});

describe("a transaction in flight survives the page", () => {
  it("reports a fresh record as pending", () => {
    const s = pendingState(T(), "0xVIEWER", 1_000_000 + 3_000);
    expect(s.status).toBe("pending");
  });

  /**
   * "We stopped waiting" and "it did not happen" are different facts. An aged
   * record becomes UNRESOLVED, never absent — because the interface must say
   * "check your wallet" rather than quietly re-offering the buy control.
   */
  it("ages into unresolved rather than into nothing", () => {
    const s = pendingState(T(), "0xviewer", 1_000_000 + PENDING_TRADE.staleAfterMs);
    expect(s.status).toBe("unresolved");
    expect(blocksNewTrade(s)).toBe(true);
  });

  it("blocks a new trade in BOTH live states", () => {
    expect(blocksNewTrade(pendingState(T(), "0xviewer", 1_000_001))).toBe(true);
    expect(blocksNewTrade(pendingState(T(), "0xviewer", 9_999_999))).toBe(true);
    expect(blocksNewTrade(pendingState(null, "0xviewer", 1))).toBe(false);
  });

  /** A second account on the same browser must never inherit a pending trade. */
  it("ignores a record belonging to another wallet", () => {
    expect(pendingState(T(), "0xsomeone-else", 1_000_001).status).toBe("none");
    expect(pendingState(T(), null, 1_000_001).status).toBe("none");
  });

  it("is case-insensitive about the viewer's address", () => {
    expect(pendingState(T({ wallet: "0xabcdef" }), "0xABCDEF", 1_000_001).status).toBe("pending");
  });
});

describe("stored records are untrusted input", () => {
  it("rejects anything malformed rather than trusting a shape", () => {
    for (const junk of [
      null,
      undefined,
      "",
      "not json",
      "{}",
      JSON.stringify({
        hash: "nope",
        wallet: "0x1",
        marketId: 1,
        side: "YES",
        action: "BUY",
        submittedAt: 1,
      }),
      JSON.stringify({
        hash: "0x1",
        wallet: "0x1",
        marketId: 1,
        side: "MAYBE",
        action: "BUY",
        submittedAt: 1,
      }),
      JSON.stringify({
        hash: "0x1",
        wallet: "0x1",
        marketId: "x",
        side: "YES",
        action: "BUY",
        submittedAt: 1,
      }),
      JSON.stringify({ hash: "0x1", marketId: 1, side: "YES", action: "BUY", submittedAt: 1 }),
    ]) {
      expect(parsePending(junk)).toBeNull();
    }
  });

  it("round-trips a real record and normalises the wallet", () => {
    const t = T({ wallet: "0xABC" });
    expect(parsePending(JSON.stringify(t))).toEqual({ ...t, wallet: "0xabc" });
  });
});

describe("the copy answers what the reader is actually asking", () => {
  const pending = pendingCopy(pendingState(T(), "0xviewer", 1_000_001))!;
  const unresolved = pendingCopy(pendingState(T(), "0xviewer", 9_999_999))!;

  it("says where the money is, and that leaving is safe", () => {
    expect(pending.body).toMatch(/debited/i);
    expect(pending.body).toMatch(/safely leave/i);
  });

  /**
   * The failure that produces double-submits: telling a reader a transaction
   * FAILED when the truthful answer is that we do not know.
   */
  it("never claims failure when the outcome is unknown", () => {
    expect(unresolved.title).not.toMatch(/failed/i);
    expect(unresolved.body).not.toMatch(/failed/i);
    expect(unresolved.body).toMatch(/may still have gone through/i);
    expect(unresolved.body).toMatch(/check your wallet/i);
  });

  it("names what is pending rather than saying 'something'", () => {
    expect(pending.title).toContain("YES");
    expect(pendingCopy(pendingState(T({ action: "SELL" }), "0xviewer", 1_000_001))!.title).toMatch(
      /Selling/,
    );
  });

  it("says nothing when there is nothing to say", () => {
    expect(pendingCopy({ status: "none" })).toBeNull();
  });
});
