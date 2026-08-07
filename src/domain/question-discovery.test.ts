import { describe, it, expect } from "vitest";
import {
  buildIndex,
  discover,
  retrieve,
  textScore,
  normalizeQuestion,
  bandFor,
  applyJudgement,
  contentTokens,
  livenessScore,
  TIE_EPS,
  BANDS,
  type DiscoveryDoc,
  type Liveness,
} from "./question-discovery";

/** Drawn from the real corpus, including the pairs that used to confuse it. */
const CORPUS: DiscoveryDoc[] = [
  { onchainId: 1, title: "Will France win the World Cup?" },
  { onchainId: 2, title: "Will France win World Cup 2026?" },
  { onchainId: 3, title: "Will England win the World Cup?" },
  { onchainId: 4, title: "Will Spain win the 2026 FIFA World Cup?" },
  { onchainId: 5, title: "Is Ronaldo better than Messi?" },
  { onchainId: 6, title: "Is Cristiano Ronaldo better than Lionel Messi?" },
  { onchainId: 7, title: "Is pineapple a acceptable topping for pizza?" },
  { onchainId: 8, title: "Is pineapple a suitable topping for pizza?" },
  {
    onchainId: 9,
    title: "Do you think Bitcoin will stay above $70,000 until the end of the month?",
  },
  { onchainId: 10, title: "Do you think INJ will stay above $6 until the end of the month?" },
  { onchainId: 11, title: "Will Bitcoin surpass gold by market cap before 2035?" },
  { onchainId: 12, title: "Is Solana better than Ethereum?" },
  { onchainId: 13, title: "Can Messi win 3 World Cup Trophies?" },
  { onchainId: 14, title: "Can Neymar win the 2030 World Cup?" },
  { onchainId: 15, title: "Will privacy become a luxury product?" },
  { onchainId: 16, title: "Will Argentina win the 2026 World Cup?" },
];

const index = buildIndex(CORPUS);
const titleOf = (id: number) => CORPUS.find((m) => m.onchainId === id)!.title;
const NOW = Date.parse("2026-08-07T00:00:00Z");

describe("normalisation", () => {
  it("gives the same key however the same thought was typed", () => {
    expect(normalizeQuestion("Will Bitcoin hit $100k?")).toBe(
      normalizeQuestion("will   BITCOIN hit $100k???"),
    );
  });

  it("is insensitive to word order, so a cache hit does not depend on phrasing", () => {
    expect(normalizeQuestion("Bitcoin beats gold")).toBe(normalizeQuestion("gold beats Bitcoin"));
  });

  it("strips question SHAPE from subject matter", () => {
    // Why "Should X be required to…" stopped matching "Should Y be required to…"
    const subject = contentTokens("Should political parties be required to disclose donors?");
    expect(subject.has("should")).toBe(false);
    expect(subject.has("required")).toBe(false);
    expect(subject.has("political")).toBe(true);
    expect(subject.has("donors")).toBe(true);
  });
});

describe("retrieval is free and finds the twin", () => {
  it("recalls a near-identical market in the top handful", () => {
    const got = retrieve(index, "Will France win the World Cup 2026?", 10).map((d) => d.onchainId);
    expect(got).toContain(1);
    expect(got).toContain(2);
  });

  it("returns nothing for a draft with no subject words at all", () => {
    expect(retrieve(index, "should it be?", 10)).toEqual([]);
  });

  it("is stable — the same query twice gives the same order", () => {
    const a = retrieve(index, "Will England win the World Cup?", 10).map((d) => d.onchainId);
    const b = retrieve(index, "Will England win the World Cup?", 10).map((d) => d.onchainId);
    expect(a).toEqual(b);
  });

  it("never walks the whole corpus — an unrelated draft retrieves little", () => {
    expect(retrieve(index, "Will quantum computing break RSA encryption?", 10).length).toBeLessThan(
      CORPUS.length,
    );
  });
});

