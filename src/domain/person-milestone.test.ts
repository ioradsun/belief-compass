import { describe, it, expect } from "vitest";
import {
  convictionMilestone,
  convictionMilestones,
  tellConvictionMilestone,
  CONVICTION_RUNGS,
  type Person,
} from "./person-milestone";

const DAY = 86_400_000;
const nowMs = Date.UTC(2026, 7, 6, 12);
const win = { sinceMs: nowMs - 3 * DAY, nowMs };
const at = (daysAgo: number) => new Date(nowMs - daysAgo * DAY).toISOString();

const person = (count: number, newestDaysAgo = 1, name = "Sarah"): Person => ({
  wallet: "0xABC",
  name,
  convictions: Array.from({ length: count }, (_, i) => ({
    marketId: 100 + i,
    title: `Question ${i}`,
    // The last one is the newest; the rest are progressively older.
    startedAt: i === count - 1 ? at(newestDaysAgo) : at(newestDaysAgo + 10 + i),
  })),
});

describe("the second story one action tells", () => {
  it("says what the market rows cannot — the count is about the person", () => {
    const m = convictionMilestone(person(5), win)!;
    expect(m.rung).toBe(5);
    expect(m.name).toBe("Sarah");
    expect(tellConvictionMilestone(m).body).toBe("Sarah now backs 5 questions.");
  });

  it("names the belief that took them there", () => {
    const m = convictionMilestone(person(5), win)!;
    expect(m.marketId).toBe(104);
    expect(tellConvictionMilestone(m).attribution).toBe("The 5th is “Question 4”.");
  });

  it("counts in ordinals a person would use", () => {
    for (const [rung, word] of [
      [5, "5th"],
      [10, "10th"],
      [25, "25th"],
    ] as const) {
      const m = convictionMilestone(person(rung), win)!;
      expect(tellConvictionMilestone(m).attribution).toContain(word);
    }
  });
});

/**
 * The whole trick, and the reason this needs no table: a belief knows when it
 * began, so "when did they reach five?" is recoverable from state at any later
 * moment — identically, forever — rather than something we had to have watched.
 */
describe("the crossing has its own timestamp already", () => {
  it("dates the milestone to the newest conviction's own start", () => {
    const m = convictionMilestone(person(5, 2), win)!;
    expect(m.occurredAt).toBe(at(2));
  });

  it("gives the same answer on every read", () => {
    const p = person(5, 2);
    expect(convictionMilestone(p, win)).toEqual(convictionMilestone(p, win));
    expect(convictionMilestone(p, { sinceMs: win.sinceMs, nowMs: nowMs + DAY })?.id).toBe(
      convictionMilestone(p, win)?.id,
    );
  });

  it("keeps the identity distinct per crossing, so a return is a new story", () => {
    const a = convictionMilestone(person(5), win)!;
    const b = { ...person(5) };
    b.convictions[4] = { marketId: 999, title: "Another", startedAt: at(1) };
    expect(convictionMilestone(b, win)!.id).not.toBe(a.id);
  });
});

describe("only what is exactly true, and only while it is news", () => {
  it("says nothing between rungs", () => {
    expect(convictionMilestone(person(4), win)).toBeNull();
    expect(convictionMilestone(person(7), win)).toBeNull();
  });

  /**
   * Somebody who once held eight and is now down to five has an old
   * newest-start, so nothing is said — rather than announcing an arrival at a
   * number they reached on the way down.
   */
  it("never announces a count reached on the way down", () => {
    expect(convictionMilestone(person(5, 40), win)).toBeNull();
  });

  it("says nothing until a count reads as a habit", () => {
    expect(convictionMilestone(person(1), win)).toBeNull();
    expect(convictionMilestone(person(2), win)).toBeNull();
    expect(convictionMilestone(person(3), win)).toBeNull();
    expect(CONVICTION_RUNGS[0]).toBe(5);
  });

  it("refuses to count a belief it cannot date", () => {
    const p = person(5);
    p.convictions[0].startedAt = null;
    // Counting it would inflate the total while the instant came from another.
    expect(convictionMilestone(p, win)).toBeNull();
  });

  it("ignores a start in the future", () => {
    const p = person(3);
    p.convictions[2].startedAt = new Date(nowMs + DAY).toISOString();
    expect(convictionMilestone(p, win)).toBeNull();
  });

  it("holds nothing for somebody with no convictions", () => {
    expect(convictionMilestone({ wallet: "0x1", name: "Nobody", convictions: [] }, win)).toBeNull();
  });
});

describe("many people, newest first", () => {
  it("orders by when each count became true", () => {
    const rows = convictionMilestones(
      [
        { ...person(10, 3), wallet: "0xold" },
        { ...person(5, 1), wallet: "0xnew" },
        { ...person(4, 1), wallet: "0xbetween" }, // not on a rung
      ],
      win,
    );
    expect(rows.map((r) => r.wallet)).toEqual(["0xnew", "0xold"]);
  });

  it("gives one milestone per person, not a history of their rungs", () => {
    const rows = convictionMilestones([person(10)], win);
    expect(rows).toHaveLength(1);
    expect(rows[0].rung).toBe(10);
  });
});
