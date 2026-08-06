import { describe, it, expect } from "vitest";
import { participantCount, participantsLabel } from "./participants";

/**
 * ONE WORD, ONE NUMBER. The feed printed `market_participation`'s raw reach and
 * the search index printed `max(reach, believers)`, so the same market could be
 * 5 participants in the running order and 12 in a search result.
 */
describe("participantCount", () => {
  it("takes the tape's count when it is the better-informed answer", () => {
    expect(participantCount({ reachParticipants: 42, believersYes: 3, believersNo: 2 })).toBe(42);
  });

  it("never reports fewer people than are visibly holding a side", () => {
    // A market whose trades pre-date event indexing has a reach of zero while
    // plainly holding believers. "0 participants" over a market with people in
    // it is a confident zero, not a fact.
    expect(participantCount({ reachParticipants: 0, believersYes: 7, believersNo: 5 })).toBe(12);
    expect(participantCount({ believersYes: 4, believersNo: 0 })).toBe(4);
    expect(participantCount({ reachParticipants: null, believersYes: 1, believersNo: 1 })).toBe(2);
  });

  it("takes the max, never the sum — the populations overlap", () => {
    // A standing believer is someone who traded. Adding would double-count
    // every person the tape did record.
    expect(participantCount({ reachParticipants: 10, believersYes: 6, believersNo: 4 })).toBe(10);
  });

  it("invents nobody", () => {
    expect(participantCount({})).toBe(0);
    expect(participantCount({ reachParticipants: 0, believersYes: 0, believersNo: 0 })).toBe(0);
  });

  it("refuses nonsense rather than propagating it", () => {
    expect(participantCount({ reachParticipants: Number.NaN, believersYes: 3 })).toBe(3);
    expect(participantCount({ reachParticipants: -5, believersYes: -2 })).toBe(0);
    expect(participantCount({ reachParticipants: Number.POSITIVE_INFINITY })).toBe(0);
  });

  it("counts whole people", () => {
    expect(participantCount({ reachParticipants: 4.9 })).toBe(4);
  });
});

describe("participantsLabel", () => {
  it("says one participant, never 1 participants", () => {
    expect(participantsLabel(1)).toBe("1 participant");
    expect(participantsLabel(42)).toBe("42 participants");
    expect(participantsLabel(0)).toBe("0 participants");
  });
});
