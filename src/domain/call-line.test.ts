import { describe, it, expect } from "vitest";
import { callLine, CALL_LINE_BANNED, type CallLineInput } from "./call-line";

const call = (over: Partial<CallLineInput> = {}): CallLineInput => ({
  name: "Sarah",
  act: "trade",
  side: "YES",
  marketId: 7,
  callerWallet: "0xabc",
  ...over,
});

/** Every line the module can emit, across the whole input space. */
const corpus = (): string[] => {
  const out: string[] = [];
  for (const act of ["trade", "market_created"] as const)
    for (const side of ["YES", "NO", null] as const)
      for (let m = 1; m <= 40; m++)
        for (const w of ["0xabc", "0xdef", "0x123"]) {
          const l = callLine(call({ act, side, marketId: m, callerWallet: w }));
          if (l) out.push(l);
        }
  return out;
};

describe("a call reads differently every time", () => {
  it("produces real variety rather than one sentence with a name swapped", () => {
    // The defect: six open Challenges all reading "X, your Tribe, took YES.
    // What's your call?" — identical rows the eye stops reading.
    expect(new Set(corpus()).size).toBeGreaterThan(30);
  });

  it("states a BELIEF, never a transaction", () => {
    // "Sarah took YES" describes what happened at the contract; "Sarah believes
    // YES" describes the person. Challenge is one person's conviction reaching
    // another, so the clause names what they HOLD.
    for (const l of corpus())
      for (const w of ["took", "backed", "bought", "went ", "is already in on", "put $"])
        expect(l.toLowerCase(), `"${l}" describes a transaction`).not.toContain(w);
  });

  it("uses the plain form somewhere — this is the sentence the product means", () => {
    expect(corpus().some((l) => /\bbelieves (YES|NO)\./.test(l))).toBe(true);
  });

  it("is stable — the same call always reads the same", () => {
    const once = callLine(call());
    for (let i = 0; i < 50; i++) expect(callLine(call())).toBe(once);
  });

  it("does not let the belief and the pull move together", () => {
    // Drawn from two independent parts of the hash, so two calls from the same
    // person do not rhyme.
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

/**
 * THE INVARIANT THIS WHOLE MODULE NOW RESTS ON.
 *
 * A Challenge means: I saw this, and I want to know where you land. Answering YES
 * and answering NO satisfy it identically. So the sentence must not argue about
 * agreement — and the strongest way to guarantee that is to give it no way to
 * know the relationship at all.
 */
describe("Challenge is side-blind, and the type enforces it", () => {
  it("cannot see the relationship, the shared record, or the match", () => {
    // Not merely "does not use" — CANNOT. A sentence with no channel to the
    // relationship cannot drift back into arguing about it, however the copy is
    // rewritten later. These keys are absent from CallLineInput by design.
    const keys = Object.keys(call());
    for (const forbidden of ["relation", "together", "shared", "match"])
      expect(keys, `CallLineInput must not accept "${forbidden}"`).not.toContain(forbidden);
  });

  it("never frames the call as being about agreeing or disagreeing", () => {
    // The two clauses this replaced, verbatim: "This could be the one you split
    // on" and "Agreeing here would be new". Both said the interesting outcome
    // was a particular answer. Neither is a thing a Challenge asks.
    for (const l of corpus())
      for (const w of [
        "agree",
        "disagree",
        "split on",
        "same way",
        "rarely land",
        "usually land",
        "conclusions",
        "tribe",
        "rival",
      ])
        expect(l.toLowerCase(), `"${l}" frames this as agreement`).not.toContain(w);
  });

  it("asks for a position, not for a match", () => {
    expect(corpus().some((l) => l.includes("Take this one."))).toBe(true);
  });

  it("reads the same to every caller, whatever the relationship", () => {
    // Two callers differ only by wallet, which is the hash seed — never by
    // relation, because relation is not an input.
    const a = callLine(call({ callerWallet: "0xaaa" }));
    const b = callLine(call({ callerWallet: "0xaaa" }));
    expect(a).toBe(b);
  });
});

describe("what it refuses to say", () => {
  it("never taunts and never manufactures urgency", () => {
    for (const l of corpus())
      for (const w of CALL_LINE_BANNED)
        expect(l.toLowerCase(), `"${l}" contains "${w}"`).not.toContain(w);
  });

  it("never quotes the arithmetic, because the card prints it one line below", () => {
    for (const l of corpus()) expect(l, `"${l}" quotes a record`).not.toMatch(/\d+\s+of\s+\d+/);
  });

  it("uses no pronoun for the caller", () => {
    for (const l of corpus()) expect(l).not.toMatch(/\b(he|she|him|her|his|hers|they|them)\b/i);
  });

  it("never opens the pull with a conjunction", () => {
    for (const l of corpus()) {
      const [, ...rest] = l.split(". ");
      for (const pull of rest) expect(pull, `"${l}"`).not.toMatch(/^(And|But|So|Yet)\b/);
    }
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
    const l = callLine(call({ act: "market_created", side: null }));
    expect(l).toBeTruthy();
    expect(l).not.toMatch(/YES|NO/);
  });

  it("never states a side the reader has not taken", () => {
    for (const l of corpus()) expect(l).not.toMatch(/other side|your YES|your NO/i);
  });
});
