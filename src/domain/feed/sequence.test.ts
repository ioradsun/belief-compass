import { describe, it, expect } from "vitest";
import { sequenceFeed, MAX_DISPLACED, type SequenceCandidate } from "./sequence";
import { familyOf, type ReasonCode } from "./reasons";
import { SEQUENCE } from "./config";
import type { ScoredMarket } from "./score";

const scored = (
  id: number,
  score: number,
  driver: ScoredMarket["driver"] = "momentum",
): ScoredMarket => ({
  onchainId: id,
  score,
  components: {
    momentum: 0,
    personal: 0,
    freshness: 0,
    social: 0,
    quality: 0,
    early: 0,
    exploration: 0,
  },
  driver,
  acceleration: 1,
  ageHours: 10,
});

const cand = (id: number, o: Partial<SequenceCandidate> = {}): SequenceCandidate => ({
  onchainId: id,
  category: null,
  creator: null,
  clusterId: null,
  scored: scored(id, 100 - id),
  eligibility: { eligible: true, reason: null, availableAt: null },
  reason: { code: "taking_off", text: `reason ${id}` },
  reentry: null,
  ...o,
});

describe("hard exclusion", () => {
  it("removes ineligible markets entirely — they are never ranked down, they are gone", () => {
    const { items, excluded } = sequenceFeed({
      candidates: [
        cand(1),
        cand(2, {
          eligibility: { eligible: false, reason: "active_position", availableAt: null },
        }),
        cand(3),
      ],
    });
    expect(items.map((i) => i.kind === "market" && i.onchainId)).toEqual([1, 3]);
    expect(excluded).toEqual([{ onchainId: 2, reason: "active_position" }]);
  });

  it("a hidden market can never return, even with a material change", () => {
    const { items } = sequenceFeed({
      candidates: [
        cand(1, {
          eligibility: { eligible: false, reason: "hidden", availableAt: null },
          reentry: { label: "This market is heating up", detail: "10 new believers." },
        }),
      ],
    });
    expect(items).toHaveLength(0);
  });
});

describe("re-entry cards", () => {
  const pool = Array.from({ length: 30 }, (_, i) => cand(i + 100));
  const back = cand(1, {
    eligibility: { eligible: false, reason: "passed", availableAt: null },
    reentry: { label: "Your position is moving", detail: "Your side has moved 20%." },
  });

  it("are rare, evenly spaced and always labelled", () => {
    const { items } = sequenceFeed({ candidates: [...pool, back], limit: 24 });
    const re = items.filter((i) => i.kind === "market" && i.reentryLabel);
    expect(re).toHaveLength(1);
    expect(re[0]!.position % SEQUENCE.REENTRY_EVERY).toBe(0);
    expect(re[0]!.kind === "market" && re[0]!.reentryLabel).toBe("Your position is moving");
  });

  it("never appear in the first slot", () => {
    const { items } = sequenceFeed({ candidates: [back, ...pool] });
    expect(items[0]!.kind === "market" && items[0]!.reentryLabel).toBeNull();
  });
});

describe("diversity", () => {
  it("never runs more than 2 cards of one category back to back", () => {
    const cands = Array.from({ length: 12 }, (_, i) =>
      cand(i + 1, { category: i < 8 ? "Crypto" : "Sports" }),
    );
    const { items } = sequenceFeed({ candidates: cands, limit: 12 });
    const cats = items.map(
      (i) => cands.find((c) => c.onchainId === (i as { onchainId: number }).onchainId)!.category,
    );
    let run = 1;
    for (let i = 1; i < cats.length; i += 1) {
      run = cats[i] === cats[i - 1] ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(SEQUENCE.MAX_SAME_CATEGORY_RUN);
    }
  });

  it("keeps near-duplicate markets apart", () => {
    const cands = [
      cand(1, { clusterId: "dupe" }),
      cand(2, { clusterId: "dupe" }),
      ...Array.from({ length: 6 }, (_, i) => cand(i + 10, { clusterId: `c${i}` })),
    ];
    const { items } = sequenceFeed({ candidates: cands, limit: 8 });
    const positions = items
      .filter((i) => i.kind === "market" && (i.onchainId === 1 || i.onchainId === 2))
      .map((i) => i.position);
    expect(positions[1]! - positions[0]!).toBeGreaterThan(1);
  });
});

