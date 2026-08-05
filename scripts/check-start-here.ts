/**
 * WHAT START HERE ACTUALLY SAYS, across the profile shapes that exist.
 *
 * Unit tests prove the formula; they cannot tell you whether the result reads
 * as insight. This prints the pick and the sentence for each archetype so a
 * human can answer the only question that matters:
 *
 *     Is this genuinely the one market I would show someone first?
 *
 * The fixtures are SHAPED BY PRODUCTION, not invented. Measured over all 2,770
 * markets: 789 have any participant (28.5%); among those, room sizes run
 * p50 1 · p75 2 · p90 4 · p95 5 · max 37, and total capital runs
 * p50 $0.93 · p90 $7.68 · p95 $22.90 · max $503. Only 204 markets have both
 * sides held — the entire population in which a disagreement is possible.
 *
 * Numbers this small are the reason the thresholds in `profile-start-here` are
 * percentile-anchored rather than round. Re-run this after changing any of
 * them: a weight that reads sensibly in isolation can still make every real
 * profile open on the same kind of market.
 *
 *   npx tsx scripts/check-start-here.ts
 */
import { rankStartCandidates, type StartCandidate } from "../src/domain/profile-start-here";

const m = (o: Partial<StartCandidate> & { marketId: number; title: string }): StartCandidate => ({
  personSide: "YES",
  valueUsd: 1,
  daysHeld: 30,
  tenureIsFloor: false,
  againstPct: null,
  participants: 1,
  viewerSide: null,
  category: "crypto",
  topicUsuallyAligned: false,
  isLargest: false,
  isLongest: false,
  ...o,
});

interface Scenario {
  name: string;
  hasViewer: boolean;
  candidates: StartCandidate[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "Very few positions (2), median rooms",
    hasViewer: true,
    candidates: [
      m({ marketId: 1, title: "Will Base flip Arbitrum by 2027?", isLargest: true, valueUsd: 2 }),
      m({ marketId: 2, title: "Is remote work permanent?", daysHeld: 4 }),
    ],
  },
  {
    name: "Many positions (40), all small and quiet",
    hasViewer: true,
    candidates: Array.from({ length: 40 }, (_, i) =>
      m({
        marketId: i + 1,
        title: `Small market ${i + 1}`,
        valueUsd: 0.9,
        participants: i % 4 === 0 ? 2 : 1,
        daysHeld: 5 + i,
        isLargest: i === 17,
        isLongest: i === 39,
      }),
    ),
  },
  {
    name: "Strong agreement — you back the same side everywhere",
    hasViewer: true,
    candidates: [1, 2, 3, 4, 5].map((i) =>
      m({
        marketId: i,
        title: `Agreed market ${i}`,
        viewerSide: "YES",
        personSide: "YES",
        participants: 3,
        topicUsuallyAligned: true,
        isLargest: i === 3,
        valueUsd: i === 3 ? 18 : 1,
      }),
    ),
  },
  {
    name: "Strong disagreement — opposite sides across the board",
    hasViewer: true,
    candidates: [1, 2, 3, 4, 5].map((i) =>
      m({
        marketId: i,
        title: `Contested market ${i}`,
        viewerSide: "NO",
        personSide: "YES",
        participants: i === 1 ? 6 : 3,
        topicUsuallyAligned: i === 1,
        isLargest: i === 5,
      }),
    ),
  },
  {
    name: "No shared markets (signed in, never overlapped)",
    hasViewer: true,
    candidates: [
      m({
        marketId: 1,
        title: "Will AI write most production code?",
        isLargest: true,
        valueUsd: 23,
        participants: 5,
      }),
      m({ marketId: 2, title: "Does the four-day week stick?", daysHeld: 210, isLongest: true }),
      m({ marketId: 3, title: "Will college enrolment fall again?", participants: 2 }),
    ],
  },
  {
    name: "Signed OUT visitor",
    hasViewer: false,
    candidates: [
      m({
        marketId: 1,
        title: "Will AI write most production code?",
        isLargest: true,
        valueUsd: 23,
        participants: 5,
      }),
      m({ marketId: 2, title: "Does the four-day week stick?", daysHeld: 210, isLongest: true }),
    ],
  },
  {
    name: "One huge position, everything else dust",
    hasViewer: true,
    candidates: [
      m({
        marketId: 1,
        title: "Will Bitcoin pass gold by 2035?",
        isLargest: true,
        valueUsd: 500,
        participants: 37,
      }),
      ...[2, 3, 4, 5].map((i) => m({ marketId: i, title: `Dust ${i}`, valueUsd: 0.2 })),
    ],
  },
  {
    name: "Low-participation markets only (the common case)",
    hasViewer: true,
    candidates: [1, 2, 3].map((i) =>
      m({
        marketId: i,
        title: `Quiet market ${i}`,
        participants: 1,
        valueUsd: 0.9,
        viewerSide: i === 1 ? "NO" : null,
        isLargest: i === 2,
      }),
    ),
  },
  {
    name: "Long-tenured account, timing unknowable (tenure floored)",
    hasViewer: true,
    candidates: [
      m({
        marketId: 1,
        title: "Will remote work outlast the mandate?",
        daysHeld: 512,
        tenureIsFloor: true,
        isLongest: true,
        participants: 4,
      }),
      m({
        marketId: 2,
        title: "Does crypto regulation land in 2027?",
        isLargest: true,
        valueUsd: 8,
      }),
    ],
  },
];

let missing = 0;
for (const s of SCENARIOS) {
  const ranked = rankStartCandidates(s.candidates, { personName: "Sarah", hasViewer: s.hasViewer });
  const lead = ranked[0];
  console.log(`\n── ${s.name}`);
  console.log(`   candidates: ${s.candidates.length}   explainable: ${ranked.length}`);
  if (!lead) {
    missing += 1;
    console.log("   START HERE: (none — nothing could explain itself)");
  } else {
    console.log(`   START HERE: ${lead.title}`);
    console.log(`   WHY:        ${lead.why}`);
  }
  for (const r of ranked.slice(1, 4)) console.log(`   then:       ${r.title} — ${r.why}`);
}
console.log(
  `\n${SCENARIOS.length - missing}/${SCENARIOS.length} archetypes produced a recommendation.`,
);
console.log("Read each WHY and ask: is that the one market I would show first?\n");
