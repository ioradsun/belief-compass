/**
 * check:lens-coverage — is every Explore lens label telling the truth?
 *
 * A ranking lens can only rank what the candidate pool lets it see. "Most
 * Capital" over a pool with no capital ordering does not mean "the markets with
 * the most capital" — it means "the most capital among the markets the other
 * rules happened to admit", which is not what the interface says.
 *
 * So for each lens this rebuilds the pool exactly as `poolRows` does, computes
 * the TRUE platform-wide ranking for that lens's measure by reading every
 * market, and reports how much of the true Top N the pool actually contains.
 *
 * WHAT A FAILURE LOOKS LIKE. Before the capital slice existed this printed
 *   Most Capital   true Top 20 represented: 5/20
 * which is the measurement that justified the migration.
 *
 * FOR YOU IS DELIBERATELY NOT SCORED ON TOP-N. Its ranking is viewer-relative —
 * the composite score depends on the reader's own history, their DNA overlay and
 * their follows — so there is no single platform-wide "true top 20" to compare
 * against. Its invariant is different and is checked instead: the pool must be
 * large enough, and drawn from enough different orderings, that the ranker has
 * something to choose from for every component it weighs.
 *
 * Run:  npx tsx scripts/check-lens-coverage.ts   (npm run check:lens-coverage)
 * Env:  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (falls back to the publishable
 *       key, which cannot read `market_participation` — see the note it prints).
 */
import { createClient } from "@supabase/supabase-js";
import { POOL, POOL_SLICES, buildPool, type PoolSlice } from "../src/domain/feed/pool";
import { participantCount } from "../src/domain/participants";
import { LENSES, LENS_LABELS, type Lens } from "../src/domain/feed/lens";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const key = serviceKey ?? process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Need SUPABASE_URL and a key.");
  process.exit(1);
}
const sb = createClient(url, key);

const TOP_N = 20;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const FEED_COLUMNS = `onchain_id, believers_yes, believers_no, directional_believers,
  yes_capital_usd, no_capital_usd, volume_total_usd, market_created_at, last_trade_at,
  opportunity_type, opportunity_score, trade_count_24h`;

/** Only the columns the TRUTH needs — read over every market, by this script alone. */
const TRUTH_COLS =
  "onchain_id, believers_yes, believers_no, yes_capital_usd, no_capital_usd, " +
  "market_created_at, trade_count_24h";

interface Row {
  onchain_id: number;
  [k: string]: unknown;
}

/** Every market. Only this script reads the whole table; the feed never does. */
async function everyMarket(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("market_state")
      .select(TRUTH_COLS)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function participation(): Promise<Map<number, number>> {
  const { data, error } = await sb.rpc("market_participation");
  if (error) return new Map();
  const m = new Map<number, number>();
  for (const p of (data ?? []) as { onchain_id: number; participants: number }[]) {
    m.set(Number(p.onchain_id), Number(p.participants) || 0);
  }
  return m;
}

/**
 * THE REAL SLICES, run against the real database.
 *
 * An earlier version of this script simulated the slices in memory from a full
 * table read. It would have printed "Most Capital 20/20" on a database with no
 * `capital_usd` column at all — reporting success for a query that cannot run.
 * A harness that can pass for work that did not happen is worse than no harness,
 * so the slices are issued exactly as `poolRows` issues them and a slice that
 * errors is reported as the failure it is.
 */
async function realSlices(reach: Map<number, number>) {
  const q = () => sb.from("market_state").select(FEED_COLUMNS);
  const sinceActive = new Date(Date.now() - 7 * 24 * 3600e3).toISOString();

  const topParticipantIds = [...reach.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, POOL.slices.participants.fetch)
    .map(([id]) => id);

  const [active, fresh, classified, believed, deep, capital, moving] = await Promise.all([
    q()
      .gte("last_trade_at", sinceActive)
      .order("last_trade_at", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.active.fetch),
    q()
      .order("market_created_at", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.fresh.fetch),
    q()
      .not("opportunity_type", "is", null)
      .order("opportunity_score", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.classified.fetch),
    q()
      .gt("directional_believers", 0)
      .order("directional_believers", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.believed.fetch),
    q()
      .order("volume_total_usd", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.deep.fetch),
    q()
      .order("capital_usd", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.capital.fetch),
    q()
      .gt("trade_count_24h", 0)
      .order("trade_count_24h", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.moving.fetch),
  ]);
  const participants = topParticipantIds.length
    ? await q().in("onchain_id", topParticipantIds)
    : { data: [], error: null };

  const results = { active, fresh, classified, believed, deep, capital, moving, participants };
  const broken: string[] = [];
  const bySlice: Partial<Record<PoolSlice, { onchainId: number }[]>> = {};
  for (const [name, r] of Object.entries(results) as [PoolSlice, typeof active][]) {
    if (r.error) broken.push(`${name}: ${r.error.message}`);
    bySlice[name] = ((r.data ?? []) as unknown as Row[]).map((row) => ({
      ...row,
      onchainId: Number(row.onchain_id),
    }));
  }
  // `.in()` returns database order, not the order asked for — the server
  // re-imposes the ranking and so must this, or the measurement describes a
  // different pool than the one that ships.
  const rank = new Map(topParticipantIds.map((id, i) => [id, i]));
  bySlice.participants?.sort(
    (a, b) =>
      (rank.get(a.onchainId) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.onchainId) ?? Number.MAX_SAFE_INTEGER),
  );
  return { bySlice, broken };
}

