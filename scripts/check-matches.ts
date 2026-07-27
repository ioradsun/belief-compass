/**
 * check-matches — Phase 8 viewer-centered DNA correctness + scale gate.
 *
 * Validates the bounded viewer_match_cache and proves the old global pairwise
 * matcher is gone: no wallet_matches table, no cached relationship below the
 * evidence gates, no candidate pool or exact-comparison count above the cap,
 * canonical wallet normalization, and no duplicate wallets across Tribe/Rival.
 *
 * Modes:
 *   (default)            scan cached viewers (bounded pages)
 *   --viewer W           trace one viewer end-to-end (candidates → score → bound)
 *   --pair A B           exact DNA score for one wallet pair
 *   --domain D           restrict the trace to one domain
 *   --stale SECONDS      only report caches older than SECONDS
 *   --limit N            page size (default 500)
 *
 * Run:  npx tsx scripts/check-matches.ts [--viewer 0x..] [--pair 0xa 0xb]
 *       (npm run check:matches)
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { matchScore, type BeliefFactor } from "../src/domain/domain";
import { MATCH } from "../src/domain/match-config";
import { classifyRelationship, matchConfidence } from "../src/domain/match";
import { categoryToDomain } from "../src/domain/categories";
import { buildViewerMatchOutput } from "../src/domain/viewer-matches";
import { findMatchCandidates } from "../src/lib/matches/find-candidates.server";
import type { MatchEntry } from "../src/domain/viewer-matches";

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
  closest_below_confidence: 0,
  duplicate_wallet_in_lists: 0,
  non_canonical_wallet: 0,
  candidate_cap_exceeded: 0,
  scored_cap_exceeded: 0,
  old_matcher_table_present: 0,
  old_matcher_job_scheduled: 0,
};

async function loadFactors(wallet: string): Promise<BeliefFactor[]> {
  const { data } = await sb
    .from("wallet_beliefs")
    .select("onchain_id, stance, stance_side, conviction")
    .eq("wallet", wallet.toLowerCase())
    .in("stance_side", ["YES", "NO"]);
  return (data ?? []).map((r) => ({
    onchain_id: Number(r.onchain_id),
    stance: Number(r.stance ?? 0),
    stance_side: r.stance_side as BeliefFactor["stance_side"],
    conviction: Number(r.conviction ?? 0),
  }));
}

function gateOk(e: MatchEntry, minShared: number): boolean {
  return e.sharedMarkets >= minShared && e.confidence >= MATCH.MIN_MATCH_CONFIDENCE;
}

/** Assert an environment invariant: old global pairwise infra is gone. */
async function checkRetired() {
  // wallet_matches must no longer exist.
  const probe = await sb.from("wallet_matches").select("wallet", { head: true, count: "exact" });
  if (!probe.error) {
    c.old_matcher_table_present += 1;
    console.error("[check-matches] wallet_matches table still present (should be dropped)");
  }
  // Best-effort: no cron job references the deleted global batch route.
  try {
    const { data } = await sb
      .from("cron.job" as never)
      .select("jobname, command" as never)
      .limit(200);
    for (const j of (data ?? []) as { command?: string }[]) {
      if (j.command && /dna-matcher/.test(j.command)) c.old_matcher_job_scheduled += 1;
    }
  } catch {
    /* cron schema not exposed to PostgREST — verified manually in the migration */
  }
}

function checkCache(row: Record<string, unknown>, nowMs: number) {
  c.scanned += 1;
  const engine = Number(row.match_engine_version ?? 0);
  if (engine !== MATCH.ENGINE_VERSION) c.engine_version_mismatch += 1;
  if (row.expires_at && new Date(row.expires_at as string).getTime() < nowMs) c.stale_caches += 1;
  if (Number(row.candidate_count ?? 0) > MATCH.MAX_CANDIDATES) c.candidate_cap_exceeded += 1;
  if (Number(row.scored_count ?? 0) > MATCH.MAX_CANDIDATES) c.scored_cap_exceeded += 1;

  const viewer = String(row.viewer_wallet ?? "");
  if (viewer !== viewer.toLowerCase()) c.non_canonical_wallet += 1;

  const tribe = (row.tribe_matches as MatchEntry[]) ?? [];
  const rivals = (row.rival_matches as MatchEntry[]) ?? [];
  const closest = (row.closest_match as MatchEntry | null) ?? null;

  for (const e of [...tribe, ...rivals]) {
    if (!gateOk(e, MATCH.MIN_SHARED_OVERALL)) c.below_evidence_gate += 1;
    if (e.wallet !== e.wallet.toLowerCase()) c.non_canonical_wallet += 1;
  }
  const domains = (row.domain_matches as Record<string, MatchEntry[]>) ?? {};
  for (const list of Object.values(domains))
    for (const e of list) if (!gateOk(e, MATCH.MIN_SHARED_DOMAIN)) c.below_evidence_gate += 1;

  if (
    closest &&
    (closest.confidence < MATCH.MIN_MATCH_CONFIDENCE ||
      closest.sharedMarkets < MATCH.MIN_SHARED_OVERALL)
  )
    c.closest_below_confidence += 1;

  const tset = new Set(tribe.map((e) => e.wallet));
  if (rivals.some((e) => tset.has(e.wallet))) c.duplicate_wallet_in_lists += 1;
}

