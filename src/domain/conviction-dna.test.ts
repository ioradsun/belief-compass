import { describe, expect, it } from "vitest";
import {
  DNA_STAGE_HEADLINE,
  DNA_STAGE_LABEL,
  DNA_PROMISE,
  decisionsToNextStage,
  dnaReveal,
  dnaStage,
  firstMeaningfulIndex,
  matchCountLine,
  stageAtLeast,
  type RevealCandidate,
} from "@/domain/conviction-dna";

describe("dnaStage", () => {
  it("moves through the volume-driven stages", () => {
    expect(dnaStage({ decisions: 0, hasTwinCandidate: false })).toBe("unmapped");
    expect(dnaStage({ decisions: 1, hasTwinCandidate: false })).toBe("forming");
    expect(dnaStage({ decisions: 4, hasTwinCandidate: false })).toBe("forming");
    expect(dnaStage({ decisions: 5, hasTwinCandidate: false })).toBe("recognizable");
    expect(dnaStage({ decisions: 14, hasTwinCandidate: false })).toBe("recognizable");
    expect(dnaStage({ decisions: 15, hasTwinCandidate: false })).toBe("distinct");
    expect(dnaStage({ decisions: 39, hasTwinCandidate: false })).toBe("distinct");
    expect(dnaStage({ decisions: 40, hasTwinCandidate: false })).toBe("stable");
  });

  it("only reaches Twin Ready when a Twin actually exists", () => {
    expect(dnaStage({ decisions: 200, hasTwinCandidate: false })).toBe("stable");
    expect(dnaStage({ decisions: 40, hasTwinCandidate: true })).toBe("twin_ready");
  });

  it("keeps a deep-but-narrow pattern at distinct when breadth is known", () => {
    expect(dnaStage({ decisions: 80, hasTwinCandidate: true, categories: 2 })).toBe("distinct");
    expect(dnaStage({ decisions: 80, hasTwinCandidate: true, categories: 3 })).toBe("twin_ready");
    // Unknown breadth never blocks — an honest stage still comes from volume.
    expect(dnaStage({ decisions: 80, hasTwinCandidate: false })).toBe("stable");
  });

  it("floors and clamps the decision count", () => {
    expect(dnaStage({ decisions: -5, hasTwinCandidate: false })).toBe("unmapped");
    expect(dnaStage({ decisions: 4.9, hasTwinCandidate: false })).toBe("forming");
  });
});

describe("stageAtLeast", () => {
  it("orders the stages", () => {
    expect(stageAtLeast("recognizable", "forming")).toBe(true);
    expect(stageAtLeast("forming", "recognizable")).toBe(false);
    expect(stageAtLeast("twin_ready", "twin_ready")).toBe(true);
  });
});

describe("decisionsToNextStage", () => {
  it("counts down to the next volume stage", () => {
    expect(decisionsToNextStage(0)).toEqual({ next: "forming", need: 1 });
    expect(decisionsToNextStage(3)).toEqual({ next: "recognizable", need: 2 });
    expect(decisionsToNextStage(14)).toEqual({ next: "distinct", need: 1 });
    expect(decisionsToNextStage(30)).toEqual({ next: "stable", need: 10 });
  });

  it("returns null past the count-driven stages", () => {
    expect(decisionsToNextStage(40)).toBeNull();
    expect(decisionsToNextStage(500)).toBeNull();
  });
});

describe("dnaReveal", () => {
  it("names nothing before a recognizable pattern", () => {
    const r = dnaReveal("forming", { twin: 2, tribe: 5, opp: 3 });
    expect(r).toEqual({ canNameTribe: false, canNameOpp: false, canNameTwin: false });
  });

  it("names Tribe / Opp once recognizable and a real match exists", () => {
    expect(dnaReveal("recognizable", { twin: 0, tribe: 2, opp: 0 })).toMatchObject({
      canNameTribe: true,
      canNameOpp: false,
    });
    expect(dnaReveal("distinct", { twin: 0, tribe: 0, opp: 1 })).toMatchObject({
      canNameOpp: true,
    });
  });

  it("names a Twin only at Twin Ready with a real Twin", () => {
    expect(dnaReveal("stable", { twin: 1, tribe: 0, opp: 0 }).canNameTwin).toBe(false);
    expect(dnaReveal("twin_ready", { twin: 1, tribe: 0, opp: 0 }).canNameTwin).toBe(true);
    expect(dnaReveal("twin_ready", { twin: 0, tribe: 0, opp: 0 }).canNameTwin).toBe(false);
  });
});

describe("matchCountLine", () => {
  it("is honest about zero and never inflates", () => {
    expect(matchCountLine(0, "Tribe member")).toBe("No Tribe members yet");
    expect(matchCountLine(1, "Opp")).toBe("1 Opp");
    expect(matchCountLine(4, "Opp")).toBe("4 Opps");
    expect(matchCountLine(-3, "Twin")).toBe("No Twins yet");
  });
});

describe("firstMeaningfulIndex", () => {
  const P = (
    relationship: RevealCandidate["relationship"],
    sharedBeliefs: number,
    agreement: number,
  ): RevealCandidate => ({ relationship, sharedBeliefs, agreement });

  it("reveals no one before a recognizable pattern", () => {
    expect(firstMeaningfulIndex([P("tribe", 8, 90)], "forming")).toBe(-1);
  });

  it("requires real shared evidence behind the person", () => {
    expect(firstMeaningfulIndex([P("tribe", 2, 90)], "recognizable")).toBe(-1);
    expect(firstMeaningfulIndex([P("tribe", 3, 90)], "recognizable")).toBe(0);
  });

  it("prefers the strongest relationship", () => {
    const people = [P("opp", 10, 20), P("tribe", 5, 80), P("twin", 4, 95)];
    expect(firstMeaningfulIndex(people, "distinct")).toBe(2);
  });

  it("ignores neutral / insufficient people", () => {
    expect(firstMeaningfulIndex([P("neutral", 20, 55), P("insufficient", 20, 50)], "stable")).toBe(
      -1,
    );
  });
});

describe("consumer copy stays clean", () => {
  it("uses no banned terms or numbers in stage copy", () => {
    const banned = /wallet|address|vector|embed|calibrat|algorithm|\bprobab|\d|%/i;
    for (const s of Object.values(DNA_STAGE_LABEL)) expect(s).not.toMatch(banned);
    for (const s of Object.values(DNA_STAGE_HEADLINE)) expect(s).not.toMatch(banned);
    expect(DNA_PROMISE).not.toMatch(banned);
  });
});
