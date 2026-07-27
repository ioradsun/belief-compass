/**
 * check-data-flow — data-flow integrity gate.
 *
 * Verifies the single permitted path holds in production:
 *   Base log → canonical event → position calc
 * and that no duplicate/alternate path has leaked back in. The legacy `trades`
 * and `feed_events` projections have been retired — canonical `events` is the
 * only source, so the checks are event-only.
 *
 * Exits NONZERO when any critical invariant fails, so it can gate a deploy.
 *
 * Run:  npx tsx scripts/check-data-flow.ts   (or: npm run check:data-flow)
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (required)
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

type Check = { name: string; ok: boolean; detail: string; critical: boolean };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string, critical = true) =>
  checks.push({ name, ok, detail, critical });

async function run() {
  // ── Canonical event health (via events_health) ─────────────────────────────
  const { data: health, error: hErr } = await sb.rpc("events_health");
  if (hErr) {
    add("events_health() available", false, hErr.message);
  } else {
    const h = health as Record<string, number>;
    add(
      "no canonical trade event is missing occurred_at",
      (h.canonical_trade_events_missing_occurred_at ?? 0) === 0,
      `canonical_trade_events_missing_occurred_at=${h.canonical_trade_events_missing_occurred_at}`,
    );
    add(
      "no canonical event is missing market_id",
      (h.events_missing_market_id ?? 0) === 0,
      `events_missing_market_id=${h.events_missing_market_id}`,
    );
    add(
      "no canonical trade event is missing wallet",
      (h.events_missing_wallet ?? 0) === 0,
      `events_missing_wallet=${h.events_missing_wallet}`,
    );
    console.log("[check-data-flow] events_health:", JSON.stringify(h));
  }

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
