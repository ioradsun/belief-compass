/**
 * check-dna — Conviction DNA correctness + scale gate.
 *
 * Validates the bounded viewer_dna_cache and proves the old global pairwise
 * matcher is gone: no viewer_match_cache/wallet_matches tables, no cached
 * relationship below the evidence gates, no bucket above the retention cap,
 * canonical wallet normalization, and no wallet appearing in two opposing buckets.
 *
 * Modes:
 *   (default)       scan cached viewers (bounded pages)
 *   --viewer W      trace one viewer end-to-end (candidates → score → classify)
 *   --pair A B      exact DNA score + label for one wallet pair
 *   --stale SECONDS only report caches older than SECONDS
 *   --limit N       page size (default 500)
 *
 * Run:  npx tsx scripts/check-dna.ts [--viewer 0x..] [--pair 0xa 0xb]
 *       (npm run check:dna)
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import {
  DNA_ENGINE_VERSION,
  DNA_LIMITS,
  DNA_THRESHOLDS,
  evidenceLevelFor,
} from "../src/domain/dna/config";
import { scoreRelationship, type DnaFactor } from "../src/domain/dna/score";
import { classifyRelationship } from "../src/domain/dna/classify";
import { categoryToDomain } from "../src/domain/categories";
import { scoreDomains } from "../src/domain/dna/domains";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const val = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : null;
};
const LIMIT = Number(val("limit") ?? "500");

const c = {
  scanned: 0,
  stale_caches: 0,
  engine_version_mismatch: 0,
  below_evidence_gate: 0,
  bucket_cap_exceeded: 0,
  scored_cap_exceeded: 0,
  wallet_in_opposing_buckets: 0,
  non_canonical_wallet: 0,
  wrong_bucket_label: 0,
  old_cache_table_present: 0,
};

async function loadFactors(wallet: string): Promise<DnaFactor[]> {
  const { data } = await sb
    .from("wallet_beliefs")
    .select("onchain_id, stance_side, conviction")
    .eq("wallet", wallet.toLowerCase())
    .in("stance_side", ["YES", "NO"]);
  return (data ?? []).map((r) => ({
    marketId: Number(r.onchain_id),
    side: r.stance_side === "NO" ? "NO" : "YES",
    conviction: Math.abs(Number(r.conviction ?? 0)),
  }));
}

async function checkRetired() {
  for (const t of ["viewer_match_cache", "wallet_matches"]) {
    // HEAD probes return a bodyless 404 for a dropped table, which supabase-js
    // surfaces without an `error` object — so gate on the HTTP status too.
    const probe = await sb.from(t).select("*", { head: true, count: "exact" });
    const missing = Boolean(probe.error) || probe.status === 404 || probe.status === 406;
    if (!missing) {
      c.old_cache_table_present += 1;
      console.error(`[check-dna] ${t} still present (should be dropped)`);
    }
  }
}


type Rel = {
  wallet: string;
  agreement: number;
  sharedBeliefs: number;
  confidence: number;
  relationship: string;
};

function checkCache(row: Record<string, unknown>, nowMs: number) {
  c.scanned += 1;
  if (Number(row.engine_version ?? 0) !== DNA_ENGINE_VERSION) c.engine_version_mismatch += 1;
  if (row.expires_at && new Date(row.expires_at as string).getTime() < nowMs) c.stale_caches += 1;
  if (Number(row.scored_count ?? 0) > DNA_LIMITS.maxExactScored) c.scored_cap_exceeded += 1;

  const viewer = String(row.viewer_wallet ?? "");
  if (viewer !== viewer.toLowerCase()) c.non_canonical_wallet += 1;

  const groups: Record<string, Rel[]> = {
    twin: (row.twin_matches as Rel[]) ?? [],
    tribe: (row.tribe_matches as Rel[]) ?? [],
    opp: (row.opp_matches as Rel[]) ?? [],
    inverse: (row.inverse_matches as Rel[]) ?? [],
    neutral: (row.neutral_matches as Rel[]) ?? [],
  };
  const seen = new Map<string, string>();
  for (const [label, list] of Object.entries(groups)) {
    if (list.length > DNA_LIMITS.maxPerGroup) c.bucket_cap_exceeded += 1;
    for (const e of list) {
      if (e.wallet !== e.wallet.toLowerCase()) c.non_canonical_wallet += 1;
      if (e.sharedBeliefs < DNA_THRESHOLDS.minSharedOverall) c.below_evidence_gate += 1;
      if (label !== "neutral" && e.relationship !== label) c.wrong_bucket_label += 1;
      const prior = seen.get(e.wallet);
      if (prior && prior !== label) c.wallet_in_opposing_buckets += 1;
      seen.set(e.wallet, label);
    }
  }
}

async function tracePair(a: string, b: string) {
  const [fa, fb] = await Promise.all([loadFactors(a), loadFactors(b)]);
  const s = scoreRelationship(fa, fb);
  const { relationship } = classifyRelationship({ currentScore: s });
  console.log(JSON.stringify({ a, b, ...s, relationship, engine: DNA_ENGINE_VERSION }, null, 2));
}

async function traceViewer(viewer: string) {
  const factors = await loadFactors(viewer);
  const { data: cand } = await sb.rpc("find_match_candidates", {
    p_viewer: viewer.toLowerCase(),
    p_min_shared: DNA_THRESHOLDS.minSharedOverall,
    p_max_candidates: DNA_LIMITS.maxExactScored,
  });
  const wallets = ((cand ?? []) as { wallet: string }[]).map((x) => x.wallet);
  const markets = factors.map((f) => Number(f.marketId));
  const { data: catRows } = await sb
    .from("markets")
    .select("onchain_id, category")
    .in("onchain_id", markets);
  const domainOf = new Map<number, string>();
  for (const m of (catRows ?? []) as { onchain_id: number; category: string | null }[]) {
    const d = categoryToDomain(m.category);
    if (d) domainOf.set(Number(m.onchain_id), d);
  }
  const rows: Rel[] = [];
  for (let i = 0; i < wallets.length; i += 200) {
    const chunk = wallets.slice(i, i + 200);
    if (!chunk.length) break;
    const { data } = await sb
      .from("wallet_beliefs")
      .select("wallet, onchain_id, stance_side, conviction")
      .in("wallet", chunk)
      .in("onchain_id", markets)
      .in("stance_side", ["YES", "NO"]);
    const byWallet = new Map<string, DnaFactor[]>();
    for (const r of data ?? []) {
      const w = String(r.wallet).toLowerCase();
      const arr = byWallet.get(w) ?? [];
      arr.push({
        marketId: Number(r.onchain_id),
        side: r.stance_side === "NO" ? "NO" : "YES",
        conviction: Math.abs(Number(r.conviction ?? 0)),
      });
      byWallet.set(w, arr);
    }
    for (const [w, f] of byWallet) {
      const s = scoreRelationship(factors, f);
      if (s.sharedBeliefs < DNA_THRESHOLDS.minSharedOverall) continue;
      const { relationship } = classifyRelationship({ currentScore: s });
      const doms = scoreDomains(factors, f, (id) => domainOf.get(Number(id)) ?? null);
      void doms;
      rows.push({
        wallet: w,
        agreement: Math.round(s.agreement),
        sharedBeliefs: s.sharedBeliefs,
        confidence: s.confidence,
        relationship,
      });
    }
  }
  rows.sort((a, b) => b.agreement - a.agreement);
  console.log(
    JSON.stringify(
      {
        viewer,
        viewer_directional_markets: factors.length,
        candidates_generated: wallets.length,
        candidates_scored: rows.length,
        cap: DNA_LIMITS.maxExactScored,
        top: rows.slice(0, 8),
        evidence_of_first: rows[0] ? evidenceLevelFor(rows[0].sharedBeliefs) : null,
      },
      null,
      2,
    ),
  );
  if (wallets.length > DNA_LIMITS.maxExactScored) {
    console.error("[check-dna] candidate pool exceeded cap");
    process.exit(1);
  }
}

async function run() {
  await checkRetired();
  const pairA = val("pair");
  if (pairA) {
    const i = process.argv.indexOf("--pair");
    await tracePair(pairA, process.argv[i + 2]);
    return;
  }
  if (val("viewer")) {
    await traceViewer(val("viewer")!);
    return;
  }

  const nowMs = Date.now();
  let last = "";
  for (;;) {
    let q = sb.from("viewer_dna_cache").select("*");
    if (val("stale"))
      q = q.lt("calculated_at", new Date(nowMs - Number(val("stale")) * 1000).toISOString());
    const { data, error } = await q
      .gt("viewer_wallet", last)
      .order("viewer_wallet", { ascending: true })
      .limit(LIMIT);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;
    for (const r of rows) checkCache(r as Record<string, unknown>, nowMs);
    last = String(rows[rows.length - 1].viewer_wallet);
  }

  console.log("[check-dna] " + JSON.stringify(c, null, 2));
  const critical =
    c.below_evidence_gate +
    c.bucket_cap_exceeded +
    c.scored_cap_exceeded +
    c.wallet_in_opposing_buckets +
    c.non_canonical_wallet +
    c.wrong_bucket_label +
    c.old_cache_table_present;
  if (critical > 0) {
    console.error(`[check-dna] FAILED — ${critical} violation(s)`);
    process.exit(1);
  }
  console.log("[check-dna] OK");
}

run().catch((e) => {
  console.error("[check-dna] error:", e instanceof Error ? e.message : e);
  process.exit(2);
});