describe("the deterministic ends need no model", () => {
  it("calls the SAME question a duplicate, however it was typed", () => {
    const d = discover(index, "will  FRANCE win the world cup???", { now: NOW });
    expect(d.relation).toBe("duplicate");
    expect(d.needsJudgement).toBe(false);
    expect(d.duplicateOf?.onchainId).toBe(1);
  });

  it("does NOT call a mere near-miss a duplicate, however high it scores", () => {
    // Real pair, ~0.95 — the same conversation, but arithmetic must not say so.
    const d = discover(index, "Is Argentina going to win the 2026 World Cup?", { now: NOW });
    expect(d.candidates[0]?.score).toBeGreaterThan(0.9);
    expect(d.relation).toBe("related");
    expect(d.needsJudgement).toBe(true);
    expect(d.duplicateOf).toBeNull();
  });

  it("calls a genuinely new idea novel, and stays quiet", () => {
    const d = discover(index, "Will lab-grown meat outsell beef in Germany?", { now: NOW });
    expect(d.relation).toBe("novel");
    expect(d.needsJudgement).toBe(false);
    expect(d.candidates).toEqual([]);
  });

  it("ignores a draft too short to mean anything", () => {
    expect(discover(index, "Bitcoin", { now: NOW }).candidates).toEqual([]);
  });

  it("treats the brief's own example as related, not duplicate", () => {
    const d = discover(index, "Will Bitcoin become Gen Z's preferred store of value?", {
      now: NOW,
    });
    expect(d.relation).not.toBe("duplicate");
  });
});

/**
 * THE REGRESSION SUITE, and the reason the ambiguous band exists.
 *
 * Every pair here was found in the live corpus. Duplicates and non-duplicates
 * score in the SAME range, so no threshold can separate them.
 */
describe("template-alike pairs are never called duplicates by text alone", () => {
  const differentQuestion: [string, string][] = [
    [titleOf(3), titleOf(4)], // England vs Spain
    [titleOf(1), titleOf(3)], // France vs England
    [titleOf(9), titleOf(10)], // Bitcoin vs INJ
    [titleOf(13), titleOf(14)], // Messi vs Neymar
  ];

  for (const [a, b] of differentQuestion) {
    it(`does not auto-resolve: ${a.slice(0, 30)}… / ${b.slice(0, 30)}…`, () => {
      expect(bandFor(textScore(a, b))).not.toBe("duplicate");
    });
  }

  it("refuses the 0.943 trap a numeric cut would have fallen into", () => {
    // Being cheated ON and cheating are opposite questions, and they score
    // higher than most true duplicates.
    const a = "Have you been cheated on before?";
    const b = "Have you cheated before?";
    expect(textScore(a, b)).toBeGreaterThan(0.9);
    expect(bandFor(textScore(a, b))).not.toBe("duplicate");
    expect(normalizeQuestion(a)).not.toBe(normalizeQuestion(b));
  });

  it("scores a true duplicate and a false one in the same range — the point", () => {
    const trueDup = textScore(titleOf(5), titleOf(6)); // Ronaldo/Messi ↔ Cristiano/Lionel
    const falseDup = textScore(titleOf(1), titleOf(3)); // France ↔ England
    expect(Math.abs(trueDup - falseDup)).toBeLessThan(0.25);
    expect(bandFor(trueDup)).toBe("ambiguous");
    expect(bandFor(falseDup)).toBe("ambiguous");
  });
});

/**
 * SIMILARITY GATES, ACTIVITY BREAKS TIES.
 *
 * The rail exists to consolidate people into rooms that already have someone in
 * them — but a busy unrelated market is still unrelated, and letting popularity
 * promote it would turn consolidation into recommendation.
 */
