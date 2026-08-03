import { describe, expect, it } from "vitest";
import { composeMarketOg } from "./market-og";

const base = {
  question: "Will ETH hit $5,000 by July?",
  yesPct: 62,
  believers: 40,
  capitalUsd: 12_000,
  newBelievers: 0,
  newBelieversWindow: "today",
};

describe("composeMarketOg", () => {
  it("uses the question as the title and current YES/NO state in the description", () => {
    const og = composeMarketOg(base);
    expect(og.title).toBe("Will ETH hit $5,000 by July?");
    expect(og.description.startsWith("62% YES · 38% NO")).toBe(true);
    expect(og.description.endsWith("Pick a side.")).toBe(true);
  });

  it("leads a close race with 'too close to call' (the strongest invitation)", () => {
    const og = composeMarketOg({ ...base, yesPct: 51, believers: 20 });
    expect(og.description).toContain("Too close to call");
    expect(og.description).toContain("51% YES · 49% NO");
  });

  it("prefers fresh momentum, labelled as a recent change (never a forecast)", () => {
    const og = composeMarketOg({ ...base, yesPct: 70, newBelievers: 9, newBelieversWindow: "today" });
    expect(og.description).toContain("+9 new believers today");
    expect(og.description).not.toMatch(/will|expected|projected|likely/i);
  });

  it("falls back to capital, then crowd size, then a first-believer nudge", () => {
    expect(composeMarketOg({ ...base, newBelievers: 0, capitalUsd: 3400 }).description).toContain(
      "$3.4k committed",
    );
    expect(
      composeMarketOg({ ...base, newBelievers: 0, capitalUsd: 0, believers: 7 }).description,
    ).toContain("7 believers");
    expect(
      composeMarketOg({ ...base, newBelievers: 0, capitalUsd: 0, believers: 1 }).description,
    ).toContain("First believer just arrived");
  });

  it("degrades honestly for an unpriced, empty market", () => {
    const og = composeMarketOg({
      question: "  ",
      yesPct: null,
      believers: 0,
      capitalUsd: 0,
      newBelievers: 0,
      newBelieversWindow: null,
    });
    expect(og.title).toBe("A market on Conviction");
    expect(og.description).toBe("Pick a side. Stand on business.");
  });

  it("clips an overlong question without cutting mid-word", () => {
    const long =
      "Will the extremely long and rambling question about whatever eventually get truncated cleanly here?";
    const og = composeMarketOg({ ...base, question: long });
    expect(og.title.length).toBeLessThanOrEqual(70);
    expect(og.title.endsWith("…")).toBe(true);
    expect(og.title).not.toMatch(/\s…$/);
  });
});
