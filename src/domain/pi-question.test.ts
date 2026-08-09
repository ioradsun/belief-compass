import { describe, expect, it } from "vitest";
import { piQuestion, rationQuestions, questionAdds, type QuestionKind } from "./pi-question";
import type { VoiceInput } from "./pi-voice";

const clue = (over: Partial<VoiceInput["signals"]> = {}, rest: Partial<VoiceInput> = {}): VoiceInput => ({
  signals: {
    tension: 0,
    beforePrice: 0,
    unusual: 0,
    concentration: 0,
    reversing: 0,
    building: 0,
    nonresponse: 0,
    confirmation: 0,
    ...over,
  },
  informationGain: 0.4,
  ...rest,
});

describe("pi-question", () => {
  it("asks nothing on a receipt", () => {
    expect(
      piQuestion({
        key: "a",
        signal: clue({}, { informationGain: 0.01 }),
        headline: "BACKED YES",
        body: "Ana backed YES with $40.",
      }),
    ).toBeNull();
  });

  it("asks nothing when the vector is missing", () => {
    expect(piQuestion({ key: "a", signal: null, headline: "X", body: "Y" })).toBeNull();
  });

  it("asks the replacement question on people-up / capital-down", () => {
    const q = piQuestion({
      key: "row-1",
      signal: clue({ tension: 0.8 }, { tensionKind: "people_up_capital_down" }),
      headline: "MORE BELIEVERS. LESS CAPITAL",
      body: "6 people joined YES, but capital fell.",
    });
    expect(q?.kind).toBe("people_up_capital_down");
    expect(q?.text.endsWith("?")).toBe(true);
  });

  it("asks what moved the price when the crowd didn't", () => {
    const q = piQuestion({
      key: "row-2",
      signal: clue({ tension: 0.7 }, { tensionKind: "price_up_believers_flat" }),
      headline: "THE PRICE MOVED. THE CROWD DIDN'T.",
      body: "YES re-rated 9% with no new believers.",
    });
    expect(q?.kind).toBe("price_up_believers_flat");
  });

  it("stays silent once the clue is resolved — the facts answer it", () => {
    expect(
      piQuestion({
        key: "row-3",
        signal: clue({ tension: 0.8 }, { tensionKind: "capital_up_price_flat", clue: "resolved", provenMoveSinceInput: 0.09 }),
        headline: "MONEY IN, PRICE FLAT",
        body: "$300 entered YES.",
      }),
    ).toBeNull();
  });

  it("turns a person unwinding into a person-shaped question", () => {
    const q = piQuestion({
      key: "row-4",
      signal: clue({ concentration: 0.9 }, { concentrationKind: "largest_holder_left" }),
      headline: "KODAK IS BACKING AWAY",
      body: "Two positions cut in the last few hours.",
      pattern: "Backing away across three markets today.",
      actorName: "Kodak",
    });
    expect(q?.kind).toBe("person_unwinding");
    expect(q?.text).toContain("Kodak");
  });

  it("is deterministic per row", () => {
    const input = {
      key: "row-5",
      signal: clue({ nonresponse: 0.9 }),
      headline: "MONEY LANDED. NOTHING MOVED.",
      body: "$420 into NO four hours ago.",
    };
    expect(piQuestion(input)?.text).toBe(piQuestion(input)?.text);
  });

  it("drops a question that only echoes the row", () => {
    expect(questionAdds("Why here, and why today?", "Why here, and why today")).toBe(false);
    expect(questionAdds("Are smaller holders replacing someone bigger?", "MORE BELIEVERS. LESS CAPITAL")).toBe(true);
  });

  it("rations to one per shape and a hard window cap", () => {
    const rows = [
      { id: "a", kind: "nonresponse" as QuestionKind, gain: 0.9 },
      { id: "b", kind: "nonresponse" as QuestionKind, gain: 0.8 },
      { id: "c", kind: "before_price" as QuestionKind, gain: 0.7 },
      { id: "d", kind: "concentrating" as QuestionKind, gain: 0.6 },
      { id: "e", kind: "unusual" as QuestionKind, gain: 0.5 },
    ];
    const keep = rationQuestions(rows);
    expect(keep.size).toBe(3);
    expect(keep.has("a")).toBe(true);
    expect(keep.has("b")).toBe(false);
  });
});
