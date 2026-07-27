import { describe, it, expect } from "vitest";
import { matchScore, type BeliefFactor } from "./domain";
import {
  scoreWalletMatch,
  classifyRelationship,
  matchConfidence,
  agreementStrength,
} from "./match";
import {
  aggregateCandidates,
  rankAndCapCandidates,
  marketDistinctiveness,
  type SharedBeliefRow,
  type MatchCandidate,
} from "./candidates";
import { buildViewerMatchOutput } from "./viewer-matches";
import { MATCH } from "./match-config";

/** A directional factor whose stance is consistent with its side. */
const f = (id: number, side: "YES" | "NO", conv = 0.8): BeliefFactor => ({
  onchain_id: id,
  stance: side === "YES" ? 0.9 : -0.9,
  stance_side: side,
  conviction: conv,
});

const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from);

// ---------------------------------------------------------------------------
describe("classifyRelationship", () => {
  it("strong confident agreement is Tribe", () => {
    const r = matchScore(
      range(6).map((i) => f(i, "YES")),
      range(6).map((i) => f(i, "YES")),
    );
    expect(classifyRelationship(r)).toBe("tribe");
  });
  it("strong confident opposition is Rival", () => {
    const r = matchScore(
      range(6).map((i) => f(i, "YES")),
      range(6).map((i) => f(i, "NO")),
    );
    expect(classifyRelationship(r)).toBe("rival");
  });
  it("enough evidence but no lean is Neutral", () => {
    const a = range(6).map((i) => f(i, "YES"));
    const b = [f(1, "YES"), f(2, "YES"), f(3, "YES"), f(4, "NO"), f(5, "NO"), f(6, "NO")];
    expect(classifyRelationship(matchScore(a, b))).toBe("neutral");
  });
  it("too few shared markets is insufficient_evidence even at 100% agreement", () => {
    const a = range(4).map((i) => f(i, "YES"));
    const b = range(4).map((i) => f(i, "YES"));
    const r = matchScore(a, b);
    expect(r.match_score).toBeGreaterThan(50); // agreement is high
    expect(classifyRelationship(r)).toBe("insufficient_evidence"); // but evidence is thin
  });
});

describe("exact score parity", () => {
  it("scoreWalletMatch returns the canonical matchScore evidence unchanged", () => {
    const a = range(7).map((i) => f(i, "YES"));
    const b = [...range(5).map((i) => f(i, "YES")), f(6, "NO"), f(7, "NO")];
    const canonical = matchScore(a, b);
    const wrapped = scoreWalletMatch(a, b);
    expect(wrapped.match_score).toBe(canonical.match_score);
    expect(wrapped.raw).toBe(canonical.raw);
    expect(wrapped.shared).toBe(canonical.shared);
    expect(wrapped.agreements).toBe(canonical.agreements);
    expect(wrapped.disagreements).toBe(canonical.disagreements);
    expect(wrapped.confidence).toBeCloseTo(matchConfidence(canonical.shared));
  });
});

describe("agreementStrength ranking", () => {
  it("at equal raw agreement, more shared evidence ranks higher (confidence-weighted)", () => {
    // Same raw agreement (all-YES → raw 0.81), different evidence depth.
    const thin = matchScore(
      range(5).map((i) => f(i, "YES")),
      range(5).map((i) => f(i, "YES")),
    );
    const wide = matchScore(
      range(60).map((i) => f(i, "YES")),
      range(60).map((i) => f(i, "YES")),
    );
    expect(wide.raw).toBeCloseTo(thin.raw); // identical raw agreement
    expect(agreementStrength(wide)).toBeGreaterThan(agreementStrength(thin)); // evidence wins
  });
});

