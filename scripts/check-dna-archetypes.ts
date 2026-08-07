/**
 * check-dna-archetypes — what a human actually sees, for every relationship shape.
 *
 * A DETERMINISTIC harness. Zero IO, zero production access, no service-role key —
 * so it runs anywhere, in CI, and gives the same answer every time. Its job is to
 * make the DNA model's behaviour READABLE before anyone changes it, and to make a
 * change's blast radius visible as a diff in this table rather than as a surprise
 * in the product.
 *
 * It drives the REAL production code end to end and reimplements nothing:
 *
 *   applyTrade / evaluate        src/domain/domain.ts        (the position reducer)
 *   scoreRelationship            src/domain/dna/score.ts     (agreement + confidence)
 *   classifyRelationship         src/domain/dna/classify.ts  (the engine's label)
 *   presentRelationship          src/domain/relationship.ts  (the People page's label)
 *   place / bandFor              src/domain/relationship-spectrum.ts (the spectrum's)
 *
 * THE THREE LABEL COLUMNS ARE THE POINT. They are three different modules asked
 * the same question about the same relationship. When this harness was written
 * they disagreed — measured against production, all three agreed on 7.3% of real
 * overlapping pairs, and the columns are what made that legible.
 *
 * They agree now: placement is the engine's alone, and the other two present it.
 * The columns stay, and the run now FAILS if they ever diverge again — keeping
 * them collapsed into one is the point, and a single column could not prove it.
 *
 * The lifecycle archetypes (partial sell, double down, exit, re-entry, side
 * switch) are expressed as TRADES, not as hand-written positions, so what they
 * assert is the behaviour of the actual reducer rather than an assumption about
 * it. That is the difference between testing the model and testing a belief about
 * the model.
 *
 * Run:  npx tsx scripts/check-dna-archetypes.ts        (npm run check:dna-archetypes)
 *       --json   machine-readable, for diffing two revisions
 */
import { applyTrade, emptyRow, evaluate, type BeliefRow, type Trade } from "../src/domain/domain";
import { scoreRelationship, type DnaFactor } from "../src/domain/dna/score";
import { classifyRelationship } from "../src/domain/dna/classify";
import { presentRelationship, relationshipInsight } from "../src/domain/relationship";
import { place, bandLabel } from "../src/domain/relationship-spectrum";

const JSON_OUT = process.argv.includes("--json");

/** A fixed clock — an archetype must not read differently tomorrow. */
const T0 = new Date("2026-01-01T00:00:00.000Z");
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);
/** One price for every market, so price movement never leaks into an archetype. */
const PRICES = { yesPriceUsd: 0.5, noPriceUsd: 0.5 };

/* ── Building a person ───────────────────────────────────────────────────────
 * Two ways, and both end at the same place. `holds` is the shorthand for the
 * shape archetypes ("20 shared, 17 agree"); `trades` is the long form the
 * lifecycle archetypes need, because "sells half" is only meaningful as an event.
 */

type Holding = { market: number; side: "YES" | "NO"; usd: number; daysHeld?: number };

/** Shares that evaluate to `usd` on one side at the fixed price. */
const sharesFor = (usd: number) => usd / 0.5;

function fromHoldings(hs: Holding[]): DnaFactor[] {
  return hs.map((h) => {
    const row: BeliefRow = {
      ...emptyRow(),
      yes_shares: h.side === "YES" ? sharesFor(h.usd) : 0,
      no_shares: h.side === "NO" ? sharesFor(h.usd) : 0,
      yes_cost: h.side === "YES" ? h.usd : 0,
      no_cost: h.side === "NO" ? h.usd : 0,
      expressed_side: h.side,
      directional_since: day(-(h.daysHeld ?? 0)),
    };
    const v = evaluate(row, PRICES, T0);
    return { marketId: h.market, side: h.side as "YES" | "NO", conviction: v.conviction };
  });
}

type Leg = {
  market: number;
  side: "YES" | "NO";
  action: "BUY" | "SELL";
  usd: number;
  onDay: number;
};

