/**
 * SEMANTIC QUESTION INVARIANTS.
 *
 * These are the guardrails from the spec, written as tests because they are the
 * only thing standing between "the PI notices what the market is about" and "the
 * PI editorialises". Each one is a rule the feature is allowed to lose a
 * question to, never one it may talk its way past.
 */
import { describe, expect, it } from "vitest";
import {
  semanticQuestion,
  isPropositionSpecific,
  containsBannedLanguage,
  looksLikeAJoke,
  proposition,
  stakeInTitle,
  BANNED_QUESTION_PATTERNS,
  MAX_QUESTION_CHARS,
} from "./semantic-question";

const DATA = "Is selling your data worth a $20 airdrop?";

describe("proposition parsing", () => {
  it("reduces a title to the thing being argued about", () => {
    expect(proposition(DATA)).toBe("selling your data worth a $20 airdrop");
  });
  it("declines titles too short to carry a sentence", () => {
    expect(proposition("Will it?")).toBeNull();
    expect(proposition("Up or down")).toBeNull();
  });
  it("finds a stake named in the proposition", () => {
    expect(stakeInTitle(DATA)).toBe("$20");
    expect(stakeInTitle("Will ETH flip BTC?")).toBeNull();
  });
});

describe("guardrail: state first", () => {
  it("says nothing without a title", () => {
    expect(semanticQuestion({ key: "a", title: null, state: "side_emptied", side: "NO" })).toBeNull();
    expect(semanticQuestion({ key: "a", title: "   ", state: "side_emptied", side: "NO" })).toBeNull();
  });

  it("requires proven tenure before claiming persistence", () => {
    const base = { key: "a", title: DATA, state: "one_sided_persistence", side: "YES" } as const;
    expect(semanticQuestion({ ...base, facts: { days: 3 } })).toBeNull();
    expect(semanticQuestion({ ...base, facts: { days: 15 } })).toContain("15 days");
  });

  it("requires proven silence before claiming a reawakening", () => {
    const base = { key: "a", title: DATA, state: "back_from_dead", side: null } as const;
    expect(semanticQuestion({ ...base, facts: { quietDays: 1, trades: 4 } })).toBeNull();
    expect(semanticQuestion({ ...base, facts: { quietDays: 9, trades: 4 } })).toBeTruthy();
  });

  it("only calls a book lopsided when the light side is rounding error", () => {
    const base = { key: "a", title: DATA, state: "lopsided_book", side: "YES" } as const;
    // Real money on both sides is a market, not a shape.
    expect(semanticQuestion({ ...base, facts: { leadUsd: 400, laggardUsd: 180 } })).toBeNull();
    // Too little money anywhere for the contrast to mean anything.
    expect(semanticQuestion({ ...base, facts: { leadUsd: 10, laggardUsd: 0 } })).toBeNull();
    expect(semanticQuestion({ ...base, facts: { leadUsd: 400, laggardUsd: 2 } })).toBeTruthy();
  });
});

describe("guardrail: curiosity, never certainty", () => {
  it("blocks motive, private knowledge and price prediction", () => {
    expect(containsBannedLanguage("What do they know that the price doesn't?")).toBe(true);
    expect(containsBannedLanguage("Is the price about to move?")).toBe(true);
    expect(containsBannedLanguage("Smart money is leaving.")).toBe(true);
    expect(containsBannedLanguage("Nobody is backing NO anymore. Is $20 enough?")).toBe(false);
  });

  it("no shipped question trips a banned pattern", () => {
    const cases = [
      { state: "side_emptied", side: "NO", facts: {} },
      { state: "one_sided_persistence", side: "YES", facts: { days: 21 } },
      { state: "lopsided_book", side: "YES", facts: { leadUsd: 900, laggardUsd: 1 } },
      { state: "side_got_company", side: "NO", facts: { days: 8 } },
      { state: "back_from_dead", side: null, facts: { quietDays: 12, trades: 3 } },
    ] as const;
    for (const c of cases) {
      for (const key of ["k1", "k2", "k3", "k4", "k5"]) {
        const q = semanticQuestion({ key, title: DATA, ...c });
        expect(q).toBeTruthy();
        for (const re of BANNED_QUESTION_PATTERNS) expect(re.test(q!)).toBe(false);
      }
    }
  });
});

describe("guardrail: specific or silent", () => {
  it("rejects a question that could sit under any market", () => {
    expect(isPropositionSpecific("Is something changing here?", DATA)).toBe(false);
    expect(isPropositionSpecific("Is $20 really enough?", DATA)).toBe(true);
    expect(isPropositionSpecific("Did “selling your data worth a $20 airdrop” stop?", DATA)).toBe(true);
  });

  it("every shipped question carries wording from its own proposition", () => {
    const q = semanticQuestion({ key: "x", title: DATA, state: "side_emptied", side: "NO" })!;
    expect(isPropositionSpecific(q, DATA)).toBe(true);
    // ...and would NOT pass under an unrelated market.
    expect(isPropositionSpecific(q, "Will the Fed cut rates in March?")).toBe(false);
  });
});

