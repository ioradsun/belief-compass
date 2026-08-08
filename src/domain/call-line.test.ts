import { describe, it, expect } from "vitest";
import { callLine, CALL_LINE_BANNED, type CallLineInput } from "./call-line";
import { CALLER_RELATIONS } from "./challenge";

const call = (over: Partial<CallLineInput> = {}): CallLineInput => ({
  name: "Sarah",
  relation: "tribe",
  act: "trade",
  side: "YES",
  together: 9,
  shared: 11,
  marketId: 7,
  callerWallet: "0xabc",
  ...over,
});

/** Every line the module can emit, across the whole input space. */
const corpus = (): string[] => {
  const out: string[] = [];
  for (const relation of CALLER_RELATIONS)
    for (const act of ["trade", "market_created"] as const)
      for (const side of ["YES", "NO", null] as const)
        for (const [together, shared] of [
          [9, 11],
          [2, 9],
          [0, 8],
          [8, 8],
          [1, 1],
          [null, null],
        ] as const)
          for (let m = 1; m <= 40; m++)
            for (const w of ["0xabc", "0xdef", "0x123"]) {
              const l = callLine(
                call({ relation, act, side, together, shared, marketId: m, callerWallet: w }),
              );
              if (l) out.push(l);
            }
  return out;
};

describe("a call reads differently every time", () => {
  it("produces real variety rather than one sentence with a name swapped", () => {
    // The defect: six open Challenges all reading "X, your Tribe, took YES.
    // What's your call?" — identical rows the eye stops reading.
    const distinct = new Set(corpus());
    expect(distinct.size).toBeGreaterThan(30);
  });

  it("states a BELIEF, never a transaction", () => {
    // "Sarah took YES" describes what happened at the contract; "Sarah believes
    // YES" describes the person. Challenge is one person's conviction reaching
    // another, so the clause names what they HOLD — which is the thing the
    // reader is actually being asked to answer.
    for (const l of corpus())
      for (const w of ["took", "backed", "bought", "went ", "is already in on", "put $"])
        expect(l.toLowerCase(), `"${l}" describes a transaction`).not.toContain(w);
  });

  it("uses the plain form somewhere — this is the sentence the product means", () => {
    expect(corpus().some((l) => /\bbelieves (YES|NO)\./.test(l))).toBe(true);
  });

  it("varies across markets for the same person", () => {
    const lines = new Set(
      Array.from({ length: 12 }, (_, i) => callLine(call({ marketId: i + 1 }))),
    );
    expect(lines.size).toBeGreaterThan(3);
  });

  it("varies across people in the same market", () => {
    const lines = new Set(
      ["0xa", "0xb", "0xc", "0xd", "0xe", "0xf"].map((w) =>
        callLine(call({ callerWallet: w, name: "Sarah" })),
      ),
    );
    expect(lines.size).toBeGreaterThan(2);
  });

  it("is stable — the same call always reads the same", () => {
    // A sentence that reshuffled on every poll would look broken, and would make
    // the surface feel generated rather than observed.
    const once = callLine(call());
    for (let i = 0; i < 50; i++) expect(callLine(call())).toBe(once);
  });

  it("does not let the act and the pull move together", () => {
    // Drawn from two independent parts of the hash, so two calls from the same
    // person do not rhyme. If they shared a draw, act and pull would be locked.
    const pairs = new Set(
      Array.from({ length: 24 }, (_, i) => {
        const l = callLine(call({ marketId: i + 1 })) as string;
        const [act, ...rest] = l.split(". ");
        return `${act}|${rest.join(". ")}`;
      }),
    );
    const acts = new Set([...pairs].map((p) => p.split("|")[0]));
    const pulls = new Set([...pairs].map((p) => p.split("|")[1]));
    expect(pairs.size).toBeGreaterThan(Math.max(acts.size, pulls.size));
  });
});

