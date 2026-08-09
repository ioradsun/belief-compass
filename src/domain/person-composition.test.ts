import { describe, it, expect } from "vitest";
import { findPersonPatterns } from "./person-pattern";
import { sameCopyVersion, COPY_VERSION } from "./copy-version";

const base = { amountUsd: 20, name: "Kodak" };

describe("a person's receipts compose into one behaviour", () => {
  it("names the constituent rows the promoted story absorbs", () => {
    const p = findPersonPatterns([
      { ...base, id: "a", wallet: "0x1", marketId: "1", action: "exit", occurredAt: "2026-08-09T10:00:00Z" },
      { ...base, id: "b", wallet: "0x1", marketId: "2", action: "exit", occurredAt: "2026-08-09T11:00:00Z" },
      { ...base, id: "c", wallet: "0x1", marketId: "3", action: "flip", occurredAt: "2026-08-09T12:00:00Z" },
    ]);
    expect(p).toHaveLength(1);
    // The anchor keeps its row; the other two are consumed by it.
    expect(p[0]!.rowId).toBe("c");
    expect(p[0]!.consumes).toEqual(["a", "b"]);
  });

  it("calls cutting-plus-flipping repositioning, not retreat", () => {
    const p = findPersonPatterns([
      { ...base, id: "a", wallet: "0x1", marketId: "1", action: "exit", occurredAt: "2026-08-09T10:00:00Z" },
      { ...base, id: "b", wallet: "0x1", marketId: "2", action: "exit", occurredAt: "2026-08-09T11:00:00Z" },
      { ...base, id: "c", wallet: "0x1", marketId: "3", action: "flip", occurredAt: "2026-08-09T12:00:00Z" },
    ]);
    expect(p[0]!.lead?.headline).toBe("KODAK is repositioning");
    expect(p[0]!.lead?.body).toBe(
      "They cut two positions and flipped another in the last few hours.",
    );
  });

  it("says WHICH question they left and which they took", () => {
    const p = findPersonPatterns([
      {
        id: "a",
        wallet: "0x2",
        name: "Ramo",
        amountUsd: 30,
        marketId: "1",
        marketTitle: "Will Pump.fun still be top 3 by revenue?",
        action: "exit",
        occurredAt: "2026-08-09T10:00:00Z",
      },
      {
        id: "b",
        wallet: "0x2",
        name: "Ramo",
        amountUsd: 30,
        marketId: "2",
        marketTitle: "Will gaming tokens outperform in Q4?",
        action: "enter",
        side: "YES",
        occurredAt: "2026-08-09T11:00:00Z",
      },
    ]);
    expect(p[0]!.kind).toBe("rotation");
    expect(p[0]!.lead?.body).toBe("Out of Pump.fun still. Into gaming tokens outperform.");
  });

  it("a lone move is still not a pattern", () => {
    expect(
      findPersonPatterns([
        { ...base, id: "a", wallet: "0x1", marketId: "1", action: "exit", occurredAt: "2026-08-09T10:00:00Z" },
      ]),
    ).toHaveLength(0);
  });
});

describe("copy version", () => {
  it("only matches its own build", () => {
    expect(sameCopyVersion(COPY_VERSION)).toBe(true);
    expect(sameCopyVersion("some-older-build")).toBe(false);
    expect(sameCopyVersion(undefined)).toBe(false);
  });
});
