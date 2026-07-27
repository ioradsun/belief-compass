/**
 * Job M (batch) — precompute Conviction DNA for every wallet.
 *
 * Instead of computing a wallet's Circles lazily on first page view, this runs
 * the full pairwise pass over all directional beliefs and caches the result in
 * `wallet_matches` (per-domain rows + overall Tribe rows with domain = null).
 *
 * Server-only: uses the service client for writes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchScore, MIN_SHARED_MARKETS, type BeliefFactor } from "@/domain/domain";
import { categoryToDomain, DOMAINS, type Domain } from "@/domain/categories";

const MAX_PER_CIRCLE = 10;
const MAX_OVERALL = 20;

type Row = {
  wallet: string;
  matched_wallet: string;
  domain: Domain | null;
  match_score: number;
  shared_markets: number;
  agreements: number;
  disagreements: number;
  calculated_at: string;
};

/** Page through a table so we never silently truncate at PostgREST's 1000-row cap. */
async function selectAll<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => any,
  page = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < page) return out;
  }
}

export async function recomputeAllDna(sb: SupabaseClient) {
  const beliefs = await selectAll<{
    wallet: string;
    onchain_id: number;
    stance: number | null;
    stance_side: string | null;
    conviction: number | null;
  }>(() =>
    sb
      .from("wallet_beliefs")
      .select("wallet, onchain_id, stance, stance_side, conviction")
      .in("stance_side", ["YES", "NO"])
      .order("wallet", { ascending: true }),
  );

  if (beliefs.length === 0) return { wallets: 0, rows: 0 };

  // Market -> domain
  const marketRows = await selectAll<{ onchain_id: number; category: string | null }>(() =>
    sb.from("markets").select("onchain_id, category").order("onchain_id", { ascending: true }),
  );
  const domainOf = new Map<number, Domain>();
  for (const m of marketRows) {
    const d = categoryToDomain(m.category ?? null);
    if (d) domainOf.set(Number(m.onchain_id), d);
  }

  // Wallet -> factors
  const byWallet = new Map<string, BeliefFactor[]>();
  for (const b of beliefs) {
    const w = String(b.wallet).toLowerCase();
    const arr = byWallet.get(w) ?? [];
    arr.push({
      onchain_id: Number(b.onchain_id),
      stance: Number(b.stance ?? 0),
      stance_side: b.stance_side as BeliefFactor["stance_side"],
      conviction: Number(b.conviction ?? 0),
    });
    byWallet.set(w, arr);
  }

  const wallets = [...byWallet.keys()];
  // Pre-bucket each wallet's factors by domain so the pairwise loop stays cheap.
  const buckets = new Map<string, Map<Domain, BeliefFactor[]>>();
  for (const [w, arr] of byWallet) {
    const m = new Map<Domain, BeliefFactor[]>();
    for (const f of arr) {
      const d = domainOf.get(Number(f.onchain_id));
      if (!d) continue;
      const list = m.get(d) ?? [];
      list.push(f);
      m.set(d, list);
    }
    buckets.set(w, m);
  }

  const nowIso = new Date().toISOString();
  const rows: Row[] = [];

  for (const a of wallets) {
    const aAll = byWallet.get(a)!;
    const aBuckets = buckets.get(a)!;

    // ---- Overall Tribe ----
    const overall: Row[] = [];
    for (const b of wallets) {
      if (b === a) continue;
      const m = matchScore(aAll, byWallet.get(b)!);
      if (m.insufficient) continue;
      overall.push({
        wallet: a,
        matched_wallet: b,
        domain: null,
        match_score: m.match_score,
        shared_markets: m.shared,
        agreements: m.agreements,
        disagreements: m.disagreements,
        calculated_at: nowIso,
      });
    }
    overall.sort((x, y) => y.match_score - x.match_score);
    rows.push(...overall.slice(0, MAX_OVERALL));

    // ---- Per-domain Circles ----
    for (const dom of DOMAINS) {
      const mine = aBuckets.get(dom) ?? [];
      if (mine.length < MIN_SHARED_MARKETS) continue;
      const scored: Row[] = [];
      for (const b of wallets) {
        if (b === a) continue;
        const theirs = buckets.get(b)!.get(dom) ?? [];
        if (theirs.length === 0) continue;
        const m = matchScore(mine, theirs);
        if (m.insufficient) continue;
        scored.push({
          wallet: a,
          matched_wallet: b,
          domain: dom,
          match_score: m.match_score,
          shared_markets: m.shared,
          agreements: m.agreements,
          disagreements: m.disagreements,
          calculated_at: nowIso,
        });
      }
      if (scored.length === 0) continue;
      scored.sort((x, y) => y.match_score - x.match_score);
      const keep = new Map<string, Row>();
      for (const r of scored.slice(0, MAX_PER_CIRCLE)) keep.set(r.matched_wallet, r);
      for (const r of scored.slice(-MAX_PER_CIRCLE)) keep.set(r.matched_wallet, r);
      rows.push(...keep.values());
    }
  }

  // Replace the cache wholesale — stale pairs must not linger.
  await sb.from("wallet_matches").delete().neq("wallet", "");
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("wallet_matches").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  return { wallets: wallets.length, rows: rows.length };
}
