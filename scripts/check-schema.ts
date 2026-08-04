/**
 * check-schema — is the database actually shaped the way the code believes?
 *
 * A migration that was written, committed and reviewed but never APPLIED is
 * indistinguishable, from inside the app, from a quiet day. This has now cost
 * three separate features:
 *
 *   · `market_transition_state` missing  → the Story Engine's select 404'd,
 *     `states` came back null, the loop ran zero times, and the emitter returned
 *     0. Zero market_transition rows had EVER been written.
 *   · `market_state.yes_capital_delta_24h` missing → the same select 400'd, for
 *     the same silent nothing.
 *   · `calc_cache` readable only by service_role → the feed priced every trade
 *     at $0 and discarded them all as dust.
 *
 * None of those threw where anyone could see. PostgREST answers a missing table
 * with 404, a missing column with 400/42703, and a blocked one with 401 or an
 * empty 200 — and application code that destructures only `{ data }` turns every
 * one of them into "nothing happened".
 *
 * So this asserts the SHAPE the code depends on, names the migration that
 * provides each thing, and fails loudly. Run it after every deploy.
 *
 * RUNS AS THE PUBLIC CLIENT, deliberately (see check-feed-supply): a checker
 * with more access than the thing it checks will certify a broken system. A 401
 * here means "exists but restricted", which is a pass for anything the app only
 * reads server-side — the point is to separate that from "does not exist".
 *
 * Run:  npx tsx scripts/check-schema.ts
 * Env:  SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)
 */
const url = process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY");
  process.exit(2);
}

interface Requirement {
  /** What breaks when this is missing — written for whoever reads the failure. */
  feature: string;
  table: string;
  /** Columns the code selects by name. A missing one fails the whole select. */
  columns?: string[];
  /** The migration that provides it, so the fix is one command away. */
  migration: string;
  /** True when the app reads this with the ANON key and a 401 is fatal. */
  anonMustRead?: boolean;
  /**
   * What to say when the table EXISTS and is readable but holds no rows. For
   * most requirements that means RLS-with-no-policy and the migration is the
   * fix. For a table a background job fills, it means the WRITER is not writing
   * — a different problem with a different fix, and naming the migration there
   * would send whoever reads the failure to the wrong place.
   */
  emptyMeans?: string;
}

const REQUIRED: Requirement[] = [
  {
    feature: "Live tape — the event stream itself",
    table: "events",
    columns: ["source_key", "kind", "market_id", "side", "action", "amount_eth", "occurred_at"],
    migration: "20260729000000_events_canonical_log.sql",
    anonMustRead: true,
  },
  {
    feature: "Live tape — market titles and sizes",
    table: "market_state",
    columns: ["onchain_id", "believers_yes", "believers_no", "volume_total_usd"],
    migration: "20260801000000_market_read_model.sql",
    anonMustRead: true,
  },
  {
    feature: "Trade amounts in USD — without this every trade is priced $0",
    table: "calc_cache",
    columns: ["key", "value"],
    migration: "20260823000000_calc_cache_public_read.sql",
    anonMustRead: true,
  },
  {
    feature: "Story Engine — per-side 24h capital deltas",
    table: "market_state",
    columns: ["yes_capital_delta_24h", "no_capital_delta_24h"],
    migration: "20260822000000_market_state_capital_deltas.sql",
    anonMustRead: true,
  },
  {
    feature: "Story Engine — the 24h baseline those deltas are measured against",
    table: "market_state_snapshots",
    columns: ["onchain_id", "captured_at", "yes_capital_usd", "no_capital_usd"],
    migration: "20260818000000_market_state_snapshots.sql",
    // Readable by anon by design, and a row per market every poll — so zero rows
    // is never "quiet", it is "nobody wrote".
    anonMustRead: true,
    emptyMeans:
      "the table exists but NOTHING HAS WRITTEN TO IT.\n" +
      "      snapshot_market_state() is called by the pov-poller's maintenance tail.\n" +
      "      POST the poller and read state_snapshot_rows / state_snapshot_error in\n" +
      "      the response. Until this table has ~24h of history, every market's\n" +
      "      yes_capital_delta_24h / no_capital_delta_24h stays null and the Story\n" +
      "      Engine loses one of its two inputs.",
  },
  {
    feature: "Story Engine — transition persistence and dedup",
    table: "market_transition_state",
    columns: ["onchain_id", "fingerprint", "seen_count"],
    migration: "20260821000000_market_transition_state.sql",
  },
  {
    feature: "Conviction cohorts — how long each belief has been held",
    table: "wallet_beliefs",
    columns: ["wallet", "onchain_id", "first_backed_at", "yes_value_usd"],
    migration: "20260728014054_f5d44cbf-f36b-4330-927f-94ef77e3dda8.sql",
  },
  {
    feature: "Discovery moments — the viewer's relationship cache",
    table: "viewer_dna_cache",
    columns: ["viewer_wallet", "twin_matches", "inverse_matches"],
    migration: "20260803000000_viewer_dna_cache.sql",
  },
];