describe("determinism and diagnostics", () => {
  it("the same input always produces the same order", () => {
    const cands = Array.from({ length: 15 }, (_, i) => cand(i + 1, { category: `c${i % 3}` }));
    expect(sequenceFeed({ candidates: cands })).toEqual(sequenceFeed({ candidates: cands }));
  });

  it("every card explains why it is where it is", () => {
    const { items } = sequenceFeed({ candidates: [cand(1), cand(2)] });
    for (const it of items) {
      if (it.kind !== "market") continue;
      expect(it.diagnostics.score).toBeGreaterThanOrEqual(0);
      expect(it.diagnostics.driver).toBeTruthy();
      expect(it.diagnostics.slotIntent).toBeTruthy();
    }
  });
});

describe("the House idea", () => {
  const pool = Array.from({ length: 10 }, (_, i) => cand(i + 1));
  const idea = { id: "s1", question: "Q?", category: "Crypto", shortReason: "because" };

  it("is placed after the opening cards, with positions renumbered", () => {
    const { items } = sequenceFeed({ candidates: pool, idea });
    const at = items.findIndex((i) => i.kind === "market_idea");
    expect(at).toBeGreaterThanOrEqual(SEQUENCE.IDEA_MIN_POSITION);
    expect(items.map((i) => i.position)).toEqual(items.map((_, i) => i));
  });

  it("is absent when the feed is too short to earn one", () => {
    const { items } = sequenceFeed({ candidates: [cand(1)], idea });
    expect(items.some((i) => i.kind === "market_idea")).toBe(false);
  });
});

/**
 * Everything in this block was found by running `check:feed-archetypes` against
 * the real pool and reading the output, not by reasoning about the rules.
 */
describe("diversity axes the archetype harness measured", () => {
  const withReason = (
    id: number,
    code: ReasonCode,
    o: Partial<SequenceCandidate> = {},
  ): SequenceCandidate => ({
    ...cand(id, { scored: scored(id, 100 - id) }),
    reason: { code, text: `reason ${id}` },
    ...o,
  });

  /**
   * MEASURED: the reason family ran to NINE consecutive cards for a brand-new
   * viewer while category was capped at 2 and creator at 1. A feed that says the
   * same KIND of thing nine times reads as one long sentence.
   */
  it("caps a run of one reason family", () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      withReason(i, i < 9 ? "momentum" : "tribe", { category: `c${i}`, creator: `w${i}` }),
    );
    const { items } = sequenceFeed({ candidates, limit: 10 });
    const fams = items.flatMap((it) =>
      it.kind === "market" ? [familyOf(it.reasonCode as ReasonCode)] : [],
    );
    let run = 1;
    for (let i = 1; i < fams.length; i += 1) {
      run = fams[i] === fams[i - 1] ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(SEQUENCE.MAX_SAME_FAMILY_RUN);
    }
  });

  /** MEASURED: "down" was 50–70% of the feed, running to four in a row. */
  it("caps a run of one momentum direction", () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      withReason(i, "momentum", {
        category: `c${i}`,
        creator: `w${i}`,
        moveDirection: i < 8 ? "down" : "up",
      }),
    );
    const { items } = sequenceFeed({ candidates, limit: 10 });
    const dirs = items.flatMap((it) =>
      it.kind === "market"
        ? [candidates.find((c) => c.onchainId === it.onchainId)!.moveDirection]
        : [],
    );
    let run = 1;
    for (let i = 1; i < dirs.length; i += 1) {
      run = dirs[i] === dirs[i - 1] ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(SEQUENCE.MAX_SAME_DIRECTION_RUN);
    }
  });

  /**
   * THE REGRESSION THAT ADDING THEM CAUSED. With four competing rules and a thin
   * pool, every remaining candidate can violate something — and the loop then
   * placed whatever it was holding, which broke the CATEGORY cap that had been
   * guaranteed and tested for far longer. Preferences yield; guarantees do not.
   */
  it("relaxes the new preferences before breaking the old guarantees", () => {
    // The soft rules are UNSATISFIABLE — every candidate is the same family and
    // the same direction — while the hard one is perfectly satisfiable, because
    // the categories alternate. The hard cap must therefore still hold exactly.
    const candidates = Array.from({ length: 10 }, (_, i) =>
      withReason(i, "momentum", {
        category: i % 2 === 0 ? "crypto" : "sports",
        creator: `w${i}`,
        moveDirection: "down",
      }),
    );
    const { items } = sequenceFeed({ candidates, limit: 8 });
    const placed = items.flatMap((it) =>
      it.kind === "market" ? [candidates.find((c) => c.onchainId === it.onchainId)!] : [],
    );
    expect(placed.length).toBe(8);
    let run = 1;
    for (let i = 1; i < placed.length; i += 1) {
      run = placed[i]!.category === placed[i - 1]!.category ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(SEQUENCE.MAX_SAME_CATEGORY_RUN);
    }
    // …and the queue is still filled rather than truncated to satisfy a
    // preference. A shorter feed is a worse outcome than a repetitive one.
    const softBroken = items.some(
      (it) => it.kind === "market" && it.diagnostics.diversityAdjustments.includes("soft_relaxed"),
    );
    expect(softBroken).toBe(true);
  });
});