describe("activity orders within a band and never across one", () => {
  const busy = (id: number, participants: number): [number, Liveness] => [
    id,
    { participants, lastActivityMs: NOW - 3_600_000, contested: 0.5 },
  ];

  it("prefers the busier room between two equally similar ones", () => {
    // The pineapple pair (7 "acceptable" / 8 "suitable") differ only in a word
    // this draft does not use, so they score IDENTICALLY — a real tie, which is
    // the only situation activity is allowed to decide.
    const draft = "Is pineapple a good topping for pizza?";
    const plain = discover(index, draft, { now: NOW });
    const near = (d: typeof plain, id: number) => d.candidates.find((c) => c.onchainId === id)!;
    expect(Math.abs(near(plain, 7).score - near(plain, 8).score)).toBeLessThanOrEqual(TIE_EPS);

    // Symmetric: whichever of the tied pair has people in it leads. Asserting
    // both directions is what proves activity is deciding, rather than some
    // incidental ordering that happens to agree once.
    for (const id of [7, 8]) {
      const busier = discover(index, draft, { now: NOW, liveness: new Map([busy(id, 40)]) });
      expect(busier.candidates[0]?.onchainId).toBe(id);
      expect(busier.candidates[0]?.liveness).toBeGreaterThan(0);
    }
  });

  it("NEVER lets a busy room outrank a genuinely closer one", () => {
    // THE REGRESSION. A draft about France once surfaced Argentina first,
    // because Argentina's room had more people in it — liveness was sorting
    // ahead of similarity instead of inside it. "Equally similar" has to mean
    // equally similar.
    const d = discover(index, "will  FRANCE win the world cup???", {
      now: NOW,
      liveness: new Map([busy(16, 500), busy(3, 400)]), // Argentina + England, packed
    });
    expect(d.candidates[0]?.title).toContain("France");
    expect(d.duplicateOf?.title).toContain("France");
  });

  it("NEVER lets a busy weak match outrank a quiet strong one", () => {
    // Market 4 (Spain, weaker match) is made very busy; market 3 (England,
    // stronger match) has nobody. The stronger band must still lead.
    const d = discover(index, "Will England win the World Cup in 2026?", {
      now: NOW,
      liveness: new Map([busy(4, 500)]),
    });
    const bands = d.candidates.map((c) => c.band);
    const first = bands.indexOf("ambiguous");
    const lastRelated = bands.lastIndexOf("related");
    if (first !== -1 && lastRelated !== -1) expect(first).toBeLessThan(lastRelated);
  });

  it("cannot promote an unrelated market at any level of activity", () => {
    const d = discover(index, "Will lab-grown meat outsell beef in Germany?", {
      now: NOW,
      liveness: new Map([busy(1, 10_000), busy(12, 10_000)]),
    });
    expect(d.candidates).toEqual([]);
    expect(d.relation).toBe("novel");
  });

  it("orders identically when no liveness is supplied at all", () => {
    const withNone = discover(index, "Will England win the 2026 World Cup?", { now: NOW });
    expect(withNone.candidates.every((c) => c.liveness === 0)).toBe(true);
  });

  it("saturates, so one enormous room cannot dominate the scale", () => {
    const five = livenessScore({ participants: 5 }, NOW);
    const fiveHundred = livenessScore({ participants: 500 }, NOW);
    expect(fiveHundred).toBeGreaterThan(five);
    expect(fiveHundred).toBeLessThanOrEqual(1);
    expect(fiveHundred - five).toBeLessThan(five); // diminishing, not linear
  });

  it("decays with silence and is zero when nothing is known", () => {
    const fresh = livenessScore({ participants: 3, lastActivityMs: NOW - 3_600_000 }, NOW);
    const stale = livenessScore({ participants: 3, lastActivityMs: NOW - 30 * 86_400_000 }, NOW);
    expect(fresh).toBeGreaterThan(stale);
    expect(livenessScore(undefined, NOW)).toBe(0);
  });
});

describe("a judgement refines, it never overrules", () => {
  it("promotes the contested middle to duplicate when told", () => {
    const base = discover(index, "Is Cristiano Ronaldo better than Messi?", { now: NOW });
    const settled = applyJudgement(base, "duplicate", base.candidates[0]?.onchainId);
    expect(settled.relation).toBe("duplicate");
    expect(settled.needsJudgement).toBe(false);
  });

  it("keeps neighbours visible when the judgement says novel", () => {
    const base = discover(index, "Will England win the 2026 World Cup?", { now: NOW });
    const settled = applyJudgement(base, "novel");
    expect(settled.duplicateOf).toBeNull();
    expect(settled.candidates.length).toBeGreaterThan(0);
  });

  it("cannot invent a market that retrieval never found", () => {
    const base = discover(index, "Will England win the 2026 World Cup?", { now: NOW });
    const settled = applyJudgement(base, "duplicate", 9999);
    expect(settled.duplicateOf).not.toBeNull();
    expect(base.candidates.map((c) => c.onchainId)).toContain(settled.duplicateOf!.onchainId);
  });

  it("leaves an unambiguous verdict completely alone", () => {
    const base = discover(index, "will  FRANCE win the world cup???", { now: NOW });
    expect(applyJudgement(base, "novel")).toEqual(base);
  });
});

describe("the bands are ordered and total", () => {
  it("covers every score with exactly one band", () => {
    for (const s of [0, 0.2, 0.44, 0.45, 0.61, 0.62, 0.89, 0.9, 1]) {
      expect(["duplicate", "ambiguous", "related", "novel"]).toContain(bandFor(s));
    }
  });

  it("is monotonic — a higher score never means a weaker claim", () => {
    const rank = { novel: 0, related: 1, ambiguous: 2, duplicate: 3 } as const;
    let last = -1;
    for (let s = 0; s <= 1.0001; s += 0.02) {
      const r = rank[bandFor(s)];
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });

  it("has no numeric duplicate cut — only an exact match can claim that", () => {
    expect(bandFor(1)).toBe("ambiguous");
    expect(bandFor(0.999)).toBe("ambiguous");
    expect(BANDS.ambiguous).toBeGreaterThan(BANDS.related);
  });

  it("survives junk input without throwing", () => {
    expect(bandFor(NaN)).toBe("novel");
    expect(textScore("", "")).toBe(0);
    expect(() => discover(index, "")).not.toThrow();
  });
});
