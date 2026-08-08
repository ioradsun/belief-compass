import { describe, expect, it } from "vitest";
import { relationshipNarrative, NARRATIVE, type NarrativeFacts } from "./relationship-narrative";

const facts = (o: Partial<NarrativeFacts> = {}): NarrativeFacts => ({
  name: "Rasoul",
  shared: 0,
  together: 0,
  apart: 0,
  ...o,
});

const dom = (domain: string, together: number, apart = 0) => ({ domain, together, apart });

describe("no shared markets", () => {
  it("refuses to manufacture a 0% relationship", () => {
    const n = relationshipNarrative(facts());
    expect(n.kind).toBe("never_met");
    expect(n.matchPct).toBeNull();
    expect(n.evidence).toBeNull();
    expect(n.primary).toBe("You haven't crossed paths yet.");
  });
});

describe("thin evidence says 'so far' and infers nothing", () => {
  it("one shared market, aligned", () => {
    const n = relationshipNarrative(facts({ shared: 1, together: 1 }));
    expect(n.kind).toBe("thin");
    expect(n.evidence).toBe("1 of 1 together so far");
    expect(n.primary).toBe("You've crossed paths once. Same side.");
    expect(n.supporting).toBeNull();
  });

  it("two shared markets, aligned", () => {
    const n = relationshipNarrative(facts({ shared: 2, together: 2 }));
    expect(n.matchPct).toBe(100);
    expect(n.primary).toBe("You've crossed paths twice. Same side both times.");
  });

  it("two shared markets, split", () => {
    expect(relationshipNarrative(facts({ shared: 2, together: 1, apart: 1 })).primary).toBe(
      "You've crossed paths twice. One each, so far.",
    );
  });

  it("never claims a domain story from thin evidence", () => {
    const n = relationshipNarrative(
      facts({ shared: 2, together: 2, domains: [dom("Crypto", 2)] }),
    );
    expect(n.kind).toBe("thin");
  });
});

describe("alignment across topics", () => {
  it("names the pattern and proves it with two real domains", () => {
    const n = relationshipNarrative(
      facts({
        shared: 8,
        together: 8,
        domains: [dom("Crypto", 4), dom("Culture", 4)],
      }),
    );
    expect(n.kind).toBe("cross_topic");
    expect(n.primary).toBe("Different topics. Same instinct.");
    expect(n.supporting).toBe("From Crypto to Culture, you keep landing together.");
  });

  it("does not say 'different topics' when all the evidence is one topic", () => {
    const n = relationshipNarrative(
      facts({ shared: 6, together: 6, domains: [dom("Crypto", 6)] }),
    );
    expect(n.kind).toBe("domain_click");
    expect(n.primary).toBe("Crypto is where you two click.");
  });

  it("refuses a domain claim on one market in that domain", () => {
    const n = relationshipNarrative(
      facts({ shared: 6, together: 6, domains: [dom("Crypto", 1), dom("Sports", 1)] }),
    );
    expect(n.kind).toBe("cross_topic");
    expect(n.primary).toBe("You've landed together every time you've crossed paths.");
  });
});

describe("the exception explains the percentage", () => {
  it("names the domain they diverge in", () => {
    const n = relationshipNarrative(
      facts({
        shared: 12,
        together: 10,
        apart: 2,
        domains: [dom("Crypto", 8), dom("Sports", 1, 3)],
      }),
    );
    expect(n.kind).toBe("exception");
    expect(n.primary).toBe("Usually together. Sports is the exception.");
  });
});