describe("why a card is in this slot and not a better-scoring one", () => {
  it("names the candidates it displaced, and why", () => {
    const candidates = [
      { ...cand(1, { scored: scored(1, 90) }), category: "crypto", creator: "a" },
      { ...cand(2, { scored: scored(2, 80) }), category: "crypto", creator: "a" },
      { ...cand(3, { scored: scored(3, 70) }), category: "sports", creator: "b" },
    ];
    const { items } = sequenceFeed({ candidates, limit: 3 });
    const all = items.flatMap((it) => (it.kind === "market" ? [it.diagnostics.displaced] : []));
    // The first card displaces nothing; a later one must name what it passed.
    expect(all[0]).toEqual([]);
    expect(all.some((d) => d.length > 0)).toBe(true);
    for (const d of all.flat()) {
      expect(typeof d.onchainId).toBe("number");
      expect(d.why.length).toBeGreaterThan(0);
    }
  });

  it("caps the list so diagnostics do not become the payload", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => ({
      ...cand(i, { scored: scored(i, 100 - i) }),
      category: "crypto",
      creator: "a",
    }));
    const { items } = sequenceFeed({ candidates, limit: 10 });
    for (const it of items) {
      if (it.kind === "market")
        expect(it.diagnostics.displaced.length).toBeLessThanOrEqual(MAX_DISPLACED);
    }
  });
});

/**
 * A RANKED LENS IS NOT A BLEND.
 *
 * Everything the sequencer does — the composite-score sort, the rhythm of slot
 * intents, the category and creator spacing — is right for For You and wrong for
 * "Most Capital", where the reader asked one question and expects the answer in
 * order. `preserveOrder` is how a ranking opts out.
 */
describe("preserveOrder", () => {
  it("keeps the caller's order instead of re-sorting on the composite score", () => {
    // Descending capital would be 3, 1, 2 — while the composite score says the
    // opposite. Without this flag the score wins and the lens is a lie.
    const { items } = sequenceFeed({
      preserveOrder: true,
      candidates: [cand(3, { scored: scored(3, 1) }), cand(1), cand(2)],
    });
    expect(items.map((i) => (i.kind === "market" ? i.onchainId : null))).toEqual([3, 1, 2]);
  });

  it("still drops ineligible markets — that is correctness, not taste", () => {
    const { items, excluded } = sequenceFeed({
      preserveOrder: true,
      candidates: [
        cand(1),
        cand(2, { eligibility: { eligible: false, reason: "hidden", availableAt: null } }),
        cand(3),
      ],
    });
    expect(items.map((i) => (i.kind === "market" ? i.onchainId : null))).toEqual([1, 3]);
    expect(excluded.map((e) => e.onchainId)).toEqual([2]);
  });

  it("does not space categories — the ranking is the point", () => {
    // Four crypto markets in a row is exactly what "Most Capital" should show
    // when the four biggest books happen to be crypto. Measured: crypto holds 28
    // of the 68 markets with $10 or more.
    const rows = [1, 2, 3, 4].map((id) => cand(id, { category: "crypto" }));
    const { items } = sequenceFeed({ preserveOrder: true, candidates: rows });
    expect(items).toHaveLength(4);
    expect(
      items.every((i) => i.kind === "market" && i.diagnostics.diversityAdjustments.length === 0),
    ).toBe(true);
  });

  it("honours the limit", () => {
    const { items } = sequenceFeed({
      preserveOrder: true,
      limit: 2,
      candidates: [cand(1), cand(2), cand(3)],
    });
    expect(items).toHaveLength(2);
  });

  it("leaves the blended path exactly as it was", () => {
    // The flag is opt-in: For You must be byte-identical to before.
    const rows = [cand(5, { scored: scored(5, 10) }), cand(6, { scored: scored(6, 90) })];
    const { items } = sequenceFeed({ candidates: rows });
    expect(items.map((i) => (i.kind === "market" ? i.onchainId : null))).toEqual([6, 5]);
  });
});
