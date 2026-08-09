/**
 * THE VOICE IS TESTABLE OR IT IS DECORATION.
 *
 * Three properties matter and nothing else does:
 *
 *   1. DETERMINISM — the same row reads identically forever, on both runtimes.
 *   2. FACT PRESERVATION — a variant may change words, never meaning. Side,
 *      amount, count and relationship survive every phrasing.
 *   3. RESTRAINT — the PI is not a question machine and never speaks system or
 *      fake-insider language.
 */
import { describe, expect, it } from "vitest";
import {
  observeConviction,
  piHash,
  pickVariant,
  tellPiStory,
  capitalDrainLine,
  capitalArrivalLine,
  reawakenLine,
  PI_BANNED,
} from "./pi-voice";
import type { ConvictionEvent } from "./conviction-event";

const ev = (o: Partial<ConvictionEvent> = {}): ConvictionEvent => ({
  action: "enter",
  side: "YES",
  actor: { name: "duckfacts.eth", relationship: null },
  context: { amountUsd: 12, sideBelieversAfter: 4 },
  ...o,
});

/** A spread of rows wide enough that a systemic tic would show up. */
const CORPUS: { key: string; e: ConvictionEvent }[] = [
  ...Array.from({ length: 12 }, (_, i) => ({
    key: `row-${i}`,
    e: ev({ context: { amountUsd: 3 + i, sideBelieversAfter: 2 + i } }),
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    key: `exit-${i}`,
    e: ev({
      action: "exit",
      context: { amountUsd: 5 * i, sideBelieversAfter: i, daysHeld: i * 9 },
    }),
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    key: `flip-${i}`,
    e: ev({
      action: "flip",
      actor: { name: null, relationship: i % 2 ? "twin" : "tribe" },
      context: { daysHeld: 4 + i },
    }),
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    key: `big-${i}`,
    e: ev({ context: { amountUsd: 250 + i, sideBelieversAfter: 9 } }),
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    key: `sweep-${i}`,
    e: ev({ action: "sweep_out", side: null, context: { marketCount: 4 + i, amountUsd: 40 } }),
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    key: `add-${i}`,
    e: ev({ action: "add", context: { amountUsd: 20 + i, heldBefore: true } }),
  })),
];

describe("determinism", () => {
  it("the same key always yields the same copy", () => {
    for (const { key, e } of CORPUS) {
      const a = tellPiStory(e, key);
      const b = tellPiStory(e, key);
      expect(a).toEqual(b);
    }
  });

  it("different keys spread across the variants", () => {
    const headlines = new Set(CORPUS.map(({ key, e }) => tellPiStory(e, key).headline));
    expect(headlines.size).toBeGreaterThan(4);
  });

  it("piHash is stable and unsigned", () => {
    expect(piHash("abc")).toBe(piHash("abc"));
    expect(piHash("abc")).toBeGreaterThanOrEqual(0);
    expect(pickVariant("abc", [1, 2, 3])).toBe(pickVariant("abc", [1, 2, 3]));
  });
});

describe("a variant changes words, never facts", () => {
  it("keeps the side, the amount and the relationship in every phrasing", () => {
    const e = ev({ context: { amountUsd: 250, sideBelieversAfter: 6 } });
    for (let i = 0; i < 40; i++) {
      const s = tellPiStory(e, `k${i}`);
      const all = `${s.headline} ${s.body} ${s.attribution ?? ""}`;
      expect(all).toContain("YES");
      expect(all).toContain("$250");
      expect(s.tone).toBe("yes");
    }
  });

  it("never states a side the event does not have", () => {
    for (let i = 0; i < 20; i++) {
      const s = tellPiStory(ev({ side: null, action: "exit", context: {} }), `n${i}`);
      expect(`${s.headline} ${s.body}`).not.toMatch(/\bYES\b|\bNO\b/);
    }
  });

  it("a relationship keeps the row personal", () => {
    const s = tellPiStory(
      ev({ actor: { name: "Mia", relationship: "twin" }, context: { amountUsd: 9 } }),
      "rel-1",
    );
    expect(s.personal).toBe(true);
    expect(s.category).toBe("twin");
  });
});

