import { describe, it, expect } from "vitest";
import { composeClues, type ClueRow } from "./composed-clue";
import {
  questionBudget,
  rationQuestions,
  MIN_QUESTION_BUDGET,
  PREMIUM_GAIN,
  type QuestionKind,
} from "./pi-question";

const at = (h: number) => new Date(Date.UTC(2026, 7, 9, h, 0, 0)).toISOString();
const row = (r: Partial<ClueRow> & { id: string }): ClueRow => ({
  marketId: "m1",
  occurredAt: at(10),
  ...r,
});

/** No question may claim knowledge, causation, or a future price. */
const BANNED =
  /what do they know|what did they see|know something|priced in|about to|will (?:rise|fall|move)|insiders|should you|guaranteed|because they/i;

describe("a clue assembled from several rows", () => {
  it("earns a question no constituent receipt could earn alone", () => {
    // Three plain receipts. Individually: three people bought. Together: a side
    // that was empty an hour ago is now populated.
    const clues = composeClues([
      row({ id: "a", wallet: "0x1", side: "YES", action: "enter", occurredAt: at(10) }),
      row({ id: "b", wallet: "0x2", side: "YES", action: "enter", occurredAt: at(10) }),
      row({ id: "c", wallet: "0x3", side: "YES", action: "enter", occurredAt: at(11) }),
    ]);
    expect(clues).toHaveLength(1);
    expect(clues[0]!.kind).toBe("side_burst");
    expect(clues[0]!.text).toBe("3 people took YES inside an hour. One burst, or the start of a crowd?");
    expect(clues[0]!.members).toHaveLength(3);
  });

  it("hangs the question on a row the reader can still see", () => {
    // The two exits were absorbed into a promoted behavioural story; only the
    // flip survives, so only the flip may carry the question.
    const clues = composeClues([
      row({ id: "gone1", wallet: "0x1", action: "exit", occurredAt: at(9), surviving: false }),
      row({ id: "gone2", wallet: "0x1", marketId: "m2", action: "exit", occurredAt: at(11), surviving: false }),
      row({ id: "alive", wallet: "0x1", marketId: "m3", action: "flip", occurredAt: at(10) }),
    ]);
    expect(clues[0]!.rowId).toBe("alive");
    expect(clues[0]!.kind).toBe("person_repositioning");
  });

  it("lets a person repositioning ask, and matches the words to the evidence", () => {
    const selling = composeClues([
      row({ id: "a", wallet: "0x1", action: "exit", occurredAt: at(9) }),
      row({ id: "b", wallet: "0x1", marketId: "m2", action: "exit", occurredAt: at(10) }),
      row({ id: "c", wallet: "0x1", marketId: "m2", action: "reduce", occurredAt: at(11) }),
    ])[0]!;
    // Nothing was bought, so it may not say "into another".
    expect(selling.text).not.toMatch(/into/i);
    expect(selling.text).toMatch(/2 positions cut|3 changes/);

    const moving = composeClues([
      row({ id: "a", wallet: "0x1", marketTitle: "Will Pump.fun stay top 3?", action: "exit", occurredAt: at(9) }),
      row({ id: "b", wallet: "0x1", marketId: "m2", marketTitle: "Will gaming tokens win Q4?", action: "enter", side: "YES", occurredAt: at(10) }),
    ])[0]!;
    expect(moving.kind).toBe("person_rotation");
    expect(moving.text).toBe("Out of Pump.fun, into gaming. A new read, or the same money looking for a home?");
  });

  it("asks who the weight really is when arrivals are lopsided", () => {
    const clue = composeClues([
      row({ id: "a", wallet: "0x1", side: "NO", action: "enter", amountUsd: 200, occurredAt: at(10) }),
      row({ id: "b", wallet: "0x2", side: "NO", action: "enter", amountUsd: 24, occurredAt: at(14) }),
      row({ id: "c", wallet: "0x3", side: "NO", action: "enter", amountUsd: 20, occurredAt: at(18) }),
    ]).find((c) => c.kind === "capital_concentrated_arrival");
    expect(clue?.text).toBe("3 wallets, $244. Is the weight spread out, or mostly one person?");
  });

  it("notices the reader's own people moving together, without instructing them", () => {
    const clue = composeClues([
      row({ id: "a", wallet: "0x1", relationship: "tribe", side: "NO", action: "enter" }),
      row({ id: "b", wallet: "0x2", relationship: "rival", side: "NO", action: "enter", occurredAt: at(11) }),
    ]).find((c) => c.kind === "network_convergence");
    expect(clue?.text).toContain("2 of your people landed on the same side");
    expect(clue?.text).not.toMatch(/you should|follow them|get in/i);
  });

  it("says nothing about bare receipts", () => {
    // One person, one action — and a crowd row with no actor.
    expect(composeClues([row({ id: "a", wallet: "0x1", action: "enter" })])).toEqual([]);
    expect(composeClues([row({ id: "a" }), row({ id: "b", marketId: "m2" })])).toEqual([]);
  });

  it("says nothing about a market that merely exists and was ignored", () => {
    expect(
      composeClues([
        row({ id: "made", kind: "market_created", wallet: "0x9", occurredAt: at(3) }),
      ]),
    ).toEqual([]);
  });

  it("is deterministic", () => {
    const rows = [
      row({ id: "a", wallet: "0x1", action: "exit", occurredAt: at(9) }),
      row({ id: "b", wallet: "0x1", marketId: "m2", action: "enter", side: "YES", occurredAt: at(10) }),
    ];
    expect(composeClues(rows)).toEqual(composeClues(rows));
  });

  it("never implies hidden knowledge or predicts a price", () => {
    const everything = composeClues([
      row({ id: "a", wallet: "0x1", side: "YES", action: "enter", amountUsd: 300, occurredAt: at(9) }),
      row({ id: "b", wallet: "0x2", side: "YES", action: "enter", amountUsd: 20, occurredAt: at(9) }),
      row({ id: "c", wallet: "0x3", side: "YES", action: "enter", amountUsd: 20, occurredAt: at(10), relationship: "tribe" }),
      row({ id: "d", wallet: "0x4", side: "NO", action: "enter", relationship: "rival", occurredAt: at(10) }),
      row({ id: "e", wallet: "0x1", marketId: "m2", action: "exit", occurredAt: at(11) }),
    ]);
    expect(everything.length).toBeGreaterThan(0);
    for (const c of everything) expect(c.text).not.toMatch(BANNED);
  });
});

