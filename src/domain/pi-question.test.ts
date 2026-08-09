import { describe, expect, it } from "vitest";
import { piQuestion, rationQuestions, questionAdds, type QuestionInput, type QuestionKind } from "./pi-question";
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

  it("charges repeated shapes, and lets exceptional evidence past the budget", () => {
    /* Insider is allowed to be curious more than three times an hour. What it
       is not allowed to do is ask the same shape over and over while a
       stronger clue below it stays silent — so a repeat is decayed, not
       banned, and clues above PREMIUM_GAIN sit outside the budget entirely. */
    const rows = [
      { id: "a", kind: "nonresponse" as QuestionKind, gain: 0.9, text: "a" },
      { id: "b", kind: "nonresponse" as QuestionKind, gain: 0.8, text: "b" },
      { id: "c", kind: "before_price" as QuestionKind, gain: 0.7, text: "c" },
      { id: "d", kind: "concentrating" as QuestionKind, gain: 0.2, text: "d" },
      { id: "e", kind: "unusual" as QuestionKind, gain: 0.15, text: "e" },
    ];
    const keep = rationQuestions(rows, 2);
    // The three premium clues are kept whatever the budget says…
    expect(keep.has("a")).toBe(true);
    expect(keep.has("b")).toBe(true);
    expect(keep.has("c")).toBe(true);
    // …and the ordinary budget is spent separately, on distinct shapes.
    expect(keep.has("d")).toBe(true);
    expect(keep.has("e")).toBe(true);

    // With no premium clues in the window, the budget is the whole story.
    const modest = rationQuestions(
      rows.map((r) => ({ ...r, gain: Math.min(r.gain, 0.5) })),
      2,
    );
    expect(modest.size).toBe(2);
    // Second "nonresponse" is decayed below the distinct shape beneath it.
    expect(modest.has("b")).toBe(false);
  });

});

describe("the person question does not depend on an unrelated missing field", () => {
  it("fires on a proven unwinding pattern with no concentration evidence", () => {
    const q = piQuestion({
      key: "row-6",
      signal: clue({}, { informationGain: 0.05 }),
      headline: "ANOTHER $0.02 ON NO",
      body: "Kodak added again.",
      pattern: "Stepped back from two questions this afternoon.",
      actorName: "Kodak",
    });
    expect(q?.kind).toBe("person_unwinding");
  });

  it("still refuses a person with no pattern behind them", () => {
    expect(
      piQuestion({
        key: "row-7",
        signal: clue({}, { informationGain: 0.05 }),
        headline: "ANOTHER $0.02 ON NO",
        body: "Kodak added again.",
        actorName: "Kodak",
      }),
    ).toBeNull();
  });
});

describe("no privileged knowledge, no expectation, no prediction", () => {
  const BANNED = /know something|knew something|what did they see|why hasn't this been priced|about to follow|learn(ed)? something/i;

  const strong = (o: Partial<VoiceInput["signals"]>, rest: Partial<VoiceInput> = {}) =>
    clue(o, { informationGain: 0.9, ...rest });

  const cases: QuestionInput[] = [
    { key: "1", signal: strong({ tension: 0.9 }, { tensionKind: "people_up_capital_down" }), headline: "H", body: "B" },
    { key: "2", signal: strong({ tension: 0.9 }, { tensionKind: "capital_up_price_flat" }), headline: "H", body: "B" },
    { key: "3", signal: strong({ tension: 0.9 }, { tensionKind: "price_up_believers_flat" }), headline: "H", body: "B" },
    { key: "4", signal: strong({ tension: 0.9 }, { tensionKind: "believers_left_price_rose" }), headline: "H", body: "B" },
    { key: "5", signal: strong({ tension: 0.9 }, { tensionKind: "whales_out_newcomers_in" }), headline: "H", body: "B" },
    { key: "6", signal: strong({ nonresponse: 0.9 }), headline: "H", body: "B" },
    { key: "7", signal: strong({ concentration: 0.9 }, { concentrationKind: "largest_holder_left" }), headline: "H", body: "B" },
    { key: "8", signal: strong({ concentration: 0.9 }, { concentrationKind: "newcomers_replaced_a_whale" }), headline: "H", body: "B" },
    { key: "9", signal: strong({ concentration: 0.9 }, { concentrationKind: "concentrating" }), headline: "H", body: "B" },
    { key: "10", signal: strong({ beforePrice: 0.9 }), headline: "H", body: "B" },
    /* UNUSUAL VOLUME NOW HAS TO COUNT SOMETHING. The old variant ("busier than
       this market has ever been") named no checkable number, so the shape is
       only asked when the trade count is known. */
    {
      key: "11",
      signal: strong({ unusual: 0.95 }),
      headline: "H",
      body: "B",
      unusual: { trades24h: 14 },
    },
  ];

  it("never implies hidden knowledge or predicts the next move", () => {
    for (const c of cases) {
      // every deterministic variant, not just the one this key happens to pick
      for (let i = 0; i < 12; i++) {
        const q = piQuestion({ ...c, key: `${c.key}-${i}` });
        if (q) expect(q.text, q.text).not.toMatch(BANNED);
      }
    }
  });

  it("every eligible shape still produces a question", () => {
    for (const c of cases) expect(piQuestion(c), c.key).not.toBeNull();
  });
});
