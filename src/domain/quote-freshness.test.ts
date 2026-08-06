import { describe, it, expect } from "vitest";
import {
  driftBps,
  checkQuote,
  quoteMovedCopy,
  quoteMovedMessage,
  QUOTE_DRIFT_TOLERANCE_BPS,
  QUOTE_COPY_BUDGET,
} from "./quote-freshness";
import { DEFAULT_SLIPPAGE_BPS, minOut } from "./order";

describe("driftBps", () => {
  it("measures how much worse the deal got", () => {
    // 1000 → 950 is 5% worse.
    expect(driftBps(1000n, 950n)).toBe(500n);
  });

  it("treats a better quote as no drift at all", () => {
    // "You get MORE than promised" is not a change a reader needs to approve.
    expect(driftBps(1000n, 1100n)).toBe(0n);
    expect(driftBps(1000n, 1000n)).toBe(0n);
  });

  it("does not divide by a zero baseline", () => {
    expect(driftBps(0n, 500n)).toBe(0n);
  });

  it("keeps full precision on wei-scale values", () => {
    // Quotes are 18-decimal bigints; a percentage computed through Number would
    // lose the low bits on exactly the numbers that matter.
    const shown = 1_000_000_000_000_000_000n;
    const fresh = 990_000_000_000_000_000n;
    expect(driftBps(shown, fresh)).toBe(100n);
  });
});

describe("checkQuote", () => {
  it("proceeds on a small move, signing against the FRESH number", () => {
    // The point of the re-read: the floor protects sign→inclusion, so it has to
    // be built from the quote that was true at signing time.
    const r = checkQuote(1000n, 990n);
    expect(r).toEqual({ ok: true, use: 990n, driftBps: 100n });
  });

  it("proceeds when the price moved in the reader's favour", () => {
    const r = checkQuote(1000n, 1200n);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.use).toBe(1200n);
  });

  it("stops when the move exceeds the tolerance the product declares", () => {
    // 1000 → 970 is 3%, past the 2% a reader implicitly accepts on confirm.
    const r = checkQuote(1000n, 970n);
    expect(r).toEqual({
      ok: false,
      reason: "moved",
      shown: 1000n,
      fresh: 970n,
      driftBps: 300n,
    });
  });

  it("allows a move sitting exactly on the tolerance", () => {
    // The boundary belongs to the reader: 2% is what they accepted, so 2% is
    // not a violation of it.
    const exact = 1000n - (1000n * DEFAULT_SLIPPAGE_BPS) / 10_000n;
    const r = checkQuote(1000n, exact);
    expect(r.ok).toBe(true);
  });

  it("BLOCKS rather than falling back to the stale quote when the re-read fails", () => {
    // The hole this module exists to close. Signing a floor we could not verify
    // is worse than not signing — same rule as domain/affordability.
    expect(checkQuote(1000n, null)).toEqual({ ok: false, reason: "unavailable" });
    expect(checkQuote(1000n, undefined)).toEqual({ ok: false, reason: "unavailable" });
    expect(checkQuote(1000n, 0n)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("accepts the fresh quote when there was nothing on screen to contradict", () => {
    const r = checkQuote(0n, 500n);
    expect(r).toEqual({ ok: true, use: 500n, driftBps: 0n });
  });
});

describe("the tolerance is not a second threshold", () => {
  it("is the slippage the product already declares", () => {
    // Two answers to "how much movement is acceptable" would drift apart
    // silently, and the drift would only be visible as reverted transactions.
    expect(QUOTE_DRIFT_TOLERANCE_BPS).toBe(DEFAULT_SLIPPAGE_BPS);
  });

  it("means an accepted re-quote always clears its own floor", () => {
    // The invariant that makes this safe: if we proceed, the floor we sign is
    // built from the number we checked, so the check cannot pass while the
    // transaction is still doomed.
    const shown = 1_000_000n;
    const fresh = 985_000n; // 1.5% worse — inside tolerance
    const r = checkQuote(shown, fresh);
    expect(r.ok).toBe(true);
    if (r.ok) expect(minOut(r.use)).toBeLessThanOrEqual(fresh);
  });
});

describe("quoteMovedCopy", () => {
  it("says nothing when there is nothing to say", () => {
    expect(quoteMovedCopy({ ok: true, use: 1n, driftBps: 0n })).toBeNull();
  });

  it("never calls a price move a failure, and says nothing was sent", () => {
    const c = quoteMovedCopy(checkQuote(1000n, 940n))!;
    expect(c.title).toMatch(/price moved/i);
    expect(c.title).not.toMatch(/fail|error/i);
    expect(c.body).toMatch(/nothing was sent/i);
    expect(c.body).toMatch(/6%/);
  });

  it("owns the problem when we could not check, without blaming the wallet", () => {
    const c = quoteMovedCopy({ ok: false, reason: "unavailable" })!;
    expect(c.body).toMatch(/nothing was sent/i);
    expect(c.body).not.toMatch(/wallet|balance|insufficient/i);
  });

  it("FITS THE TICKET, which truncates at 120 characters", () => {
    // OrderTicket renders `trade.error.message.slice(0, 120)`. Copy written past
    // that is not shown in full — it is cut mid-sentence. Every message this
    // module can produce has to survive intact, including the widest drift.
    const cases = [
      checkQuote(1000n, 970n), // 3%
      checkQuote(1000n, 500n), // 50%
      checkQuote(10_000n, 1n), // 99.9% — the widest realistic reading
      { ok: false, reason: "unavailable" } as const,
    ];
    for (const c of cases) {
      const msg = quoteMovedMessage(c)!;
      expect(msg, msg).toBeTruthy();
      expect(msg.length, `"${msg}" is ${msg.length} chars`).toBeLessThanOrEqual(QUOTE_COPY_BUDGET);
      // And it must not merely fit — it must end as a whole sentence.
      expect(msg.slice(0, QUOTE_COPY_BUDGET)).toBe(msg);
    }
  });

  it("renders a whole percentage without a trailing decimal", () => {
    // 1000 → 950 is exactly 5%, not "5.0%".
    const c = quoteMovedCopy(checkQuote(1000n, 950n, 100n))!;
    expect(c.body).toMatch(/\b5%/);
  });
});