describe("the editorial budget", () => {
  it("grows with the size of the window instead of stopping at three", () => {
    expect(questionBudget(6)).toBe(MIN_QUESTION_BUDGET);
    expect(questionBudget(25)).toBe(5);
    expect(questionBudget(30)).toBe(6);
    // A genuinely anomalous window is allowed more.
    expect(questionBudget(25, 5)).toBe(7);
    expect(questionBudget(200, 20)).toBeLessThanOrEqual(9);
  });

  it("lets a rich feed ask more than three questions", () => {
    const cands = Array.from({ length: 8 }, (_, i) => ({
      id: `r${i}`,
      kind: ["people_up_capital_down", "side_burst", "creator_pickup", "in_and_out"][i % 4] as QuestionKind,
      gain: 0.5 - i * 0.01,
      text: `question ${i}`,
    }));
    expect(rationQuestions(cands, questionBudget(25)).size).toBe(5);
  });

  it("charges a repeated shape but does not ban it", () => {
    const keep = rationQuestions(
      [
        { id: "a", kind: "side_burst", gain: 0.5, text: "one" },
        { id: "b", kind: "side_burst", gain: 0.48, text: "two" },
        { id: "c", kind: "in_and_out", gain: 0.2, text: "three" },
      ],
      3,
    );
    // The weaker distinct shape outranks the decayed repeat, but the repeat is
    // strong enough to still make the window.
    expect(keep).toEqual(new Set(["a", "c", "b"]));
  });

  it("never prints the same sentence twice", () => {
    const keep = rationQuestions(
      [
        { id: "a", kind: "unusual", gain: 0.3, text: "What is different about it?" },
        { id: "b", kind: "unusual", gain: 0.29, text: "What is different about it?" },
      ],
      5,
    );
    expect([...keep]).toEqual(["a"]);
  });

  it("keeps a premium clue even when the budget is spent", () => {
    const keep = rationQuestions(
      [
        { id: "weak1", kind: "unusual", gain: 0.4, text: "a" },
        { id: "weak2", kind: "side_burst", gain: 0.39, text: "b" },
        { id: "weak3", kind: "in_and_out", gain: 0.38, text: "c" },
        { id: "premium", kind: "network_split", gain: PREMIUM_GAIN + 0.05, text: "d" },
      ],
      3,
    );
    expect(keep.has("premium")).toBe(true);
    expect(keep.size).toBeGreaterThan(3);
  });

  it("refuses to fill the budget with filler", () => {
    const keep = rationQuestions(
      [{ id: "a", kind: "unusual", gain: 0.02, text: "a" }, { id: "b", kind: "unusual", gain: 0.01, text: "b" }],
      5,
    );
    expect(keep.size).toBe(0);
  });
});
