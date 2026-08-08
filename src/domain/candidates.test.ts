import { describe, it, expect } from "vitest";
import {
  aggregateCandidates,
  rankAndCapCandidates,
  marketDistinctiveness,
  type SharedBeliefRow,
  type MatchCandidate,
} from "./candidates";
import { DNA_LIMITS } from "./dna/config";

const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from);

describe("candidate generation", () => {
  const viewerSides = new Map(range(6).map((i) => [i, "YES" as const]));
  const viewerConv = new Map(range(6).map((i) => [i, 0.8]));
  const pop = new Map(range(6).map((i) => [i, 10]));

  it("only wallets sharing >= min directional markets are candidates", () => {
    const rows: SharedBeliefRow[] = [
      ...range(6).map((i) => ({
        wallet: "0xa",
        onchain_id: i,
        stance_side: "YES" as const,
        conviction: 0.8,
      })),
      { wallet: "0xb", onchain_id: 1, stance_side: "YES", conviction: 0.8 },
      { wallet: "0xb", onchain_id: 2, stance_side: "YES", conviction: 0.8 },
    ];
    const out = aggregateCandidates(viewerSides, viewerConv, rows, pop);
    expect(out.map((c) => c.wallet)).toEqual(["0xa"]);
    expect(out[0].sharedMarkets).toBe(6);
  });

  it("MIXED/INACTIVE beliefs are not directional shared evidence", () => {
    // Two directional and four MIXED. If MIXED counted as shared evidence the
    // pair would clear the canonical gate of three; because it does not, they sit
    // at two and are pruned. The fixture is sized to the gate on purpose — at the
    // old floor of five this passed for the wrong reason, since FIVE directional
    // rows were also below it.
    const rows: SharedBeliefRow[] = range(6).map((i) => ({
      wallet: "0xc",
      onchain_id: i,
      stance_side: (i <= 1 ? "YES" : "MIXED") as SharedBeliefRow["stance_side"],
      conviction: 0.8,
    }));
    expect(aggregateCandidates(viewerSides, viewerConv, rows, pop)).toHaveLength(0);
  });

  it("counts opposite-side shared markets", () => {
    const rows: SharedBeliefRow[] = [
      ...range(4).map((i) => ({
        wallet: "0xd",
        onchain_id: i,
        stance_side: "YES" as const,
        conviction: 0.8,
      })),
      ...range(2, 5).map((i) => ({
        wallet: "0xd",
        onchain_id: i,
        stance_side: "NO" as const,
        conviction: 0.8,
      })),
    ];
    const out = aggregateCandidates(viewerSides, viewerConv, rows, pop);
    expect(out[0].sameSideMarkets).toBe(4);
    expect(out[0].oppositeSideMarkets).toBe(2);
  });

  it("caps the candidate pool deterministically", () => {
    const rows: SharedBeliefRow[] = [];
    for (let w = 0; w < 600; w++)
      for (const i of range(5))
        rows.push({ wallet: `0x${w}`, onchain_id: i, stance_side: "YES", conviction: 0.8 });
    const out = aggregateCandidates(viewerSides, viewerConv, rows, pop, { maxCandidates: 500 });
    expect(out.length).toBe(500);
    const again = aggregateCandidates(viewerSides, viewerConv, rows, pop, { maxCandidates: 500 });
    expect(again.map((c) => c.wallet)).toEqual(out.map((c) => c.wallet));
  });

  it("large-market protection: rarer shared beliefs outrank ubiquitous ones", () => {
    expect(marketDistinctiveness(1000)).toBeLessThan(marketDistinctiveness(2));
    const popMix = new Map<number, number>([
      [1, 5000],
      [2, 5000],
      [3, 5000],
      [4, 5000],
      [5, 5000],
      [6, 3],
      [7, 3],
      [8, 3],
      [9, 3],
      [10, 3],
    ]);
    const vSides = new Map<number, "YES">(range(10).map((i) => [i, "YES"]));
    const vConv = new Map(range(10).map((i) => [i, 0.8]));
    const rows: SharedBeliefRow[] = [
      ...range(5, 1).map((i) => ({
        wallet: "0xubiq",
        onchain_id: i,
        stance_side: "YES" as const,
        conviction: 0.8,
      })),
      ...range(5, 6).map((i) => ({
        wallet: "0xrare",
        onchain_id: i,
        stance_side: "YES" as const,
        conviction: 0.8,
      })),
    ];
    expect(aggregateCandidates(vSides, vConv, rows, popMix)[0].wallet).toBe("0xrare");
  });

  it("rankAndCapCandidates never exceeds the cap", () => {
    const many: MatchCandidate[] = range(DNA_LIMITS.maxExactScored + 50).map((i) => ({
      wallet: `0x${i}`,
      sharedMarkets: 5,
      sameSideMarkets: 5,
      oppositeSideMarkets: 0,
      preliminaryAgreement: 1,
      weightedSharedEvidence: Math.random(),
      lastSharedActivityAt: null,
    }));
    expect(rankAndCapCandidates(many, DNA_LIMITS.maxExactScored).length).toBe(
      DNA_LIMITS.maxExactScored,
    );
  });
});