/**
 * Replay trades through the production reducer, then evaluate — exactly the two
 * steps the belief-rollup job performs. Markets the wallet has left (INACTIVE) or
 * is straddling (MIXED) drop out, which is itself one of the behaviours under
 * review, so it is deliberately NOT special-cased here.
 */
function fromTrades(legs: Leg[]): DnaFactor[] {
  const rows = new Map<number, BeliefRow>();
  for (const l of [...legs].sort((a, b) => a.onDay - b.onDay)) {
    const t: Trade = {
      side: l.side,
      direction: l.action,
      token_amount: sharesFor(l.usd),
      eth_amount: l.usd,
      ts: day(l.onDay),
    };
    rows.set(l.market, applyTrade(rows.get(l.market) ?? emptyRow(), t));
  }
  const out: DnaFactor[] = [];
  for (const [market, row] of rows) {
    const v = evaluate(row, PRICES, day(400));
    if (v.stance_side !== "YES" && v.stance_side !== "NO") continue;
    out.push({ marketId: market, side: v.stance_side, conviction: v.conviction });
  }
  return out;
}

/** N markets where both hold YES, then `disagree` markets where B flips to NO. */
function pairOf(shared: number, disagree: number, usd = 5): [DnaFactor[], DnaFactor[]] {
  const a: Holding[] = [];
  const b: Holding[] = [];
  for (let i = 1; i <= shared; i++) {
    a.push({ market: i, side: "YES", usd });
    b.push({ market: i, side: i > shared - disagree ? "NO" : "YES", usd });
  }
  return [fromHoldings(a), fromHoldings(b)];
}

/* ── Reporting ───────────────────────────────────────────────────────────── */

interface Report {
  archetype: string;
  matchPct: number;
  shared: number;
  together: number;
  apart: number;
  confidence: number;
  engineLabel: string;
  peopleLabel: string;
  spectrumLabel: string;
  spectrumPosition: number;
  humanLine: string;
}

/** Topic breadth is not what these archetypes vary, so it is held constant and
 *  generous — otherwise every earned label would fail for the same uninteresting
 *  reason and the table would say nothing about the shapes it is testing. */
const TOPICS = 4;

function report(name: string, a: DnaFactor[], b: DnaFactor[]): Report {
  const s = scoreRelationship(a, b);
  const engine = classifyRelationship({ currentScore: s }).relationship;
  const p = presentRelationship({
    agreement: s.agreement,
    sharedConvictions: s.sharedBeliefs,
    together: s.sameSideBeliefs,
    apart: s.oppositeSideBeliefs,
    topicCount: TOPICS,
    confidence: s.confidence,
  });
  // The group comes from the presentation layer, which got it from the engine.
  // Passing it — rather than letting the spectrum re-derive a band from
  // `position` — is the whole point of the consolidation.
  const sp = place({
    alignmentPct: p.alignmentPct,
    confidence: p.confidence,
    earned: p.earnedLabel,
    group: p.group,
  });
  return {
    archetype: name,
    matchPct: Math.round(s.agreement),
    shared: s.sharedBeliefs,
    together: s.sameSideBeliefs,
    apart: s.oppositeSideBeliefs,
    confidence: Number(s.confidence.toFixed(3)),
    engineLabel: engine,
    peopleLabel: p.earnedLabel ?? p.group,
    spectrumLabel: bandLabel(sp.band) ?? "—",
    spectrumPosition: Number(sp.position.toFixed(3)),
    humanLine: relationshipInsight(p),
  };
}

/* ── The archetypes ─────────────────────────────────────────────────────────
 * Shape cases first (what the relationship IS), then lifecycle cases (what
 * HAPPENS to it), then the capital cases the review flagged as pathological. */

const cases: { name: string; a: DnaFactor[]; b: DnaFactor[] }[] = [];
const add = (name: string, [a, b]: [DnaFactor[], DnaFactor[]]) => cases.push({ name, a, b });

// ── shape ──
add("Perfect but thin — 2 shared · 2 agree", pairOf(2, 0));
add("Thin split — 2 shared · 1 agree", pairOf(2, 1));
add("Strong Tribe — 20 shared · 17 agree", pairOf(20, 3));
add("Near-perfect deep — 30 shared · 29 agree", pairOf(30, 1));
add("Balanced — 20 shared · 10 agree", pairOf(20, 10));
add("Strong Opp — 20 shared · 3 agree", pairOf(20, 17));
add("Total opposition — 20 shared · 0 agree", pairOf(20, 20));
add("At the evidence floor — 5 shared · 5 agree", pairOf(5, 0));
add("Just below the floor — 4 shared · 4 agree", pairOf(4, 0));

