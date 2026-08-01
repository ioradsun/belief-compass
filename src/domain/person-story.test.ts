import { describe, it, expect } from "vitest";
import {
  discoveryStage,
  personStory,
  DISCOVERY_LABEL,
  type PersonStoryInput,
} from "./person-story";

const base = (o: Partial<PersonStoryInput> = {}): PersonStoryInput => ({
  relationship: "neutral",
  evidence: "growing",
  agreement: 60,
  sharedBeliefs: 6,
  ...o,
});

describe("discoveryStage — a journey, never 'Neutral'", () => {
  it("a twin needs established evidence to be named; else 'possible'", () => {
    expect(discoveryStage(base({ relationship: "twin", evidence: "established" }))).toBe("twin");
    expect(discoveryStage(base({ relationship: "twin", evidence: "growing" }))).toBe(
      "possible_twin",
    );
  });
  it("a tribe graduates from possible → tribe with evidence", () => {
    expect(discoveryStage(base({ relationship: "tribe", evidence: "early" }))).toBe(
      "possible_tribe",
    );
    expect(discoveryStage(base({ relationship: "tribe", evidence: "established" }))).toBe("tribe");
  });
  it("an opp graduates from possible → opp with evidence", () => {
    expect(discoveryStage(base({ relationship: "opp", evidence: "early" }))).toBe("possible_opp");
    expect(discoveryStage(base({ relationship: "opp", evidence: "growing" }))).toBe("opp");
  });
  it("a neutral pairing is only 'recognizable' once you've truly crossed paths", () => {
    expect(
      discoveryStage(base({ relationship: "neutral", evidence: "growing", sharedBeliefs: 6 })),
    ).toBe("recognizable");
    expect(
      discoveryStage(base({ relationship: "neutral", evidence: "early", sharedBeliefs: 2 })),
    ).toBe("searching");
  });
  it("never emits the word 'neutral' as a label", () => {
    for (const label of Object.values(DISCOVERY_LABEL))
      expect(label.toLowerCase()).not.toBe("neutral");
  });
});

describe("personStory — one human sentence, not statistics", () => {
  it("a twin reads as thinking alike", () => {
    const s = personStory(base({ relationship: "twin", evidence: "established" }));
    expect(s.stageLabel).toBe("Conviction Twin");
    expect(s.sentence).toBe("You think alike — your convictions keep matching.");
    expect(s.tone).toBe("aligned");
  });
  it("a tribe names the domain you share", () => {
    const s = personStory(
      base({ relationship: "tribe", evidence: "established", alignedDomain: "AI" }),
    );
    expect(s.sentence).toBe("You agree most on AI.");
  });
  it("an opp with both signals contrasts agreement and clash", () => {
    const s = personStory(
      base({
        relationship: "opp",
        evidence: "growing",
        alignedDomain: "AI",
        opposedDomain: "Politics",
      }),
    );
    expect(s.sentence).toBe("You agree on AI, but clash on Politics.");
    expect(s.tone).toBe("opposed");
  });
  it("a still-forming pairing admits it's too early", () => {
    const s = personStory(base({ relationship: "neutral", evidence: "early", sharedBeliefs: 3 }));
    expect(s.stageLabel).toBe("Still forming");
    expect(s.sentence).toBe("Only 3 shared convictions — too early to know.");
  });
  it("the sentence never leads with a percentage", () => {
    for (const rel of ["twin", "tribe", "opp", "inverse", "neutral"] as const) {
      const s = personStory(base({ relationship: rel, evidence: "established" }));
      expect(s.sentence).not.toMatch(/^\d/);
      expect(s.sentence).not.toMatch(/%/);
    }
  });
});

describe("curiosity rank — the first card should make you wonder", () => {
  const rankOf = (o: Partial<PersonStoryInput>) => personStory(base(o)).rank;
  it("orders Twin > Tribe > Opp > recognizable > searching", () => {
    const twin = rankOf({ relationship: "twin", evidence: "established" });
    const tribe = rankOf({ relationship: "tribe", evidence: "established" });
    const opp = rankOf({ relationship: "opp", evidence: "established" });
    const recog = rankOf({ relationship: "neutral", evidence: "growing", sharedBeliefs: 6 });
    const searching = rankOf({
      relationship: "insufficient",
      evidence: "insufficient",
      sharedBeliefs: 0,
    });
    expect(twin).toBeGreaterThan(tribe);
    expect(tribe).toBeGreaterThan(opp);
    expect(opp).toBeGreaterThan(recog);
    expect(recog).toBeGreaterThan(searching);
  });
  it("a possible Twin outranks a named Tribe (curiosity, not certainty)", () => {
    expect(rankOf({ relationship: "twin", evidence: "growing" })).toBeGreaterThan(
      rankOf({ relationship: "tribe", evidence: "established" }),
    );
  });
});