describe("guardrail: some markets deserve silence", () => {
  it("declines joke propositions", () => {
    expect(looksLikeAJoke("Would you rather fight one horse-sized duck?")).toBe(true);
    expect(looksLikeAJoke(DATA)).toBe(false);
    expect(
      semanticQuestion({
        key: "a",
        title: "Would you rather fight one horse-sized duck or 100 duck-sized horses?",
        state: "side_emptied",
        side: "NO",
      }),
    ).toBeNull();
  });
});

describe("the champagne case", () => {
  it("turns an empty side plus a priced proposition into the reader's own question", () => {
    const q = semanticQuestion({ key: "row-1", title: DATA, state: "side_emptied", side: "NO" })!;
    expect(q).toMatch(/\$20/);
    expect(q).toMatch(/NO/);
    expect(q.endsWith("?")).toBe(true);
  });

  it("is deterministic — the same row always asks the same question", () => {
    const of = (key: string) =>
      semanticQuestion({ key, title: DATA, state: "side_emptied", side: "NO" });
    expect(of("row-1")).toBe(of("row-1"));
    // ...but the corpus is not one sentence repeated.
    const all = new Set(["a", "b", "c", "d", "e", "f"].map(of));
    expect(all.size).toBeGreaterThan(1);
  });

  it("never mangles the proposition it quotes", () => {
    const q = semanticQuestion({
      key: "row-2",
      title: DATA,
      state: "side_got_company",
      side: "NO",
      facts: { days: 9 },
    })!;
    // The fragment is quoted, not spliced bare into the grammar.
    expect(q).toMatch(/“selling your data worth a \$20 airdrop”/);
  });
});

/**
 * THE HEADLINE IS ALREADY ON SCREEN.
 *
 * A question that quotes the whole proposition back is the tape repeating
 * itself at double length: "Nothing for 7 days and now this. Did something
 * change about “if you suddenly became rich, would you still work”, or just
 * the attention on it?" The quoted topic is a HANDLE, never a second copy —
 * and for a dormancy row it is not needed at all, because the proposition is
 * printed directly above the question.
 */
describe("a question is a handle on the headline, not a copy of it", () => {
  const LONG = "If you suddenly became rich, would you still work?";
  const back = (title: string) =>
    semanticQuestion({
      key: "k1",
      title,
      state: "back_from_dead",
      side: "YES",
      facts: { quietDays: 7, trades: 3 },
    });

  it("asks about the silence instead of quoting the proposition", () => {
    const q = back(LONG)!;
    expect(q).toBeTruthy();
    expect(q).not.toMatch(/would you still work/);
    expect(q).not.toMatch(/became rich/);
    expect(q).toMatch(/7/);
  });

  it("never ships a question longer than the cap", () => {
    for (const title of [
      LONG,
      "Will the committee, after months of deliberation and public pressure, finally publish the full report before the end of the year?",
      "Is selling your data worth a $20 airdrop?",
    ]) {
      const q = back(title);
      if (q) expect(q.length).toBeLessThanOrEqual(MAX_QUESTION_CHARS);
    }
  });

  it("stays human under a sprawling proposition rather than quoting it", () => {
    const q = back(
      "Will the committee, after months of deliberation and public pressure, finally publish the full report before the end of the year?",
    )!;
    expect(q).toBeTruthy();
    expect(q).not.toMatch(/committee/);
  });

  it("still refuses to speak on a joke market", () => {
    expect(back("Would you rather fight one horse-sized duck or 100 duck-sized horses?")).toBeNull();
  });
});

/**
 * THE GOLDEN PAIR. Identical structural state, radically different reason for
 * Insider to open its mouth: a proposition with a concrete trade-off, and a
 * joke with none.
 */
describe("the $20 airdrop / horse-sized duck fixture", () => {
  const ask = (title: string) =>
    semanticQuestion({ key: "gold", title, state: "side_emptied", side: "NO" });

  it("asks the proposition question when a side empties out", () => {
    const q = ask("Is selling your data worth a $20 airdrop?")!;
    expect(q).toBeTruthy();
    expect(q).toContain("$20");
    expect(q).toMatch(/NO/);
  });

  it("says nothing on the same state under a joke", () => {
    expect(
      ask("Would you rather fight one horse-sized duck or 100 duck-sized horses?"),
    ).toBeNull();
  });
});