// ── lifecycle: both start YES on the same 12 markets, then one of them acts ──
const BOTH = 12;
const baseline = (): Leg[] =>
  Array.from({ length: BOTH }, (_, i) => ({
    market: i + 1,
    side: "YES" as const,
    action: "BUY" as const,
    usd: 20,
    onDay: 0,
  }));

const anchor = fromTrades(baseline());
const lifecycle = (name: string, extra: Leg[]) =>
  cases.push({ name, a: anchor, b: fromTrades([...baseline(), ...extra]) });

lifecycle("Lifecycle · untouched (control)", []);
lifecycle("Lifecycle · buys MORE YES on market 1", [
  { market: 1, side: "YES", action: "BUY", usd: 500, onDay: 10 },
]);
lifecycle("Lifecycle · partially sells 50% of market 1", [
  { market: 1, side: "YES", action: "SELL", usd: 10, onDay: 10 },
]);
lifecycle("Lifecycle · partially sells 90% of market 1", [
  { market: 1, side: "YES", action: "SELL", usd: 18, onDay: 10 },
]);
lifecycle("Lifecycle · fully EXITS market 1", [
  { market: 1, side: "YES", action: "SELL", usd: 20, onDay: 10 },
]);
lifecycle("Lifecycle · exits market 1, RE-ENTERS YES later", [
  { market: 1, side: "YES", action: "SELL", usd: 20, onDay: 10 },
  { market: 1, side: "YES", action: "BUY", usd: 20, onDay: 40 },
]);
lifecycle("Lifecycle · SWITCHES market 1 from YES to NO", [
  { market: 1, side: "YES", action: "SELL", usd: 20, onDay: 10 },
  { market: 1, side: "NO", action: "BUY", usd: 20, onDay: 11 },
]);
lifecycle("Lifecycle · exits FOUR of twelve markets", [
  { market: 1, side: "YES", action: "SELL", usd: 20, onDay: 10 },
  { market: 2, side: "YES", action: "SELL", usd: 20, onDay: 10 },
  { market: 3, side: "YES", action: "SELL", usd: 20, onDay: 10 },
  { market: 4, side: "YES", action: "SELL", usd: 20, onDay: 10 },
]);
lifecycle("Lifecycle · adds NO alongside YES on market 1 (straddle)", [
  { market: 1, side: "NO", action: "BUY", usd: 20, onDay: 10 },
]);

// ── capital: the cases the review found pathological ──
{
  const a: Holding[] = [];
  const b: Holding[] = [];
  for (let i = 1; i <= 19; i++) {
    a.push({ market: i, side: "YES", usd: 5 });
    b.push({ market: i, side: "YES", usd: 5 });
  }
  a.push({ market: 20, side: "YES", usd: 5000 });
  b.push({ market: 20, side: "NO", usd: 5000 });
  cases.push({
    name: "Capital · 19/20 agree, the ONE disagreement holds $5,000",
    a: fromHoldings(a),
    b: fromHoldings(b),
  });
}
{
  const a: Holding[] = [];
  const b: Holding[] = [];
  for (let i = 1; i <= 10; i++) {
    a.push({ market: i, side: "YES", usd: 1 });
    b.push({ market: i, side: "YES", usd: 1 });
  }
  for (let i = 11; i <= 20; i++) {
    a.push({ market: i, side: "YES", usd: 1 });
    b.push({ market: i, side: "NO", usd: 1 });
  }
  a[0] = { market: 1, side: "YES", usd: 10_000 };
  b[0] = { market: 1, side: "YES", usd: 10_000 };
  cases.push({
    name: "Capital · 10 agree / 10 disagree, one agreement holds $10,000",
    a: fromHoldings(a),
    b: fromHoldings(b),
  });
}
{
  const a: Holding[] = [
    { market: 1, side: "YES", usd: 0.02 },
    { market: 2, side: "YES", usd: 0.03 },
  ];
  cases.push({
    name: "Capital · 2 shared, both agree, three cents each",
    a: fromHoldings(a),
    b: fromHoldings(a),
  });
}

