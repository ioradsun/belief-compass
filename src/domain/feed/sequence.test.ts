import { describe, it, expect } from "vitest";
import { sequenceFeed, type SequenceCandidate } from "./sequence";
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