describe("the pull is about THIS pair, not about markets in general", () => {
  it("never quotes the arithmetic, because the card prints it one line below", () => {
    // The card renders "82% Conviction Match · 9 of 11 together" directly under
    // this sentence. A pull that also said "You've landed together 9 of 11
    // times" put the same numbers on screen twice, one line apart, for every
    // pair past MATURE_MIN_SHARED. The evidence line owns the count; this
    // sentence owns what the count MEANS.
    for (const l of corpus()) expect(l, `"${l}" quotes the record`).not.toMatch(/\d+\s+of\s+\d+/);
  });

  it("still claims a pattern only when there is history behind it", () => {
    // "You two usually land the same way" is a claim about a record and needs
    // one. 1 of 1 is the modal pair on this platform, and letting it earn that
    // sentence would be the same false precision the People card refuses.
    const thin = new Set(
      Array.from({ length: 40 }, (_, i) =>
        callLine(call({ relation: "tribe", together: 1, shared: 1, marketId: i + 1 })),
      ),
    );
    for (const l of thin) expect(l).not.toMatch(/usually land|rarely land|would be new/);
  });

  it("says something different to an aligned pair than to an opposed one", () => {
    const aligned = new Set(
      Array.from({ length: 40 }, (_, i) => callLine(call({ relation: "tribe", marketId: i + 1 }))),
    );
    const opposed = new Set(
      Array.from({ length: 40 }, (_, i) => callLine(call({ relation: "opp", marketId: i + 1 }))),
    );
    // The whole point: a Twin who agrees with you nine times in eleven and a
    // Rival who almost never does are different social events.
    for (const l of aligned) expect(opposed.has(l)).toBe(false);
  });

  it("gives an opposed caller a reason that is warm, not a taunt", () => {
    const opposed = Array.from(
      { length: 40 },
      (_, i) => callLine(call({ relation: "opp", marketId: i + 1 })) as string,
    );
    expect(opposed.some((l) => /rarely land|would be new|being asked for/.test(l))).toBe(true);
  });

  it("never opens the pull with a conjunction", () => {
    // The two clauses are drawn independently, so any pull may follow any
    // belief. "And still wants your read." dangles off whatever came before it
    // with no subject of its own — every fragment has to stand up alone.
    for (const l of corpus()) {
      const [, ...rest] = l.split(". ");
      for (const pull of rest) expect(pull, `"${l}"`).not.toMatch(/^(And|But|So|Yet)\b/);
    }
  });
});

describe("what it refuses to say", () => {
  it("never taunts and never manufactures urgency", () => {
    // A Rival reaches different conclusions; they are not an opponent to defeat.
    // And this product has no closing bell, so urgency words would be inventing
    // pressure that does not exist.
    for (const l of corpus())
      for (const w of CALL_LINE_BANNED)
        expect(l.toLowerCase(), `"${l}" contains "${w}"`).not.toContain(w);
  });

  it("uses no pronoun for the caller", () => {
    // A name does not tell you someone's pronouns, and "they" reads oddly beside
    // a single named person mid-sentence. Every fragment names or addresses.
    for (const l of corpus()) expect(l).not.toMatch(/\b(he|she|him|her|his|hers|they|them)\b/i);
  });

  it("emits a real corpus, so these guards are not vacuously passing", () => {
    expect(corpus().length).toBeGreaterThan(500);
  });
});

describe("the rule it inherits: no reason, no row", () => {
  it("refuses a caller it cannot name", () => {
    for (const name of ["", "   "]) expect(callLine(call({ name }))).toBeNull();
  });

  it("refuses a trade whose side it cannot state", () => {
    expect(callLine(call({ side: null }))).toBeNull();
    expect(callLine(call({ side: "MIXED" as unknown as "YES" }))).toBeNull();
  });

  it("needs no side for a question somebody asked", () => {
    // Creating a market stakes the question, not an answer to it.
    const l = callLine(call({ act: "market_created", side: null }));
    expect(l).toBeTruthy();
    expect(l).not.toMatch(/YES|NO/);
  });

  it("never states a side the reader has not taken", () => {
    // The Challenge surface targets markets the viewer has NOT answered, so
    // there is no "other side" to reference. Inherited verbatim from reasonFor.
    for (const l of corpus()) expect(l).not.toMatch(/other side|your YES|your NO/i);
  });

  it("survives a broken payload rather than claiming a pattern from it", () => {
    // together > shared cannot happen from one score. It must not be treated as
    // deep history — a payload that cannot be reconciled earns no claim about
    // how this pair usually lands.
    for (let m = 1; m <= 20; m++) {
      const l = callLine(call({ together: 12, shared: 3, marketId: m })) as string;
      expect(l).not.toMatch(/usually land|rarely land|would be new/);
    }
  });
});