// ── duration: identical sides, wildly different holding times ──
{
  const fresh: Holding[] = [];
  const held: Holding[] = [];
  for (let i = 1; i <= 20; i++) {
    fresh.push({ market: i, side: "YES", usd: 20, daysHeld: 0 });
    held.push({ market: i, side: "YES", usd: 20, daysHeld: 300 });
  }
  cases.push({
    name: "Duration · 20 shared, all agree, one held 300d vs one held 0d",
    a: fromHoldings(fresh),
    b: fromHoldings(held),
  });
}

/* ── Output ─────────────────────────────────────────────────────────────── */

const reports = cases.map((c) => report(c.name, c.a, c.b));

if (JSON_OUT) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  const num = (v: number | string, n: number) => String(v).padStart(n);
  console.log("\nDNA ARCHETYPES — what a person actually sees\n");
  console.log(
    `${pad("archetype", 52)} ${num("match", 6)} ${num("shrd", 5)} ${num("tog", 4)} ${num("apt", 4)} ${num("conf", 6)}  ${pad("engine", 13)} ${pad("people", 13)} ${pad("spectrum", 10)} human line`,
  );
  console.log("─".repeat(160));
  let last = "";
  for (const r of reports) {
    const group = r.archetype.split(" · ")[0].split(" — ")[0];
    if (group !== last && last !== "") console.log("");
    last = group;
    console.log(
      `${pad(r.archetype, 52)} ${num(`${r.matchPct}%`, 6)} ${num(r.shared, 5)} ${num(r.together, 4)} ${num(r.apart, 4)} ${num(r.confidence.toFixed(2), 6)}  ${pad(r.engineLabel, 13)} ${pad(r.peopleLabel, 13)} ${pad(r.spectrumLabel, 10)} ${r.humanLine}`,
    );
  }

  // The three label columns exist to be compared; say out loud how often they
  // disagree rather than leaving it to be noticed.
  const norm = (r: Report) => ({
    engine:
      r.engineLabel === "twin" || r.engineLabel === "tribe"
        ? "aligned"
        : r.engineLabel === "opp" || r.engineLabel === "inverse"
          ? "opposed"
          : "unplaced",
    people:
      r.peopleLabel === "twin" || r.peopleLabel === "tribe"
        ? "aligned"
        : r.peopleLabel === "opp" || r.peopleLabel === "rival"
          ? "opposed"
          : "unplaced",
    spectrum:
      r.spectrumLabel === "Twin" || r.spectrumLabel === "Tribe"
        ? "aligned"
        : r.spectrumLabel === "Opponent" || r.spectrumLabel === "Rival"
          ? "opposed"
          : "unplaced",
  });
  const split = reports.filter((r) => {
    const n = norm(r);
    return !(n.engine === n.people && n.people === n.spectrum);
  });
  console.log("─".repeat(160));
  if (split.length === 0) {
    console.log(
      "\nAll three modules agree on every archetype — one authority, three presentations.\n",
    );
  } else {
    console.log(
      `\n${split.length} of ${reports.length} archetypes get a DIFFERENT answer from the three modules that classify relationships:`,
    );
    for (const r of split) {
      const n = norm(r);
      console.log(
        `  ${pad(r.archetype, 52)} engine=${n.engine}  people=${n.people}  spectrum=${n.spectrum}`,
      );
    }
    console.log("");
  }

  /**
   * NON-ZERO ON ANY DISAGREEMENT — this is a gate, not a printout.
   *
   * It earned that within an hour of being written. `scripts/` is not in
   * tsconfig's `include`, so when `place()` grew a required `group` argument
   * this file kept compiling, kept running, and quietly reported EVERY
   * relationship as unplaced. The table looked plausible and was wrong. A
   * report nobody can fail is worth very little; one that breaks the build
   * when the modules drift apart again is the whole reason it exists.
   */
  if (split.length > 0) process.exitCode = 1;
}
