import { describe, it, expect } from "vitest";
import { whatConnectsYou, CONNECT, type ConnectionInput } from "./what-connects-you";

const i = (o: Partial<ConnectionInput> = {}): ConnectionInput => ({
  sharedMarkets: 0,
  together: 0,
  apart: 0,
  alignedTopics: [],
  opposedTopics: [],
  viewerTopics: [],
  personTopics: [],
  viewerMedianDays: null,
  personMedianDays: null,
  ...o,
});

describe("the opening is an introduction, not a summary", () => {
  it("greets a real overlap as shared curiosity", () => {
    const c = whatConnectsYou(i({ sharedMarkets: 18, together: 14, apart: 4 }), "Sarah");
    expect(c.strength).toBe("strong");
    expect(c.opening).toBe("You and Sarah have been asking many of the same questions.");
  });

  it("frames disagreement as the same questions, different answers", () => {
    const c = whatConnectsYou(i({ sharedMarkets: 12, together: 4, apart: 8 }), "Sarah");
    expect(c.strength).toBe("opposed");
    expect(c.opening).toBe(
      "You often reach different conclusions — but on many of the same questions.",
    );
  });

  it("has a warmer line for a thin overlap", () => {
    const c = whatConnectsYou(i({ sharedMarkets: 2, together: 2 }), "Sarah");
    expect(c.strength).toBe("medium");
    expect(c.opening).toBe("You seem to be exploring similar ideas from different directions.");
  });

  it("never produces a score, a percentage, or a verdict", () => {
    const all = [
      whatConnectsYou(i({ sharedMarkets: 18, together: 14, apart: 4 }), "Sarah"),
      whatConnectsYou(i({ sharedMarkets: 12, together: 2, apart: 10 }), "Sarah"),
      whatConnectsYou(i(), "Sarah"),
    ]
      .flatMap((c) => [c.opening, ...c.bonds])
      .join(" ");
    expect(all).not.toMatch(/%|percent|match|compatib|score|get along|similar to you/i);
  });
});

/**
 * The sentence that greets someone with no overlap decides whether they keep
 * reading. "No shared markets" is technically true and the worst thing the page
 * could open with.
 */
describe("nobody is ever told they have nothing in common", () => {
  it("calls a stranger early rather than unconnected", () => {
    const c = whatConnectsYou(i(), "Sarah");
    expect(c.strength).toBe("new");
    expect(c.early).toBe(true);
    expect(c.opening).toBe(
      "You have not crossed paths yet — every connection starts with one shared question.",
    );
  });

  it("still hands them something true", () => {
    expect(whatConnectsYou(i()).bonds).toEqual([
      "You are both here looking for ideas worth backing.",
    ]);
  });

  it("never says the words that report an absence", () => {
    const c = whatConnectsYou(i());
    const all = [c.opening, ...c.bonds].join(" ");
    expect(all).not.toMatch(/\bno shared\b|\bnothing in common\b|\bnone\b|\b0\b/i);
  });

  /** A shared INTEREST is a real bond even with no market in common. */
  it("finds a topic in common before falling back", () => {
    const c = whatConnectsYou(
      i({ viewerTopics: ["technology", "sports"], personTopics: ["culture", "technology"] }),
      "Sarah",
    );
    expect(c.strength).toBe("medium");
    expect(c.bonds[0]).toBe("You are both drawn to technology.");
    expect(c.early).toBe(true);
  });
});

describe("the best bond leads, not the biggest number", () => {
  it("puts what you both care about above how many markets you share", () => {
    const c = whatConnectsYou(
      i({ sharedMarkets: 18, together: 14, apart: 4, alignedTopics: ["technology"] }),
      "Sarah",
    );
    expect(c.bonds[0]).toBe("You both care about technology.");
    expect(c.bonds[1]).toBe("You have both taken a side in 18 of the same markets.");
  });

  it("notices when you have never once disagreed", () => {
    const c = whatConnectsYou(i({ sharedMarkets: 7, together: 7, apart: 0 }));
    expect(c.bonds[0]).toBe(
      "You have taken the same side in all 7 of the markets you have both entered.",
    );
  });

  it("keeps the singular honest", () => {
    const c = whatConnectsYou(i({ sharedMarkets: 1, together: 0, apart: 1 }));
    expect(c.bonds[0]).toBe("You have both taken a side in 1 of the same market.");
  });

  it("caps the list — a recognition, not a report", () => {
    const c = whatConnectsYou(
      i({
        sharedMarkets: 20,
        together: 12,
        apart: 8,
        alignedTopics: ["technology", "culture"],
        opposedTopics: ["economics"],
        viewerMedianDays: 30,
        personMedianDays: 90,
      }),
      "Sarah",
    );
    expect(c.bonds).toHaveLength(CONNECT.maxBonds);
  });
});

