import { describe, expect, it } from "vitest";
import {
  presentRelationship,
  relationshipInsight,
  relationshipLabel,
  formatSharedConvictions,
  sortTribe,
  sortRivals,
  dnaMaturity,
  type RelationshipInput,
} from "./relationship";

const make = (o: Partial<RelationshipInput>): RelationshipInput => ({
  agreement: 50,
  sharedConvictions: 0,
  together: 0,
  apart: 0,
  topicCount: 0,
  ...o,
});

describe("alignment vs evidence separation", () => {
  it("low-evidence positive relationship: Tribe, counts (not a %), never a Twin", () => {
    const p = presentRelationship(
      make({ agreement: 75, sharedConvictions: 4, together: 3, apart: 1, topicCount: 2 }),
    );
    expect(p.group).toBe("tribe");
    expect(p.placed).toBe(true);
    expect(p.tier).toBe("low");
    expect(p.earnedLabel).toBeNull();
    expect(relationshipInsight(p)).toBe("3 together · 1 apart");
    // No mature percentage leaked into the primary insight.
    expect(relationshipInsight(p)).not.toMatch(/%/);
    expect(relationshipLabel(p)?.text).toBe("Closest so far");
  });

  it("low-evidence inverse relationship: Rivals, 'Opposite on all N', never an Opp", () => {
    const p = presentRelationship(
      make({ agreement: 0, sharedConvictions: 3, together: 0, apart: 3, topicCount: 2 }),
    );
    expect(p.group).toBe("rival");
    expect(p.tier).toBe("low");
    expect(p.earnedLabel).toBeNull();
    expect(relationshipInsight(p)).toBe("Opposite on all 3");
    expect(relationshipLabel(p)?.text).toBe("Most opposite so far");
  });

  it("never turns a shared count into a percentage (4 shared ≠ 4%)", () => {
    const p = presentRelationship(
      make({ agreement: 100, sharedConvictions: 4, together: 4, apart: 0 }),
    );
    expect(relationshipInsight(p)).toBe("Together on all 4");
    expect(p.alignmentPct).toBe(100); // alignment is 100% ...
    expect(p.tier).toBe("low"); // ... but the EVIDENCE is thin, so no mature %
  });
});

describe("mature relationships show the % WITH its evidence", () => {
  it("mature Tribe: percentage + evidence, but Twin only if all thresholds clear", () => {
    const p = presentRelationship(
      make({ agreement: 84, sharedConvictions: 19, together: 16, apart: 3, topicCount: 4 }),
    );
    expect(p.group).toBe("tribe");
    expect(p.tier).toBe("mature");
    expect(relationshipInsight(p)).toBe("84% aligned");
    // 84% < 90% Twin bar → Tribe, not Twin.
    expect(p.earnedLabel).toBeNull();
    expect(relationshipLabel(p)?.text).toBe("Tribe");
  });

  it("mature Rival: opposition percentage, Opp only if all thresholds clear", () => {
    const p = presentRelationship(
      make({ agreement: 19, sharedConvictions: 21, together: 4, apart: 17, topicCount: 4 }),
    );
    expect(p.group).toBe("rival");
    expect(p.tier).toBe("mature");
    expect(relationshipInsight(p)).toBe("81% opposite");
    // 81% opposite < 85% Opp bar → Rival, not Opp.
    expect(p.earnedLabel).toBeNull();
  });
});

describe("earned Twin and Opp", () => {
  it("earns Twin only with high alignment + evidence + topic breadth", () => {
    const twin = presentRelationship(
      make({ agreement: 93, sharedConvictions: 28, together: 26, apart: 2, topicCount: 5 }),
    );
    expect(twin.earnedLabel).toBe("twin");
    expect(relationshipLabel(twin)).toEqual({ text: "Twin", kind: "earned", tone: "aligned" });

    // Same alignment, too few topics → not yet a Twin.
    const narrow = presentRelationship(
      make({ agreement: 93, sharedConvictions: 28, together: 26, apart: 2, topicCount: 2 }),
    );
    expect(narrow.earnedLabel).toBeNull();

    // High alignment, thin evidence → not a Twin.
    const thin = presentRelationship(
      make({ agreement: 100, sharedConvictions: 4, together: 4, apart: 0, topicCount: 4 }),
    );
    expect(thin.earnedLabel).toBeNull();
  });

  it("earns Opp only with high opposition + evidence + topic breadth", () => {
    const opp = presentRelationship(
      make({ agreement: 12, sharedConvictions: 24, together: 3, apart: 21, topicCount: 4 }),
    );
    expect(opp.earnedLabel).toBe("opp");
    expect(relationshipLabel(opp)?.tone).toBe("opposed");
  });

  it("labels EVERY qualifying relationship — never forces exactly one Twin", () => {
    const a = presentRelationship(
      make({ agreement: 95, sharedConvictions: 30, together: 29, apart: 1, topicCount: 4 }),
    );
    const b = presentRelationship(
      make({ agreement: 91, sharedConvictions: 22, together: 20, apart: 2, topicCount: 3 }),
    );
    expect(a.earnedLabel).toBe("twin");
    expect(b.earnedLabel).toBe("twin");
  });
});