describe("rival is disagreement, never antagonism", () => {
  const rival = relationshipNarrative(
    facts({ shared: 9, together: 2, apart: 7, domains: [dom("Crypto", 0, 5)] }),
  );

  it("states it plainly and names the clash", () => {
    expect(rival.kind).toBe("rival");
    expect(rival.matchPct).toBe(22);
    expect(rival.primary).toBe("Same questions. Very different answers.");
    expect(rival.supporting).toBe("Crypto is where you clash most.");
  });

  it("uses no hostile vocabulary anywhere in the engine's output", () => {
    const all = [
      rival,
      relationshipNarrative(facts({ shared: 9, together: 2, apart: 7 })),
      relationshipNarrative(facts({ shared: 9, together: 5, apart: 4 })),
    ]
      .flatMap((n) => [n.primary, n.supporting ?? ""])
      .join(" ");
    expect(all).not.toMatch(/\b(beat|destroy|enemy|prove them wrong|win|loser)\b/i);
  });
});

describe("mixed", () => {
  it("says so in human words rather than printing a label", () => {
    const n = relationshipNarrative(facts({ shared: 10, together: 6, apart: 4 }));
    expect(n.kind).toBe("mixed");
    expect(n.primary).toBe("You're still figuring each other out.");
  });
});

/**
 * Whether someone is there when you call is more meaningful than whether they
 * vote like you — so it outranks every alignment story in the engine.
 */
describe("showing up outranks agreeing", () => {
  it("beats a rival reading, and does not soften it", () => {
    const n = relationshipNarrative(
      facts({ shared: 9, together: 2, apart: 7, theyShowed: true, youShowed: true }),
    );
    expect(n.kind).toBe("mutual_showing_up");
    expect(n.primary).toBe("You rarely agree. You still show up for each other.");
    expect(n.matchPct).toBe(22);
  });

  it("beats a cross-topic reading too", () => {
    const n = relationshipNarrative(
      facts({
        shared: 8,
        together: 8,
        theyShowed: true,
        youShowed: true,
        domains: [dom("Crypto", 4), dom("Culture", 4)],
      }),
    );
    expect(n.primary).toBe("You tend to see things the same way — and you show up for each other.");
  });

  it("stays modest when the shared record is thin", () => {
    const n = relationshipNarrative(
      facts({ shared: 1, together: 1, theyShowed: true, youShowed: true }),
    );
    expect(n.primary).toBe("You show up for each other.");
  });

  it("distinguishes the two one-way directions", () => {
    expect(relationshipNarrative(facts({ shared: 9, together: 5, theyShowed: true })).primary).toBe(
      "You can count on Rasoul.",
    );
    expect(relationshipNarrative(facts({ shared: 9, together: 5, youShowed: true })).primary).toBe(
      "You've shown up for Rasoul.",
    );
  });
});

describe("the engine is deterministic and never invents", () => {
  it("returns the same story for the same facts", () => {
    const f = facts({ shared: 8, together: 8, domains: [dom("Crypto", 4), dom("AI", 4)] });
    expect(relationshipNarrative(f)).toEqual(relationshipNarrative(f));
  });

  it("never uses the vocabulary of a personality test", () => {
    const scenarios: NarrativeFacts[] = [
      facts(),
      facts({ shared: 1, together: 1 }),
      facts({ shared: 3, together: 3, domains: [dom("Crypto", 3)] }),
      facts({ shared: 9, together: 2, apart: 7 }),
      facts({ shared: 10, together: 6, apart: 4 }),
      facts({ shared: 12, together: 10, apart: 2, domains: [dom("Sports", 1, 3)] }),
      facts({ shared: 9, together: 8, apart: 1, theyShowed: true }),
    ];
    const copy = scenarios
      .map(relationshipNarrative)
      .flatMap((n) => [n.primary, n.supporting ?? ""])
      .join(" ");
    expect(copy).not.toMatch(
      /worldview|values|perspective|independen|curious|emotion|personality|dynamic|unique/i,
    );
  });

  it("only claims a domain with enough evidence behind it", () => {
    expect(NARRATIVE.minDomainEvidence).toBeGreaterThanOrEqual(3);
    const n = relationshipNarrative(
      facts({ shared: 9, together: 9, domains: [dom("Crypto", 2), dom("Sports", 2)] }),
    );
    expect(n.supporting).toBeNull();
  });
});