describe("how someone holds their beliefs is a bond in its own right", () => {
  it("says when they stay with things longer", () => {
    const c = whatConnectsYou(i({ viewerMedianDays: 20, personMedianDays: 120 }), "Sarah");
    expect(c.bonds).toContain("Sarah tends to hold on longer than you.");
  });

  it("says when you do", () => {
    const c = whatConnectsYou(i({ viewerMedianDays: 200, personMedianDays: 20 }), "Sarah");
    expect(c.bonds).toContain("You tend to stay with a position longer than they do.");
  });

  it("calls close holding times what they are — a thing in common", () => {
    const c = whatConnectsYou(i({ viewerMedianDays: 60, personMedianDays: 66 }), "Sarah");
    expect(c.bonds).toContain("You hold your convictions for about the same length of time.");
  });

  it("says nothing at all when either side is unknown", () => {
    const c = whatConnectsYou(i({ viewerMedianDays: null, personMedianDays: 90 }));
    expect(c.bonds.join(" ")).not.toMatch(/hold|longer/);
  });
});

/**
 * Difference is part of knowing someone. Hiding it would make this section
 * flattery, which is the failure mode a "what connects you" panel invites.
 */
describe("difference is a bond, not a warning", () => {
  it("names where the two of you diverge", () => {
    const c = whatConnectsYou(
      i({ sharedMarkets: 9, together: 5, apart: 4, opposedTopics: ["economics"] }),
      "Sarah",
    );
    expect(c.bonds).toContain("You reach different conclusions on economics.");
  });

  it("never frames the difference as a problem", () => {
    const c = whatConnectsYou(
      i({ sharedMarkets: 12, together: 2, apart: 10, opposedTopics: ["politics"] }),
      "Sarah",
    );
    const all = [c.opening, ...c.bonds].join(" ");
    expect(all).not.toMatch(/but you|however|unfortunately|clash|conflict|wrong|oppos/i);
  });
});

/**
 * Caught by reading the output rather than by a test: "You both care about ai"
 * looks like a typo in the first line a visitor ever reads, and "in all 2 of
 * the markets" is not a sentence anybody says out loud.
 */
describe("it reads like a person wrote it", () => {
  it("capitalises the acronym topics", () => {
    expect(whatConnectsYou(i({ alignedTopics: ["ai"] })).bonds[0]).toBe("You both care about AI.");
    expect(whatConnectsYou(i({ viewerTopics: ["defi"], personTopics: ["defi"] })).bonds[0]).toBe(
      "You are both drawn to DeFi.",
    );
  });

  it("leaves ordinary topics lowercase, where they read correctly", () => {
    expect(whatConnectsYou(i({ alignedTopics: ["technology"] })).bonds[0]).toBe(
      "You both care about technology.",
    );
  });

  it("says 'both markets', never 'all 2 of the markets'", () => {
    expect(whatConnectsYou(i({ sharedMarkets: 2, together: 2 })).bonds[0]).toBe(
      "You have taken the same side in both markets you have entered.",
    );
  });

  it("has a sentence for the single shared market", () => {
    expect(whatConnectsYou(i({ sharedMarkets: 1, together: 1 })).bonds[0]).toBe(
      "You have taken the same side in the one market you have both entered.",
    );
  });

  it("capitalises the topic in a difference too", () => {
    const c = whatConnectsYou(
      i({ sharedMarkets: 9, together: 5, apart: 4, opposedTopics: ["ai"] }),
    );
    expect(c.bonds).toContain("You reach different conclusions on AI.");
  });
});