type Verdict = "ok" | "missing_table" | "missing_column" | "blocked" | "empty" | "error";

async function probe(r: Requirement): Promise<{ verdict: Verdict; detail: string }> {
  const cols = (r.columns ?? ["*"]).join(",");
  const res = await fetch(`${url}/rest/v1/${r.table}?select=${cols}&limit=1`, {
    headers: { apikey: key as string, Authorization: `Bearer ${key}` },
  });
  const body = await res.text();
  if (res.status === 404) return { verdict: "missing_table", detail: "table does not exist" };
  if (res.status === 401 || res.status === 403)
    return { verdict: "blocked", detail: "exists, not readable by anon" };
  if (res.status === 400) {
    // 42703 is Postgres for "column does not exist" — the precise signal.
    // Capture the QUALIFIED name — a lazy match here grabbed the last letter.
    const m = /column ([\w.]+) does not exist/i.exec(body);
    return {
      verdict: body.includes("42703") ? "missing_column" : "error",
      detail: m ? `column ${m[1]} does not exist` : body.slice(0, 120),
    };
  }
  if (!res.ok) return { verdict: "error", detail: `HTTP ${res.status} ${body.slice(0, 100)}` };
  const rows = JSON.parse(body) as unknown[];
  // Readable but empty, on a table the app needs rows from, is the RLS-with-no-
  // policy signature — identical to an empty table from inside the app.
  if (rows.length === 0 && r.anonMustRead) return { verdict: "empty", detail: "0 rows visible" };
  return { verdict: "ok", detail: `${rows.length} row(s)` };
}

async function main() {
  console.log("\n═══ SCHEMA (as the public client) ═══\n");
  const broken: Requirement[] = [];
  // Unmet requirements whose fix is NOT a migration — the shape is right and a
  // job is failing to fill it. Listing these under "apply these migrations"
  // would be actively misleading.
  const stalled: Requirement[] = [];
  for (const r of REQUIRED) {
    const { verdict, detail } = await probe(r);
    // A restricted table the app only reads server-side is fine — the check is
    // whether it EXISTS, and 401 proves it does.
    const fatal =
      verdict === "missing_table" ||
      verdict === "missing_column" ||
      verdict === "error" ||
      (verdict === "empty" && !!r.anonMustRead) ||
      (verdict === "blocked" && !!r.anonMustRead);
    const stall = fatal && verdict === "empty" && !!r.emptyMeans;
    if (fatal) (stall ? stalled : broken).push(r);
    const mark = fatal ? "✗" : verdict === "ok" ? "✓" : "·";
    console.log(`  ${mark} ${r.table.padEnd(24)} ${verdict.padEnd(15)} ${detail}`);
    console.log(`      ${r.feature}`);
    if (!fatal) continue;
    // An empty table with a known writer is a stalled JOB, not a missing
    // migration. Send the reader to the thing that is actually broken.
    if (verdict === "empty" && r.emptyMeans) console.log(`      ${r.emptyMeans}`);
    else console.log(`      NOT APPLIED → supabase/migrations/${r.migration}`);
  }

  if (broken.length === 0 && stalled.length === 0) {
    console.log("\n✓ the database matches what the code expects.\n");
    process.exit(0);
  }
  if (broken.length > 0) {
    console.error(`\n✗ ${broken.length} requirement(s) unmet. Apply, in order:\n`);
    for (const m of [...new Set(broken.map((b) => b.migration))].sort())
      console.error(`    supabase/migrations/${m}`);
    console.error(
      "\n  Until then the features above produce NOTHING, silently — which is exactly\n" +
        "  how a written-but-unapplied migration hides.\n",
    );
  }
  if (stalled.length > 0) {
    console.error(
      `\n✗ ${stalled.length} table(s) exist and are correctly shaped but EMPTY.\n` +
        "  Nothing to migrate — a background job is not writing. See the note above each.\n",
    );
  }
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