async function tracePair(a: string, b: string) {
  const [fa, fb] = await Promise.all([loadFactors(a), loadFactors(b)]);
  const r = matchScore(fa, fb);
  const confidence = matchConfidence(r.shared);
  console.log(
    JSON.stringify(
      {
        a,
        b,
        shared: r.shared,
        agreements: r.agreements,
        disagreements: r.disagreements,
        raw: r.raw,
        match_score: r.match_score,
        confidence,
        relationship: classifyRelationship(r, confidence),
        engine_version: MATCH.ENGINE_VERSION,
      },
      null,
      2,
    ),
  );
}

async function traceViewer(viewer: string, onlyDomain: string | null) {
  const factors = await loadFactors(viewer);
  const candidates = await findMatchCandidates(sb, viewer);
  const markets = factors.map((f) => Number(f.onchain_id));
  const { data: catRows } = await sb
    .from("markets")
    .select("onchain_id, category")
    .in("onchain_id", markets);
  const domainOf = new Map<number, string>();
  for (const m of (catRows ?? []) as { onchain_id: number; category: string | null }[]) {
    const d = categoryToDomain(m.category);
    if (d) domainOf.set(Number(m.onchain_id), d);
  }
  const candFactors = new Map<string, BeliefFactor[]>();
  const wallets = candidates.map((x) => x.wallet);
  for (let i = 0; i < wallets.length; i += 200) {
    const chunk = wallets.slice(i, i + 200);
    if (!chunk.length) break;
    const { data } = await sb
      .from("wallet_beliefs")
      .select("wallet, onchain_id, stance, stance_side, conviction")
      .in("wallet", chunk)
      .in("onchain_id", markets)
      .in("stance_side", ["YES", "NO"]);
    for (const r of data ?? []) {
      const w = String(r.wallet).toLowerCase();
      const arr = candFactors.get(w) ?? [];
      arr.push({
        onchain_id: Number(r.onchain_id),
        stance: Number(r.stance ?? 0),
        stance_side: r.stance_side as BeliefFactor["stance_side"],
        conviction: Number(r.conviction ?? 0),
      });
      candFactors.set(w, arr);
    }
  }
  const viewerDomainCounts = new Map<string, number>();
  for (const f of factors) {
    const d = domainOf.get(Number(f.onchain_id));
    if (d) viewerDomainCounts.set(d, (viewerDomainCounts.get(d) ?? 0) + 1);
  }
  const out = buildViewerMatchOutput(factors, candFactors, {
    domainOf: (id) => domainOf.get(Number(id)) ?? null,
    viewerDomainCounts,
  });
  console.log(
    JSON.stringify(
      {
        viewer,
        viewer_directional_markets: factors.length,
        candidates_generated: candidates.length,
        candidates_scored: out.scoredCount,
        closest: out.closestMatch,
        top_tribe: out.tribe.slice(0, 5),
        top_rivals: out.rivals.slice(0, 5),
        domains: onlyDomain
          ? { [onlyDomain]: out.domains[onlyDomain] ?? [] }
          : Object.keys(out.domains),
        cap: MATCH.MAX_CANDIDATES,
      },
      null,
      2,
    ),
  );
  if (candidates.length > MATCH.MAX_CANDIDATES) {
    console.error("[check-matches] candidate pool exceeded cap");
    process.exit(1);
  }
}

async function run() {
  await checkRetired();

  const pairA = val("pair");
  if (pairA) {
    const i = process.argv.indexOf("--pair");
    const b = process.argv[i + 2];
    await tracePair(pairA, b);
    return;
  }
  if (val("viewer")) {
    await traceViewer(val("viewer")!, val("domain"));
    return;
  }

  const nowMs = Date.now();
  let last = "";
  for (;;) {
    let q = sb.from("viewer_match_cache").select("*");
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

  console.log("[check-matches] " + JSON.stringify(c, null, 2));
  const critical =
    c.below_evidence_gate +
    c.closest_below_confidence +
    c.duplicate_wallet_in_lists +
    c.non_canonical_wallet +
    c.candidate_cap_exceeded +
    c.scored_cap_exceeded +
    c.old_matcher_table_present +
    c.old_matcher_job_scheduled;
  if (critical > 0) {
    console.error(`[check-matches] FAILED — ${critical} violation(s)`);
    process.exit(1);
  }
  console.log("[check-matches] OK");
}

run().catch((e) => {
  console.error("[check-matches] error:", e instanceof Error ? e.message : e);
  process.exit(2);
});