describe("restraint", () => {
  it("no system, hype or directive vocabulary anywhere in the corpus", () => {
    for (const { key, e } of CORPUS) {
      const s = tellPiStory(e, key);
      const text = `${s.headline} ${s.body} ${s.attribution ?? ""}`.toLowerCase();
      for (const word of PI_BANNED) expect(text).not.toContain(word);
    }
  });

  it("questions are rare — most rows are not eligible to ask one at all", () => {
    const asked = CORPUS.filter(({ key, e }) => {
      const s = tellPiStory(e, key);
      return `${s.body} ${s.attribution ?? ""}`.includes("?");
    }).length;
    expect(asked / CORPUS.length).toBeLessThanOrEqual(0.15);
  });

  it("an ordinary arrival with no context is not worth an angle", () => {
    const obs = observeConviction(ev({ context: { amountUsd: 0 } }));
    expect(obs.response).toBe("suppress");
  });

  it("a single person doing a single thing is never question-eligible", () => {
    expect(observeConviction(ev({ action: "add" })).questionEligible).toBe(false);
    expect(observeConviction(ev({ action: "exit" })).questionEligible).toBe(false);
  });

  it("an unmeasurable tenure is marked bounded, never claimed exactly", () => {
    const obs = observeConviction(
      ev({ action: "exit", context: { daysHeld: 43, tenureIsFloor: true } }),
    );
    expect(obs.certainty).toBe("bounded");
    const s = tellPiStory(
      ev({ action: "exit", context: { daysHeld: 43, tenureIsFloor: true } }),
      "b1",
    );
    expect(`${s.body} ${s.attribution ?? ""}`).toContain("43+ days");
  });
});

describe("intensity is derived, never chosen", () => {
  it("a total drain, a heavy drain and a light drain do not share a sentence", () => {
    const a = capitalDrainLine("YES", -100, "k");
    const b = capitalDrainLine("YES", -65, "k");
    const c = capitalDrainLine("YES", -12, "k");
    expect(new Set([a.headline, b.headline, c.headline]).size).toBe(3);
    expect(`${a.headline} ${a.body}`.toLowerCase()).toMatch(/gone|nothing|empt/);
    expect(`${c.headline} ${c.body}`.toLowerCase()).not.toMatch(/gone|nothing/);
  });

  it("arrivals scale the same way", () => {
    expect(capitalArrivalLine("NO", 140, "k").headline).not.toBe(
      capitalArrivalLine("NO", 12, "k").headline,
    );
  });

  it("a two-trade pulse is quieter than a room refilling", () => {
    const weak = reawakenLine(2, false, "k");
    const strong = reawakenLine(9, true, "k");
    expect(weak.headline).not.toBe(strong.headline);
    expect(weak.body).toContain("2 trades");
    expect(strong.body).toContain("9 trades");
  });
});

describe("the strongest human stories keep their force", () => {
  it("going first says the room was empty", () => {
    const s = tellPiStory(
      ev({ context: { sideBelieversAfter: 1, peopleCount: 1, amountUsd: 20 } }),
      "first",
    );
    expect(`${s.headline} ${s.body} ${s.attribution ?? ""}`.toLowerCase()).toMatch(
      /first|empty|nobody|only one/,
    );
  });

  it("a side emptying is stated as a state change", () => {
    const s = tellPiStory(ev({ action: "exit", context: { sideBelieversAfter: 0 } }), "empty");
    expect(`${s.headline} ${s.body}`.toLowerCase()).toMatch(/empt|last one/);
  });

  it("a turn after a long hold keeps the duration", () => {
    const s = tellPiStory(ev({ action: "flip", side: "NO", context: { daysHeld: 40 } }), "turn");
    expect(`${s.headline} ${s.body} ${s.attribution ?? ""}`).toContain("40 days");
  });
});
