/**
 * check-discovery — what the creator is told about their idea, for every shape.
 *
 * A DETERMINISTIC harness over a fixed corpus. Zero IO, no key, no network — it
 * runs anywhere and gives the same answer every time. It drives the real
 * production module (`src/domain/question-discovery`) and reimplements nothing.
 *
 * WHAT IT GUARDS, and why a table is the right shape for it. Discovery has four
 * verdicts and two of them are indistinguishable by score alone, so the only way
 * to see whether a change was an improvement is to look at every archetype at
 * once. A regression here does not throw — it quietly starts calling a different
 * class of question a duplicate, which is the failure that costs a creator their
 * idea or floods a reader with false warnings.
 *
 * IT EXITS NON-ZERO on any violation of the two invariants that must never
 * break:
 *
 *   1. Only an exact normalized match may be called `duplicate` outright.
 *   2. Activity may reorder candidates WITHIN a band and never across one.
 *
 * Run:  npx tsx scripts/check-discovery.ts   (npm run check:discovery)
 *       --json   machine-readable, for diffing two revisions
 */
import {
  buildIndex,
  discover,
  textScore,
  normalizeQuestion,
  bandFor,
  type DiscoveryDoc,
  type Liveness,
} from "../src/domain/question-discovery";

const JSON_OUT = process.argv.includes("--json");

/** A fixed clock, so "recently active" cannot drift between runs. */
const NOW = Date.parse("2026-08-07T00:00:00.000Z");

/**
 * The corpus. Every entry is a real title from production, chosen because it
 * sits on a boundary the model has to get right.
 */
const CORPUS: DiscoveryDoc[] = [
  { onchainId: 875, title: "Will France win the World Cup?" },
  { onchainId: 3, title: "Will France win World Cup 2026?" },
  { onchainId: 376, title: "Will England win the World Cup?" },
  { onchainId: 2475, title: "Will Spain win the 2026 FIFA World Cup?" },
  { onchainId: 2421, title: "Will Argentina win the 2026 World Cup?" },
  { onchainId: 4, title: "Is Messi better than Ronaldo?" },
  { onchainId: 205, title: "Is Cristiano Ronaldo better than Lionel Messi?" },
  { onchainId: 62, title: "Is Solana better than Ethereum?" },
  {
    onchainId: 2706,
    title: "Do you think Bitcoin will stay above $66,000 until the end of the month?",
  },
  { onchainId: 2580, title: "Do you think INJ will stay above $6 until the end of the month?" },
  { onchainId: 284, title: "Will $DEGEN stay the #1 meme coin on Base through 2026?" },
  { onchainId: 1001, title: "Is pineapple a acceptable topping for pizza?" },
  { onchainId: 1002, title: "Have you been cheated on before?" },
  { onchainId: 1003, title: "Will privacy become a luxury product?" },
];

/** Who is actually in these rooms — the tie-break, never the gate. */
const LIVENESS = new Map<number, Liveness>([
  [875, { participants: 3, lastActivityMs: NOW - 2 * 86_400_000, contested: 0.5 }],
  [3, { participants: 1, lastActivityMs: NOW - 20 * 86_400_000 }],
  [376, { participants: 0 }],
  [2475, { participants: 0 }],
  [2421, { participants: 4, lastActivityMs: NOW - 86_400_000, contested: 0.7 }],
  [284, { participants: 8, lastActivityMs: NOW - 3_600_000, contested: 0.3 }],
]);

const index = buildIndex(CORPUS);

interface Row {
  draft: string;
  relation: string;
  judgement: boolean;
  top: string;
  topScore: number;
  topBand: string;
  candidates: number;
  violation: string | null;
}

/** Drafts a creator might plausibly type, one per behaviour under test. */
const DRAFTS: { label: string; text: string }[] = [
  { label: "exact restatement", text: "will  FRANCE win the world cup???" },
  { label: "near-miss, same subject", text: "Will France win the 2026 World Cup?" },
  { label: "same template, new subject", text: "Will England win the 2026 World Cup?" },
  {
    label: "same template, new asset",
    text: "Do you think ETH will stay above $2,000 until the end of the month?",
  },
  { label: "reworded duplicate", text: "Is Cristiano better than Lionel?" },
  { label: "opposite question, high score", text: "Have you cheated before?" },
  { label: "related angle", text: "Will Bitcoin become Gen Z's preferred store of value?" },
  { label: "genuinely novel", text: "Will lab-grown meat outsell beef in Germany?" },
  { label: "too short to mean anything", text: "Bitcoin" },
  { label: "no subject words at all", text: "should it really be?" },
];