// ---------------------------------------------------------------------------
describe("candidate generation", () => {
  const viewerSides = new Map(range(6).map((i) => [i, "YES" as const]));
  const viewerConv = new Map(range(6).map((i) => [i, 0.8]));
  const pop = new Map(range(6).map((i) => [i, 10]));

  it("only wallets sharing >= MIN_SHARED_OVERALL directional markets are candidates", () => {
    const rows: SharedBeliefRow[] = [
      ...range(6).map((i) => ({
        wallet: "0xa",
        onchain_id: i,
        stance_side: "YES" as const,
        conviction: 0.8,
      })),
      // 0xb shares only 2 markets → pruned
      { wallet: "0xb", onchain_id: 1, stance_side: "YES", conviction: 0.8 },
      { wallet: "0xb", onchain_id: 2, stance_side: "YES", conviction: 0.8 },
    ];
    const out = aggregateCandidates(viewerSides, viewerConv, rows, pop);
    expect(out.map((c) => c.wallet)).toEqual(["0xa"]);
    expect(out[0].sharedMarkets).toBe(6);
    expect(out[0].sameSideMarkets).toBe(6);
  });

  it("MIXED/INACTIVE beliefs are not directional shared evidence", () => {
    const rows: SharedBeliefRow[] = range(6).map((i) => ({
      wallet: "0xc",
      onchain_id: i,
      stance_side: (i <= 4 ? "YES" : "MIXED") as SharedBeliefRow["stance_side"],
      conviction: 0.8,
    }));
    const out = aggregateCandidates(viewerSides, viewerConv, rows, pop);
    // Only 4 directional shared → below the minimum → pruned entirely.
    expect(out).toHaveLength(0);
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
    // deterministic: same input → same order
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
      [5, 5000], // ubiquitous
      [6, 3],
      [7, 3],
      [8, 3],
      [9, 3],
      [10, 3], // rare
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
    const out = aggregateCandidates(vSides, vConv, rows, popMix);
    expect(out[0].wallet).toBe("0xrare"); // rare-market sharer ranks first
  });

  it("rankAndCapCandidates never exceeds the cap", () => {
    const many: MatchCandidate[] = range(1000).map((i) => ({
      wallet: `0x${i}`,
      sharedMarkets: 5,
      sameSideMarkets: 5,
      oppositeSideMarkets: 0,
      preliminaryAgreement: 1,
      weightedSharedEvidence: Math.random(),
      lastSharedActivityAt: null,
    }));
    expect(rankAndCapCandidates(many, MATCH.MAX_CANDIDATES).length).toBe(MATCH.MAX_CANDIDATES);
  });
});

// ---------------------------------------------------------------------------
describe("viewer bounded output", () => {
  const viewer = range(8).map((i) => f(i, "YES"));

  it("classifies Tribe, Rival, Neutral and drops weak evidence", () => {
    const cands = new Map<string, BeliefFactor[]>([
      ["0xtribe", range(8).map((i) => f(i, "YES"))], // full agreement
      ["0xrival", range(8).map((i) => f(i, "NO"))], // full opposition
      [
        "0xneutral",
        [
          f(1, "YES"),
          f(2, "YES"),
          f(3, "YES"),
          f(4, "YES"),
          f(5, "NO"),
          f(6, "NO"),
          f(7, "NO"),
          f(8, "NO"),
        ],
      ],
      ["0xweak", range(3).map((i) => f(i, "YES"))], // only 3 shared → dropped
    ]);
    const out = buildViewerMatchOutput(viewer, cands);
    expect(out.tribe.map((e) => e.wallet)).toContain("0xtribe");
    expect(out.rivals.map((e) => e.wallet)).toContain("0xrival");
    expect(out.tribe.map((e) => e.wallet)).not.toContain("0xneutral");
    expect(out.rivals.map((e) => e.wallet)).not.toContain("0xneutral");
    // weak evidence appears in NO surfaced list
    for (const list of [out.tribe, out.rivals])
      expect(list.map((e) => e.wallet)).not.toContain("0xweak");
    expect(out.closestMatch?.wallet).toBe("0xtribe");
  });

  it("returns null closest match when no candidate passes the evidence gate", () => {
    const cands = new Map<string, BeliefFactor[]>([["0xthin", range(3).map((i) => f(i, "YES"))]]);
    const out = buildViewerMatchOutput(viewer, cands);
    expect(out.closestMatch).toBeNull();
    expect(out.tribe).toHaveLength(0);
  });

  it("domain Circles score only markets in that domain and honor the domain minimum", () => {
    // Viewer: 6 Technology markets (1-6) + 6 Money markets (7-12), all YES.
    const v = [...range(6).map((i) => f(i, "YES")), ...range(6, 7).map((i) => f(i, "YES"))];
    const domainOf = (id: string | number) => (Number(id) <= 6 ? "Technology" : "Money");
    const viewerDomainCounts = new Map([
      ["Technology", 6],
      ["Money", 6],
    ]);
    const cands = new Map<string, BeliefFactor[]>([
      // agrees on Technology, opposes on Money
      ["0xtech", [...range(6).map((i) => f(i, "YES")), ...range(6, 7).map((i) => f(i, "NO"))]],
    ]);
    const out = buildViewerMatchOutput(v, cands, { domainOf, viewerDomainCounts });
    expect(out.domains.Technology?.[0]?.wallet).toBe("0xtech");
    expect(out.domains.Money).toBeUndefined(); // opposition is not an ally Circle
  });

  it("one shared domain market does not create a Circle", () => {
    const v = [...range(6).map((i) => f(i, "YES")), f(99, "YES")];
    const domainOf = (id: string | number) => (Number(id) === 99 ? "Health" : "Technology");
    const viewerDomainCounts = new Map([
      ["Technology", 6],
      ["Health", 1],
    ]);
    const cands = new Map<string, BeliefFactor[]>([
      ["0xh", [...range(6).map((i) => f(i, "YES")), f(99, "YES")]],
    ]);
    const out = buildViewerMatchOutput(v, cands, { domainOf, viewerDomainCounts });
    expect(out.domains.Health).toBeUndefined(); // below MIN_SHARED_DOMAIN
  });
});
