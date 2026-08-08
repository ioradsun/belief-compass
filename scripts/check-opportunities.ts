/**
 * check-opportunities — Phase 5 opportunity-engine correctness gate.
 *
 * Recomputes each market's opportunity from its stored market_state facts and
 * compares to the stored opportunity output, plus structural invariants (evidence
 * supports the label, score bounds, type-specific gates). Exits nonzero on
 * correctness violations.
 *
 * Scope: all (bounded pages) | --market M | --type hot | --low (low confidence) |
 *        --dirty | --stale SECONDS
 *
 * Run:  npx tsx scripts/check-opportunities.ts [--market 42] [--type hot] [--limit 500]
 *       (npm run check:opportunities)
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { evaluateOpportunity } from "../src/domain/opportunity";
import { OPP } from "../src/domain/opportunity-config";
import { buildOpportunityInput } from "../src/lib/opportunity/build-input";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const val = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : null;
};
const has = (name: string) => process.argv.includes(`--${name}`);
const onlyMarket = val("market") ? Number(val("market")) : null;
const onlyType = val("type");
const LIMIT = Number(val("limit") ?? "500");

const c = {
  checked: 0,
  eligible_without_type: 0,
  typed_without_evidence: 0,
  score_out_of_bounds: 0,
  score_mismatch: 0,
  type_mismatch: 0,
  new_older_than_threshold: 0,
  conviction_without_challenge: 0,
  invalid_window: 0,
  engine_version_mismatch: 0,
  stale: 0,
};

const VALID_WINDOWS = new Set(["1h", "24h", "7d", "lifecycle", null]);

async function checkMarket(ms: Record<string, unknown>, nowMs: number, poolCount: number) {
  c.checked += 1;
  const storedType = (ms.opportunity_type as string) ?? null;
  const storedScore = ms.opportunity_score == null ? null : Number(ms.opportunity_score);
  const eligible = Boolean(ms.opportunity_eligible);

  if (eligible && !storedType) c.eligible_without_type += 1;
  if (storedType && !ms.opportunity_evidence) c.typed_without_evidence += 1;
  if (storedScore != null && (storedScore < 0 || storedScore > 100)) c.score_out_of_bounds += 1;
  if (!VALID_WINDOWS.has((ms.opportunity_window as string) ?? null)) c.invalid_window += 1;
  if (Number(ms.opportunity_engine_version ?? OPP.ENGINE_VERSION) !== OPP.ENGINE_VERSION)
    c.engine_version_mismatch += 1;
  if (ms.opportunity_calculated_at) {
    const age = (Date.now() - new Date(ms.opportunity_calculated_at as string).getTime()) / 1000;
    if (age > OPP.STALE_SECONDS * 2) c.stale += 1;
  }
  if (storedType === "new") {
    const created = (ms.market_created_at as string) ?? null;
    const ageH = created ? (nowMs - new Date(created).getTime()) / 3_600_000 : null;
    if (ageH != null && ageH > OPP.NEW_MARKET_MAX_HOURS) c.new_older_than_threshold += 1;
  }
  if (storedType === "conviction") {
    const ev = (ms.opportunity_evidence ?? {}) as unknown as Record<string, unknown>;
    const challenge = Number(ev.circulation_7d ?? 0) > 0 || Number(ev.sell_rate_24h ?? 0) > 0;
    if (!challenge) c.conviction_without_challenge += 1;
  }

  // Recompute and compare to stored.
  const recomputed = evaluateOpportunity(buildOpportunityInput(ms, nowMs), {
    nowMs,
    eligibleMarketCount: poolCount,
    prevType: (storedType as never) ?? null,
  });
  if ((recomputed.type ?? null) !== storedType) c.type_mismatch += 1;
  if (storedScore != null && Math.abs(recomputed.normalizedScore - storedScore) > 1)
    c.score_mismatch += 1;
}

const COLS =
  "onchain_id, opportunity_type, opportunity_score, opportunity_window, opportunity_evidence, opportunity_eligible, opportunity_confidence, opportunity_calculated_at, opportunity_engine_version, market_created_at, " +
  "directional_believers, believers_yes, believers_no, unique_wallets_1h, unique_wallets_24h, unique_wallets_7d, new_believers_1h, new_believers_24h, new_believers_7d, volume_eth_1h, volume_eth_24h, volume_eth_7d, trade_count_1h, trade_count_24h, trade_count_7d, circulation_1h, circulation_24h, circulation_7d, sell_rate_24h, people_yes_pct, money_yes_pct, yes_capital_usd, no_capital_usd, yes_price_usd, no_price_usd, avg_directional_days, median_directional_days, avg_conviction_strength, yes_price_change_1h, yes_price_change_24h, last_trade_at, calculated_at";

async function run() {
  const nowMs = Date.now();
  const { count: poolCount } = await sb
    .from("market_state")
    .select("*", { count: "exact", head: true })
    .gt("directional_believers", 0);
  const pool = poolCount ?? 0;

  if (onlyMarket != null) {
    const { data } = await sb
      .from("market_state")
      .select(COLS)
      .eq("onchain_id", onlyMarket)
      .maybeSingle();
    if (data) await checkMarket(data as unknown as Record<string, unknown>, nowMs, pool);
  } else {
    let last = -1;
    for (;;) {
      let q = sb.from("market_state").select(COLS);
      if (onlyType) q = q.eq("opportunity_type", onlyType);
      if (has("low")) q = q.eq("opportunity_confidence", "low");
      if (has("dirty")) q = q.eq("needs_rebuild", true);
      if (val("stale"))
        q = q.lt(
          "opportunity_calculated_at",
          new Date(Date.now() - Number(val("stale")) * 1000).toISOString(),
        );
      const { data, error } = await q
        .gt("onchain_id", last)
        .order("onchain_id", { ascending: true })
        .limit(LIMIT);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      if (rows.length === 0) break;
      for (const r of rows) await checkMarket(r as unknown as Record<string, unknown>, nowMs, pool);
      last = Number((rows[rows.length - 1] as unknown as Record<string, unknown>).onchain_id);
    }
  }

  console.log("[check-opportunities] " + JSON.stringify(c, null, 2));
  const critical =
    c.eligible_without_type +
    c.typed_without_evidence +
    c.score_out_of_bounds +
    c.invalid_window +
    c.new_older_than_threshold +
    c.conviction_without_challenge +
    c.engine_version_mismatch;
  if (critical > 0) {
    console.error(`[check-opportunities] FAILED — ${critical} correctness violation(s)`);
    process.exit(1);
  }
  console.log("[check-opportunities] OK");
}

run().catch((e) => {
  console.error("[check-opportunities] error:", e instanceof Error ? e.message : e);
  process.exit(2);
});
