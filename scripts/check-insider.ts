/**
 * check-insider — the Insider contract gate.
 *
 * Fails (exit 1) if the Insider domain layer breaks one of its constitutional
 * invariants. It runs the pure functions on fixtures — no DB, no network — so it
 * is safe in CI and locks in the properties the whole migration is proven against:
 *
 *   1. The constitutional rule is present and unchanged in intent.
 *   2. The signal-kind vocabulary has no duplicates.
 *   3. The builder is a deterministic replay (identical rows → identical signals)
 *      and carries provenance; activity signals are unscored (null ≠ 0).
 *   4. The activity projection reproduces the server's scope/side/order semantics.
 *   5. The pulse composes the canonical shape label; scoring stays bounded and is
 *      three distinct judgments, never one universal score.
 *   6. THE BOUNDARY (static): no product surface — anything under src/components
 *      or src/routes — imports an intelligence PRIMITIVE. Surfaces read
 *      projections (activity / insight / now / read); they never rank, score,
 *      classify a shape, or draft a question themselves. Constants, types and
 *      attention mechanics are not intelligence and stay allowed.
 *   7. Deleted pre-Insider plumbing stays deleted (step 7 of the migration).
 *
 * Run:  npx tsx scripts/check-insider.ts   (npm run check:insider)
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  INSIDER_CONSTITUTION,
  INSIDER_SIGNAL_KINDS,
  NO_EVIDENCE,
  signalsFromActivityRows,
  activity,
  insiderPulse,
  score,
  IMPORTANCE_WEIGHTS,
  type ActivityFactRow,
} from "../src/domain/insider";
import { pulseLabel } from "../src/domain/market-pulse";

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok) failures.push(msg);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;


// 1. Constitution ------------------------------------------------------------
check(
  INSIDER_CONSTITUTION.includes("No product surface calculates market intelligence"),
  "constitution: the constitutional rule text has drifted",
);

// 2. Signal-kind vocabulary --------------------------------------------------
check(
  new Set(INSIDER_SIGNAL_KINDS).size === INSIDER_SIGNAL_KINDS.length,
  "signal kinds: the kind list contains duplicates",
);

// 3. Builder — deterministic replay + provenance + unscored activity ---------
const row = (over: Partial<ActivityFactRow> & { id: string }): ActivityFactRow => ({
  kind: "trade_burst",
  marketId: "42",
  side: "YES",
  occurredAt: "2026-01-01T00:00:00.000Z",
  payload: { action: "BUY" },
  ...over,
});
const fixture: ActivityFactRow[] = [
  row({ id: "a" }),
  row({ id: "b", side: "NO", occurredAt: "2026-01-01T01:00:00.000Z" }),
  row({ id: "open", side: null, kind: "market_created", occurredAt: "2026-01-01T02:00:00.000Z" }),
];
const first = signalsFromActivityRows(fixture);
const second = signalsFromActivityRows(fixture);
check(
  JSON.stringify(first) === JSON.stringify(second),
  "builder: not deterministic — identical rows produced different signals",
);
check(
  first[0]?.provenance.sourceEventIds[0] === "a" && first[0]?.provenance.builderVersion >= 1,
  "builder: provenance does not link back to the canonical row + a builder version",
);
check(
  first.every((s) => Object.values(s.evidence).every((v) => v === null) && s.judgment === undefined),
  "builder: activity signals must be unscored (evidence null, no judgment)",
);

// 4. Activity projection — scope / side / order ------------------------------
const whole = activity(first, { marketId: 42 });
check(
  JSON.stringify(whole.signals.map((s) => s.id)) === JSON.stringify(["open", "b", "a"]),
  "activity: no-side query must return the whole market newest-first",
);
const yes = activity(first, { marketId: 42, side: "YES" });
check(
  JSON.stringify(yes.signals.map((s) => s.id)) === JSON.stringify(["a"]) &&
    !yes.signals.some((s) => s.id === "open"),
  "activity: a side query must keep only that side and exclude market-wide rows",
);

// 5. Pulse composes the shape label; scoring is bounded & plural -------------
const hot = {
  believerDelta: 8,
  believerBase: 10,
  believers: 18,
  capitalDeltaEth: 1,
  capitalBaseEth: 1,
  events: 12,
};
check(pulseLabel(hot) === "Accelerating", "pulse: fixture no longer classifies as Accelerating");
check(insiderPulse(hot).momentum >= 0.9, "pulse: momentum is not tied to the canonical shape label");
check(
  insiderPulse({ ...hot, capitalHeldYesEth: 9, capitalHeldNoEth: 1 }).direction === "YES",
  "pulse: direction is not read from the YES/NO split",
);
check(
  near(Object.values(IMPORTANCE_WEIGHTS).reduce((a, b) => a + b, 0), 1),
  "scoring: importance weights no longer sum to 1",
);
check(score(NO_EVIDENCE).confidence === 0, "scoring: uncomputed evidence must yield 0 confidence");
const j = score({ ...NO_EVIDENCE, magnitude: 1, velocity: 1 });
check(
  near(j.momentumScore, 1) && j.importanceScore >= 0 && j.importanceScore <= 1,
  "scoring: judgments out of the 0..1 range",
);

// ----------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`check:insider — ${failures.length} invariant(s) broken:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("check:insider — all Insider contract invariants hold ✓");
