import { describe, it, expect } from "vitest";
import { sequenceFeed, MAX_DISPLACED, type SequenceCandidate } from "./sequence";
import { familyOf, type ReasonCode } from "./reasons";
import { SEQUENCE } from "./config";
import { tierFor, type Eligibility, type ExclusionReason } from "./eligibility";
import type { ScoredMarket } from "./score";

/**
 * An exclusion as the real gate would report it — the TIER comes from `tierFor`
 * rather than the test, so a test can never assert against a tier the gate would
 * not actually assign. `resurfaceAt` defaults to 0 (oldest sighting), which the
 * ordering tests below override when they care.
 */
const elig = (reason: ExclusionReason, resurfaceAt = 0): Eligibility => {
  const tier = tierFor(reason);
  return {
    eligible: false,
    tier,
    reason,
    availableAt: null,
    resurfaceAt: tier === "resurfaced" ? resurfaceAt : null,
  };
};

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
  eligibility: {
    eligible: true,
    tier: "fresh",
    reason: null,
    availableAt: null,
    resurfaceAt: null,
  },
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
          eligibility: elig("active_position"),
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
          eligibility: elig("hidden"),
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
    eligibility: elig("passed"),
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
      candidates: [cand(1), cand(2, { eligibility: elig("hidden") }), cand(3)],
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

/**
 * TRUE END vs TEMPORARY END.
 *
 * The feed pages implicitly: `seenIds` are excluded server-side and the poll
 * returns what the last response could not fit. So "fewer rows than the limit"
 * is the only honest signal that a lens has run out, and it has to come from
 * the side that can see the leftovers.
 */
describe("exhausted", () => {
  it("is true when the ranking ran out before the limit did", () => {
    const { exhausted, items } = sequenceFeed({
      preserveOrder: true,
      limit: 10,
      candidates: [cand(1), cand(2), cand(3)],
    });
    expect(items).toHaveLength(3);
    expect(exhausted).toBe(true);
  });

  it("is FALSE when candidates were left behind", () => {
    // The failure this prevents: telling a reader they are caught up while the
    // next poll is about to hand them twenty more markets.
    const { exhausted, items } = sequenceFeed({
      preserveOrder: true,
      limit: 2,
      candidates: [cand(1), cand(2), cand(3)],
    });
    expect(items).toHaveLength(2);
    expect(exhausted).toBe(false);
  });

  it("is exactly false at the boundary where one candidate remains", () => {
    expect(
      sequenceFeed({ preserveOrder: true, limit: 2, candidates: [cand(1), cand(2)] }).exhausted,
    ).toBe(true);
    expect(
      sequenceFeed({ preserveOrder: true, limit: 2, candidates: [cand(1), cand(2), cand(3)] })
        .exhausted,
    ).toBe(false);
  });

  it("does not count markets the gate removed as leftovers", () => {
    // An ineligible market is not a next page — it is never coming back.
    const { exhausted } = sequenceFeed({
      preserveOrder: true,
      limit: 2,
      candidates: [cand(1), cand(2), cand(3, { eligibility: elig("hidden") })],
    });
    expect(exhausted).toBe(true);
  });

  it("reports the same way for the blended feed", () => {
    expect(sequenceFeed({ limit: 10, candidates: [cand(1), cand(2)] }).exhausted).toBe(true);
    expect(sequenceFeed({ limit: 1, candidates: [cand(1), cand(2)] }).exhausted).toBe(false);
  });

  it("is false while re-entry cards are still waiting", () => {
    // A re-entry is a market the blended feed can still place, so the line has
    // not ended even though the main pool is empty.
    const { exhausted } = sequenceFeed({
      limit: 1,
      candidates: [
        cand(1),
        cand(2, {
          eligibility: elig("passed"),
          reentry: { label: "Your position is moving", detail: "YES moved up" },
        }),
      ],
    });
    expect(exhausted).toBe(false);
  });

  it("an empty feed is exhausted, not pending", () => {
    expect(sequenceFeed({ candidates: [] }).exhausted).toBe(true);
  });
});

/**
 * THE SECOND TIER — markets the reader has been shown and did not decide on.
 *
 * The behaviour these lock down is the difference between a feed and a playlist:
 * running out of NEVER-SEEN markets is a fact about retrieval, and it must not
 * reach the reader as "discovery is over".
 */