const rank: Record<string, number> = { duplicate: 3, ambiguous: 2, related: 1, novel: 0 };

const rows: Row[] = DRAFTS.map(({ label, text }) => {
  const d = discover(index, text, { now: NOW, liveness: LIVENESS });
  const top = d.candidates[0];

  let violation: string | null = null;

  // INVARIANT 1 — only an exact normalized match may be called duplicate.
  if (d.relation === "duplicate") {
    const key = normalizeQuestion(text);
    const exact = CORPUS.some((m) => normalizeQuestion(m.title) === key);
    if (!exact) violation = "claimed duplicate without an exact normalized match";
  }

  // INVARIANT 2 — bands are never interleaved by activity.
  const bands = d.candidates.map((c) => rank[c.band] ?? 0);
  for (let i = 1; i < bands.length; i++) {
    if (bands[i] > bands[i - 1]) {
      violation = violation ?? "activity reordered candidates ACROSS a band";
      break;
    }
  }

  return {
    draft: label,
    relation: d.relation,
    judgement: d.needsJudgement,
    top: top?.title ?? "—",
    topScore: top ? Number(top.score.toFixed(3)) : 0,
    topBand: top?.band ?? "—",
    candidates: d.candidates.length,
    violation,
  };
});

/* ── Output ─────────────────────────────────────────────────────────────── */

if (JSON_OUT) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  const num = (v: string | number, n: number) => String(v).padStart(n);

  console.log("\nQUESTION DISCOVERY — what the creator is told\n");
  console.log(
    `${pad("draft", 30)} ${pad("verdict", 10)} ${pad("ask AI", 7)} ${num("cands", 5)} ${num("score", 6)} ${pad("band", 10)} nearest existing`,
  );
  console.log("─".repeat(150));
  for (const r of rows) {
    console.log(
      `${pad(r.draft, 30)} ${pad(r.relation, 10)} ${pad(r.judgement ? "yes" : "—", 7)} ${num(r.candidates, 5)} ${num(r.topScore.toFixed(3), 6)} ${pad(r.topBand, 10)} ${r.top.slice(0, 52)}`,
    );
  }
  console.log("─".repeat(150));

  // The cost model, stated rather than assumed: how often does a draft reach AI?
  const asked = rows.filter((r) => r.judgement).length;
  console.log(
    `\n${asked} of ${rows.length} drafts need a model call — the rest are decided by retrieval alone.`,
  );

  const bad = rows.filter((r) => r.violation);
  if (bad.length === 0) {
    console.log("Both invariants hold: duplicates are exact-only, bands are never interleaved.\n");
  } else {
    console.log("\nVIOLATIONS:");
    for (const r of bad) console.log(`  ${pad(r.draft, 30)} ${r.violation}`);
    console.log("");
  }
}

/**
 * NON-ZERO ON ANY VIOLATION — this is a gate, not a printout. A report nobody
 * can fail is worth very little; one that breaks the build when discovery starts
 * accusing people on arithmetic is the whole reason it exists.
 */
if (rows.some((r) => r.violation)) process.exitCode = 1;

// A corpus that stopped discriminating would pass every check above while
// telling us nothing, so assert the fixture still exercises every outcome.
const verdicts = new Set(rows.map((r) => r.relation));
if (!verdicts.has("duplicate") || !verdicts.has("related") || !verdicts.has("novel")) {
  console.error("Fixture no longer spans the verdicts — the harness has stopped testing anything.");
  process.exitCode = 1;
}
if (!rows.some((r) => r.judgement) || !rows.some((r) => !r.judgement && r.candidates > 0)) {
  console.error("Fixture no longer exercises both the AI and the no-AI paths.");
  process.exitCode = 1;
}

// Sanity: the pair that motivated the exact-match rule must still score high.
if (textScore("Have you been cheated on before?", "Have you cheated before?") < 0.9) {
  console.error("The 0.943 opposite-question pair no longer scores high — recheck the scorer.");
  process.exitCode = 1;
}
if (bandFor(1) === "duplicate") {
  console.error("A numeric duplicate cut has reappeared.");
  process.exitCode = 1;
}
