import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mergeChain,
  provenanceLine,
  relayButtonLabel,
  RELAY_COST,
  RELAY_TITLE,
  EMPTY_PROVENANCE,
} from "@/domain/chain";
import { TABLE_BANNED } from "@/domain/table";
import type { Challenge } from "@/domain/challenge";
import type { TableRow } from "@/lib/table.server";

const call = (over: Partial<Challenge> = {}): Challenge => ({
  marketId: 1,
  title: "Will AI replace software engineers?",
  caller: { wallet: "0xsundeep", name: "Sundeep" },
  relation: "tribe",
  callerSide: "YES",
  together: 9,
  shared: 11,
  reason: "Sundeep believes YES.",
  atMs: 1_000,
  state: "waiting",
  stateAtMs: 1_000,
  reciprocity: null,
  ...over,
});

const row = (over: Partial<TableRow> = {}): TableRow => ({
  id: 7,
  marketId: 1,
  title: "Will AI replace software engineers?",
  createdAtMs: 2_000,
  recipients: [],
  closedAtMs: null,
  closeReason: null,
  responders: [],
  ...over,
});

/**
 * THE MERGE IS THE FEATURE. Two cards for one question was the surface refusing
 * to draw the only thing that makes this a chain: it passing THROUGH a person.
 */
describe("one card per person per market", () => {
  it("collapses the incoming call and the reader's own Challenge into one card", () => {
    const cards = mergeChain([call()], [row()]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.incoming).not.toBeNull();
    expect(cards[0]?.mine).not.toBeNull();
  });

  it("turns blue the moment the reader becomes the one asking", () => {
    expect(mergeChain([call()], [])[0]?.tone).toBe("amber");
    expect(mergeChain([call({ state: "showed_up" })], [])[0]?.tone).toBe("amber");
    expect(mergeChain([call({ state: "showed_up" })], [row()])[0]?.tone).toBe("blue");
  });

  it("walks the stages in order as the role changes", () => {
    expect(mergeChain([call()], [])[0]?.stage).toBe("brought_in");
    expect(mergeChain([call({ state: "showed_up" })], [])[0]?.stage).toBe("showed_up");
    expect(mergeChain([call({ state: "showed_up" })], [row()])[0]?.stage).toBe("relayed");
    // Something put up without being asked is still the reader asking.
    expect(mergeChain([], [row()])[0]?.stage).toBe("relayed");
  });

  it("puts somebody waiting on you above anything you are waiting on", () => {
    const cards = mergeChain([call({ marketId: 2, stateAtMs: 1 })], [row({ marketId: 3 })]);
    expect(cards.map((c) => c.marketId)).toEqual([2, 3]);
  });

  it("sinks what has ended below what is still live", () => {
    const cards = mergeChain(
      [call({ marketId: 2, state: "passed", stateAtMs: 9_000 })],
      [row({ marketId: 3 })],
    );
    expect(cards.map((c) => c.marketId)).toEqual([3, 2]);
    expect(cards[1]?.live).toBe(false);
  });

  it("is live while either half is", () => {
    expect(mergeChain([call()], [])[0]?.live).toBe(true);
    expect(mergeChain([], [row()])[0]?.live).toBe(true);
    expect(
      mergeChain([call({ state: "showed_up" })], [row({ closedAtMs: 5, closeReason: "creator" })])[0]
        ?.live,
    ).toBe(false);
  });
});

describe("provenance is a sentence, never a diagram", () => {
  it("names the root and the person who brought you in", () => {
    expect(provenanceLine({ ...EMPTY_PROVENANCE, startedBy: "Maya", through: "Sundeep" })).toBe(
      "Started by Maya · Reached you through Sundeep",
    );
  });

  it("says one clause when one person is both", () => {
    expect(provenanceLine({ ...EMPTY_PROVENANCE, startedBy: "Maya", through: "Maya" })).toBe(
      "Started by Maya",
    );
  });

  it("says the half it knows rather than inventing the other", () => {
    expect(provenanceLine({ ...EMPTY_PROVENANCE, through: "Sundeep" })).toBe(
      "Reached you through Sundeep",
    );
    expect(provenanceLine({ ...EMPTY_PROVENANCE, startedBy: "Maya" })).toBe("Started by Maya");
  });

  it("is silent when it knows nothing", () => {
    expect(provenanceLine(EMPTY_PROVENANCE)).toBeNull();
    expect(provenanceLine({ ...EMPTY_PROVENANCE, startedBy: "  ", through: "" })).toBeNull();
  });
});

describe("the relay offer", () => {
  it("never calls continuing a chain a pass", () => {
    const src = readFileSync(join(process.cwd(), "src/domain/chain.ts"), "utf8");
    for (const s of [RELAY_TITLE, RELAY_COST, relayButtonLabel(13) ?? ""])
      expect(s.toLowerCase()).not.toContain("pass");
    expect(src).not.toMatch(/"Pass it on"|Pass it forward/);
  });

  it("says nothing when there is nobody left to ask", () => {
    expect(relayButtonLabel(0)).toBeNull();
    expect(relayButtonLabel(-3)).toBeNull();
    expect(relayButtonLabel(13)).toBe("Challenge all 13");
  });

  it("keeps the banned vocabulary out of every word it renders", () => {
    for (const s of [RELAY_TITLE, RELAY_COST, relayButtonLabel(4) ?? ""])
      for (const w of TABLE_BANNED) expect(s.toLowerCase()).not.toContain(w);
  });
});

/**
 * NOBODY WHO PASSED CAN BE NAMED, and the merge is a place that could quietly
 * break it by carrying a name across from one half to the other.
 */
describe("passing stays nameless", () => {
  it("has no vocabulary for a person who declined", () => {
    const src = readFileSync(join(process.cwd(), "src/domain/chain.ts"), "utf8");
    expect(src).not.toMatch(/passedBy|whoPassed|declinedBy|passerNames/);
  });

  it("carries relay names only, which are public acts", () => {
    const cards = mergeChain([call({ state: "passed" })], []);
    expect(cards[0]?.mine).toBeNull();
    expect(cards[0]?.stage).toBe("brought_in");
  });
});