describe("the resurface tier", () => {
  const seen = (id: number, resurfaceAt = 0) =>
    cand(id, { eligibility: elig("recently_viewed", resurfaceAt) });

  it("fills the queue when the fresh pool runs out", () => {
    const { items } = sequenceFeed({
      limit: 4,
      candidates: [cand(1), seen(2), seen(3), seen(4)],
    });
    expect(items.map((i) => (i.kind === "market" ? i.onchainId : null))).toHaveLength(4);
  });

  /** A repeat is a last resort, never a competitor for an early slot. */
  it("never places a repeat while a fresh market is available", () => {
    const { items } = sequenceFeed({
      limit: 4,
      // The repeats outscore every fresh market, and it must not matter.
      candidates: [seen(1), seen(2), cand(50), cand(51)],
    });
    const ids = items.flatMap((i) => (i.kind === "market" ? [i.onchainId] : []));
    expect(ids.slice(0, 2).sort()).toEqual([50, 51]);
  });

  it("offers the oldest sighting first, not the best-scoring one", () => {
    const { items } = sequenceFeed({
      limit: 2,
      // 1 scores highest (cand scores 100 - id) and was seen most recently.
      candidates: [seen(1, 9_000), seen(2, 1_000)],
    });
    expect(items.flatMap((i) => (i.kind === "market" ? [i.onchainId] : []))).toEqual([2, 1]);
  });

  it("marks what it placed, so a session of repeats is visible", () => {
    const { items } = sequenceFeed({ limit: 2, candidates: [cand(1), seen(2)] });
    const flags = items.flatMap((i) => (i.kind === "market" ? [i.diagnostics.resurfaced] : []));
    expect(flags).toEqual([false, true]);
  });

  it("is not exhausted while repeats are still waiting", () => {
    expect(sequenceFeed({ limit: 1, candidates: [cand(1), seen(2)] }).exhausted).toBe(false);
    expect(sequenceFeed({ limit: 4, candidates: [cand(1), seen(2)] }).exhausted).toBe(true);
  });

  it("still obeys the diversity rules — a repeat earns its slot like any card", () => {
    const cands = Array.from({ length: 8 }, (_, i) =>
      cand(i + 1, {
        category: i < 6 ? "crypto" : "sports",
        eligibility: elig("recently_viewed", i * 1_000),
      }),
    );
    const { items } = sequenceFeed({ candidates: cands, limit: 8 });
    const cats = items.flatMap((it) =>
      it.kind === "market" ? [cands.find((c) => c.onchainId === it.onchainId)!.category] : [],
    );
    let run = 1;
    for (let i = 1; i < cats.length; i += 1) {
      run = cats[i] === cats[i - 1] ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(SEQUENCE.MAX_SAME_CATEGORY_RUN);
    }
  });

  /**
   * A RANKING IS ALLOWED TO END. Padding "Most Capital" with markets already
   * seen would answer a question the reader did not ask, and the playlist's
   * continuation row is the honest exit.
   */
  it("is not offered to a ranked lens", () => {
    const { items, exhausted, excluded } = sequenceFeed({
      preserveOrder: true,
      limit: 4,
      candidates: [cand(1), seen(2), seen(3)],
    });
    expect(items.flatMap((i) => (i.kind === "market" ? [i.onchainId] : []))).toEqual([1]);
    expect(exhausted).toBe(true);
    expect(excluded.map((e) => e.onchainId).sort()).toEqual([2, 3]);
  });

  it("prefers a labelled re-entry over an unlabelled repeat of the same market", () => {
    const { items } = sequenceFeed({
      limit: 24,
      candidates: [
        ...Array.from({ length: 12 }, (_, i) => cand(i + 100)),
        cand(1, {
          eligibility: elig("recently_viewed", 0),
          reentry: { label: "Your Tribe is joining", detail: "Someone you match with is here." },
        }),
      ],
    });
    const back = items.find((i) => i.kind === "market" && i.onchainId === 1);
    expect(back && back.kind === "market" && back.reentryLabel).toBe("Your Tribe is joining");
  });
});

/**
 * SPEND THE CATALOGUE BEFORE REPEATING ANY OF IT.
 *
 * The sequencer sees ONE pool page — 240 rows of some 2,800 — so "this page has
 * nothing fresh" and "this platform has nothing fresh" look identical to it and
 * mean completely different things. Answering the first with repeats is how a
 * reader saw markets again with thousands untouched behind the ceiling. The
 * caller knows which it is; this flag is how it says so.
 */
describe("allowResurface", () => {
  const seen = (id: number, resurfaceAt = 0) =>
    cand(id, { eligibility: elig("recently_viewed", resurfaceAt) });

  it("returns nothing rather than a repeat when repeats are barred", () => {
    const { items, exhausted } = sequenceFeed({
      limit: 4,
      allowResurface: false,
      candidates: [seen(1), seen(2), seen(3)],
    });
    // An empty page is what tells the client to dig deeper. A page of repeats
    // would have told it the opposite.
    expect(items).toHaveLength(0);
    expect(exhausted).toBe(true);
  });

  it("still places every fresh market on the page", () => {
    const { items } = sequenceFeed({
      limit: 4,
      allowResurface: false,
      candidates: [seen(1), cand(50), seen(2), cand(51)],
    });
    expect(items.flatMap((i) => (i.kind === "market" ? [i.onchainId] : [])).sort()).toEqual([
      50, 51,
    ]);
  });

  it("reports the barred markets rather than losing them", () => {
    const { excluded } = sequenceFeed({
      limit: 4,
      allowResurface: false,
      candidates: [seen(1), seen(2)],
    });
    expect(excluded.map((e) => e.onchainId).sort()).toEqual([1, 2]);
  });

  it("places them once the caller says the catalogue is spent", () => {
    const { items } = sequenceFeed({
      limit: 4,
      allowResurface: true,
      candidates: [seen(1), seen(2)],
    });
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.kind === "market" && i.diagnostics.resurfaced)).toBe(true);
  });

  it("defaults to allowing them — the policy of when to ask lives one layer up", () => {
    expect(sequenceFeed({ limit: 4, candidates: [seen(1)] }).items).toHaveLength(1);
  });

  /** A re-entry is a labelled card about a real change, not a repeat. */
  it("never bars a labelled re-entry", () => {
    const { items } = sequenceFeed({
      limit: 24,
      allowResurface: false,
      candidates: [
        ...Array.from({ length: 12 }, (_, i) => cand(i + 100)),
        cand(1, {
          eligibility: elig("recently_viewed", 0),
          reentry: { label: "Your Tribe is joining", detail: "Someone you match with is here." },
        }),
      ],
    });
    expect(items.some((i) => i.kind === "market" && i.reentryLabel)).toBe(true);
  });
});
