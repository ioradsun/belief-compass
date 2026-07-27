/**
 * Scale acceptance (Phase 8, section 44). Synthetic sparse wallet-market
 * participation demonstrating that one active-viewer candidate pass stays bounded
 * — the number of exactly-scored pairs does NOT grow with the wallet count.
 *
 * These are the in-memory analogue of the production path (the SQL RPC does the
 * same aggregation server-side); the assertion is on candidate/scored counts, not
 * wall-clock, so it is deterministic in CI.
 */
import { describe, it, expect } from "vitest";
import { aggregateCandidates, type SharedBeliefRow } from "./candidates";
import { buildViewerMatchOutput } from "./viewer-matches";
import { MATCH } from "./match-config";
import type { BeliefFactor } from "./domain";

/** Sparse fixture: `wallets` wallets, each holding ~`perWallet` of `markets`. */
function synth(
  wallets: number,
  markets: number,
  perWallet: number,
  viewerMarkets: number,
  seed = 1,
) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const viewerSet = Array.from({ length: viewerMarkets }, (_, i) => i + 1);
  const viewerSides = new Map<number, "YES" | "NO">(viewerSet.map((m) => [m, "YES"]));
  const viewerConv = new Map<number, number>(viewerSet.map((m) => [m, 0.8]));
  const rows: SharedBeliefRow[] = [];
  const pop = new Map<number, number>();
  for (let w = 0; w < wallets; w++) {
    for (let k = 0; k < perWallet; k++) {
      const market = 1 + Math.floor(rnd() * markets);
      pop.set(market, (pop.get(market) ?? 0) + 1);
      if (viewerSides.has(market)) {
        rows.push({
          wallet: `0x${w.toString(16)}`,
          onchain_id: market,
          stance_side: rnd() > 0.5 ? "YES" : "NO",
          conviction: 0.7,
        });
      }
    }
  }
  return { viewerSides, viewerConv, rows, pop };
}

describe("scale acceptance — bounded candidate + scoring", () => {
  for (const wallets of [10_000, 50_000, 100_000]) {
    it(`${wallets} sparse wallets → candidate pool stays <= MAX_CANDIDATES`, () => {
      const { viewerSides, viewerConv, rows, pop } = synth(wallets, 4_000, 20, 30);
      const candidates = aggregateCandidates(viewerSides, viewerConv, rows, pop);
      expect(candidates.length).toBeLessThanOrEqual(MATCH.MAX_CANDIDATES);

      // Exactly-scored pairs never exceed the candidate cap regardless of scale.
      const viewerFactors: BeliefFactor[] = Array.from(viewerSides.keys()).map((m) => ({
        onchain_id: m,
        stance: 0.9,
        stance_side: "YES",
        conviction: 0.8,
      }));
      const candFactors = new Map<string, BeliefFactor[]>(
        candidates.map((cand) => [
          cand.wallet,
          [{ onchain_id: 1, stance: 0.9, stance_side: "YES", conviction: 0.7 }] as BeliefFactor[],
        ]),
      );
      const out = buildViewerMatchOutput(viewerFactors, candFactors);
      expect(out.scoredCount).toBeLessThanOrEqual(MATCH.MAX_CANDIDATES);
    });
  }
});