describe("neutral, no-overlap, and placement", () => {
  it("keeps a no-overlap person OUT of the primary lists", () => {
    const p = presentRelationship(make({ agreement: 50, sharedConvictions: 0 }));
    expect(p.group).toBe("insufficient");
    expect(p.placed).toBe(false);
    expect(relationshipLabel(p)).toBeNull();
  });

  it("keeps a near-neutral relationship out of Tribe and Rivals", () => {
    const p = presentRelationship(
      make({ agreement: 50, sharedConvictions: 12, together: 6, apart: 6, topicCount: 3 }),
    );
    expect(p.group).toBe("neutral");
    expect(p.placed).toBe(false);
  });
});

describe("sorting", () => {
  it("Tribe sorts most-aligned first, ties break on evidence", () => {
    const strong = presentRelationship(
      make({ agreement: 90, sharedConvictions: 20, together: 18, apart: 2, topicCount: 4 }),
    );
    const weak = presentRelationship(
      make({ agreement: 70, sharedConvictions: 12, together: 9, apart: 3, topicCount: 3 }),
    );
    const wellProven = presentRelationship(
      make({ agreement: 90, sharedConvictions: 40, together: 36, apart: 4, topicCount: 4 }),
    );
    expect([weak, strong].sort(sortTribe)[0]).toBe(strong);
    expect([strong, wellProven].sort(sortTribe)[0]).toBe(wellProven); // tie on 90% → more evidence wins
  });

  it("Rivals sorts most-opposite first", () => {
    const strong = presentRelationship(
      make({ agreement: 10, sharedConvictions: 20, together: 2, apart: 18, topicCount: 4 }),
    );
    const weak = presentRelationship(
      make({ agreement: 35, sharedConvictions: 12, together: 4, apart: 8, topicCount: 3 }),
    );
    expect([weak, strong].sort(sortRivals)[0]).toBe(strong);
  });
});

describe("topic lines and copy", () => {
  it("names common ground for Tribe and the divide for Rivals", () => {
    const tribe = presentRelationship(
      make({
        agreement: 84,
        sharedConvictions: 19,
        together: 16,
        apart: 3,
        topicCount: 4,
        strongestAlignedTopic: "Culture",
      }),
    );
    // The presentation still carries the topics; the line that rendered them
    // belonged to a profile layout that no longer exists.
    expect(tribe.strongestAlignedTopic).toBe("Culture");
  });

  it("formats shared convictions with correct pluralisation", () => {
    expect(formatSharedConvictions(1)).toBe("1 conviction in common");
    expect(formatSharedConvictions(19)).toBe("19 convictions in common");
  });
});

describe("page-level DNA maturity (factual, not a fake identity %)", () => {
  it("moves through qualitative stages and keeps the raw count", () => {
    const early = dnaMaturity(7, 3);
    expect(early.stage).toBe("Taking shape");
    expect(early.convictionsMapped).toBe(7);
    expect(early.note).toContain("Decide on 1 more market");

    const mid = dnaMaturity(12, 3);
    expect(mid.stage).toBe("Becoming clearer");

    const mature = dnaMaturity(24, 4);
    expect(mature.stage).toBe("Well defined");
    expect(mature.moreToSharpen).toBe(0);
  });

  it("invites the first decision when nothing is mapped", () => {
    expect(dnaMaturity(0, 0).note).toContain("Take a side");
  });
});