async function main() {
  const all = await everyMarket();
  const reach = await participation();
  const hasReach = reach.size > 0;
  const { bySlice, broken } = await realSlices(reach);
  if (broken.length > 0) {
    console.log("SLICE QUERIES FAILING — the pool is degraded and a lens label may be false:");
    for (const b of broken) console.log(`  ${b}`);
    console.log("");
  }

  const capitalOf = (r: Row) => num(r.yes_capital_usd) + num(r.no_capital_usd);
  const participantsOf = (r: Row) =>
    participantCount({
      reachParticipants: reach.get(Number(r.onchain_id)) ?? 0,
      believersYes: num(r.believers_yes),
      believersNo: num(r.believers_no),
    });
  const createdOf = (r: Row) => {
    const t = Date.parse(String(r.market_created_at ?? ""));
    return Number.isFinite(t) ? t : 0;
  };
  const desc = (k: (r: Row) => number) => (a: Row, b: Row) => k(b) - k(a);

  const pool = buildPool({ bySlice: bySlice as never });
  const inPool = new Set(pool.markets.map((m) => m.row.onchainId));

  console.log(`markets on the platform : ${all.length}`);
  console.log(`candidate pool          : ${inPool.size} (ceiling ${POOL.total})`);
  console.log(
    `slice contributions     : ${POOL_SLICES.map((s) => `${s} ${pool.claimed[s]}`).join(" · ")}`,
  );
  if (!hasReach) {
    console.log(
      "\nNOTE: market_participation is service-role only and this run has no\n" +
        "service key, so the participants SLICE is empty here and the truth\n" +
        "column falls back to believers-per-side. Both the slice contribution and\n" +
        "the Most Participants row below therefore understate the real result —\n" +
        "re-run with SUPABASE_SERVICE_ROLE_KEY for the number that ships.",
    );
  }
  console.log("");

  // ── Coverage per lens ────────────────────────────────────────────────────
  let worst = 1;
  const report = (lens: Lens, truth: Row[], note = "") => {
    const top = truth.slice(0, TOP_N).map((r) => Number(r.onchain_id));
    const have = top.filter((id) => inPool.has(id)).length;
    const denom = top.length;
    if (denom > 0) worst = Math.min(worst, have / denom);
    const flag = denom === 0 ? "—" : have === denom ? "OK  " : "MISS";
    console.log(
      `${flag} ${LENS_LABELS[lens].padEnd(18)} true Top ${denom} represented: ${have}/${denom}${note}`,
    );
    if (have < denom) {
      const missing = top.filter((id) => !inPool.has(id));
      console.log(`      missing: ${missing.join(", ")}`);
    }
  };

  for (const lens of LENSES) {
    if (lens === "for_you") continue;
    if (lens === "capital") report(lens, all.filter((r) => capitalOf(r) > 0).sort(desc(capitalOf)));
    if (lens === "participants")
      report(lens, all.filter((r) => participantsOf(r) > 0).sort(desc(participantsOf)));
    if (lens === "fresh") report(lens, [...all].sort(desc(createdOf)));
    if (lens === "moving") {
      // Moving's truth is "traded recently", which is what the classifier can
      // possibly see: momentum is derived from window baselines the pool builds,
      // so a market that has not traded cannot be moving by any definition.
      const traded = all
        .filter((r) => num(r.trade_count_24h) > 0)
        .sort(desc((r) => num(r.trade_count_24h)));
      report(lens, traded, traded.length < TOP_N ? `  (only ${traded.length} traded in 24h)` : "");
    }
  }

  // For You: no platform-wide truth to compare against. Check the invariant
  // that actually matters — the ranker has real choice from every ordering.
  const starved = POOL_SLICES.filter((s) => pool.claimed[s] === 0);
  console.log(
    `${starved.length === 0 ? "OK  " : "WARN"} ${"For You".padEnd(18)} viewer-relative: no platform Top-N applies.`,
  );
  console.log(
    `      invariant: every ordering contributes candidates — ${
      starved.length === 0 ? "all 7 slices seated" : `STARVED: ${starved.join(", ")}`
    }`,
  );

  if (worst < 1) {
    console.log("\nA lens label promises more than the pool can deliver. Exiting nonzero.");
    process.exit(1);
  }
  console.log("\nEvery ranking lens can see its own true Top 20.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
