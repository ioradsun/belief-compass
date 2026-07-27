/**
 * check-data-flow — Phase 2.5 data-flow integrity gate.
 *
 * Verifies that the single permitted path holds in production:
 *   Base log → canonical event → temporary trade projection → position calc
 * and that no duplicate/alternate path has leaked back in.
 *
 * Exits NONZERO when any critical invariant fails, so it can gate a deploy.
 *
 * Run:  npx tsx scripts/check-data-flow.ts   (or: npm run check:data-flow)
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (required)
 *       DATAFLOW_FEED_WINDOW_HOURS  window for "new trade-driven feed_events"
 *                                   check (default 24)
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const FEED_WINDOW_HOURS = Number(process.env.DATAFLOW_FEED_WINDOW_HOURS ?? "24");

type Check = { name: string; ok: boolean; detail: string; critical: boolean };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string, critical = true) =>
  checks.push({ name, ok, detail, critical });

async function headCount(build: () => unknown): Promise<number> {
  const { count } = (await build()) as { count: number | null };
  return count ?? 0;
}

async function run() {
  // ── Canonical event parity (via events_health) ─────────────────────────────
  const { data: health, error: hErr } = await sb.rpc("events_health");
  if (hErr) {
    add("events_health() available", false, hErr.message);
  } else {
    const h = health as Record<string, number>;
    add(
      "canonical chain events all have a trade projection",
      (h.chain_events_without_projection ?? 0) === 0,
      `chain_events_without_projection=${h.chain_events_without_projection}`,
    );
    add(
      "every trade projection has a canonical event",
      (h.projections_without_canonical_event ?? 0) === 0,
      `projections_without_canonical_event=${h.projections_without_canonical_event}`,
    );
    add(
      "every trade projection has provenance (event_source_key)",
      (h.projections_without_provenance ?? 0) === 0,
      `projections_without_provenance=${h.projections_without_provenance}`,
    );
    add(
      "projection occurred_at matches its canonical event",
      (h.projections_with_mismatched_occurred_at ?? 0) === 0,
      `projections_with_mismatched_occurred_at=${h.projections_with_mismatched_occurred_at}`,
    );
    add(
      "no canonical trade event is missing occurred_at",
      (h.canonical_trade_events_missing_occurred_at ?? 0) === 0,
      `canonical_trade_events_missing_occurred_at=${h.canonical_trade_events_missing_occurred_at}`,
    );
    console.log("[check-data-flow] events_health:", JSON.stringify(h));
  }

  // ── Duplicate activity ─────────────────────────────────────────────────────
  // No trade-driven feed_events should be created after the Phase 2 cutover; a
  // rolling window catches any regression where something starts writing them.
  const since = new Date(Date.now() - FEED_WINDOW_HOURS * 3600_000).toISOString();
  const newTradeFeed = await headCount(() =>
    sb
      .from("feed_events")
      .select("*", { count: "exact", head: true })
      .in("type", ["backed", "reduced"])
      .gte("created_at", since),
  );
  add(
    `no trade-driven feed_events created in the last ${FEED_WINDOW_HOURS}h`,
    newTradeFeed === 0,
    `new trade-driven feed_events=${newTradeFeed}`,
  );

  // Duplicate canonical identity is structurally impossible (source_key UNIQUE),
  // but verify there are no two canonical chain rows for one tx+log.
  const { data: dupes, error: dErr } = await sb
    .from("events")
    .select("tx_hash, log_index")
    .eq("source", "chain")
    .eq("kind", "trade")
    .eq("is_canonical", true)
    .limit(100000);
  if (dErr) {
    add("scan canonical chain events for duplicates", false, dErr.message);
  } else {
    const seen = new Set<string>();
    let dup = 0;
    for (const r of dupes ?? []) {
      const k = `${r.tx_hash}:${r.log_index}`;
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    add(
      "one canonical event per tx_hash+log_index",
      dup === 0,
      `duplicate (tx_hash,log_index) canonical rows=${dup}`,
    );
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log("\n[check-data-flow] RESULTS ─────────────────────────────────");
  let failedCritical = 0;
  for (const c of checks) {
    const mark = c.ok ? "✓" : c.critical ? "✗" : "⚠";
    console.log(`  ${mark} ${c.name} — ${c.detail}`);
    if (!c.ok && c.critical) failedCritical++;
  }
  console.log("──────────────────────────────────────────────────────────");
  if (failedCritical > 0) {
    console.error(`[check-data-flow] FAILED — ${failedCritical} critical invariant(s) violated`);
    process.exit(1);
  }
  console.log("[check-data-flow] OK — all critical invariants hold");
}

run().catch((e) => {
  console.error("[check-data-flow] error:", e instanceof Error ? e.message : e);
  process.exit(2);
});
