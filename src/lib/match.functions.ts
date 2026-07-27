/**
 * Job M — on-demand DNA matcher.
 * Cache in wallet_matches; recompute only if stale or wallet traded since.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { matchScore, type BeliefFactor, MIN_SHARED_MARKETS } from "@/domain/domain";
import { publicClient, serviceClient } from "@/lib/supabase-clients";

const MAX_MATCHES = 50;
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface MatchRow {
  matched_wallet: string;
  match_score: number;
  shared_markets: number;
  agreements: number;
  disagreements: number;
  calculated_at?: string;
}

export interface MatchesResult {
  insufficient: boolean;
  wallet: string;
  matches: MatchRow[];
  factors?: number;
  cached?: boolean;
}

/**
 * Compute (or return cached) DNA matches for a wallet and persist them to
 * wallet_matches. Shared by the on-demand server fn and the on-connect
 * conviction ingest, so the feed's People/Opp light up as soon as a wallet's
 * beliefs exist — no /wallet page visit required. Recomputes only when the
 * cache is stale or the wallet has traded/ingested since it was built.
 */
export async function ensureMatchesForWallet(walletRaw: string): Promise<MatchesResult> {
  const wallet = walletRaw.toLowerCase();
  const pub = publicClient();

  // Freshness check: last_trade_at / updated_at across this wallet's beliefs.
  const { data: myBeliefs } = await pub
    .from("wallet_beliefs")
    .select("onchain_id, stance, stance_side, conviction, last_trade_at, updated_at")
    .eq("wallet", wallet)
    .in("stance_side", ["YES", "NO"]);

  if (!myBeliefs || myBeliefs.length < MIN_SHARED_MARKETS) {
    return { insufficient: true, wallet, matches: [], factors: myBeliefs?.length ?? 0 };
  }
  const changedAt = myBeliefs
    .map((r) => {
      const t = r.last_trade_at ? new Date(r.last_trade_at as string).getTime() : 0;
      const u = r.updated_at ? new Date(r.updated_at as string).getTime() : 0;
      return Math.max(t, u);
    })
    .reduce((a, b) => Math.max(a, b), 0);

  // Cache check
  const { data: cached } = await pub
    .from("wallet_matches")
    .select("matched_wallet, match_score, shared_markets, agreements, disagreements, calculated_at")
    .eq("wallet", wallet)
    .order("match_score", { ascending: false })
    .limit(MAX_MATCHES);
  const cachedAt = cached?.[0]?.calculated_at
    ? new Date(cached[0].calculated_at as string).getTime()
    : 0;
  if (
    cached &&
    cached.length > 0 &&
    Date.now() - cachedAt < CACHE_TTL_MS &&
    changedAt <= cachedAt
  ) {
    return { insufficient: false, wallet, matches: cached as MatchRow[], cached: true };
  }

  // Candidate gen: other wallets directional in any of my markets
  const myMarkets = myBeliefs.map((r) => Number(r.onchain_id));
  const factorsA: BeliefFactor[] = myBeliefs.map((r) => ({
    onchain_id: Number(r.onchain_id),
    stance: Number(r.stance ?? 0),
    stance_side: r.stance_side as BeliefFactor["stance_side"],
    conviction: Number(r.conviction ?? 0),
  }));

  const { data: candidates } = await pub
    .from("wallet_beliefs")
    .select("wallet, onchain_id, stance, stance_side, conviction")
    .in("onchain_id", myMarkets)
    .in("stance_side", ["YES", "NO"])
    .neq("wallet", wallet)
    .limit(50_000);

  const byWallet = new Map<string, BeliefFactor[]>();
  for (const c of candidates ?? []) {
    const w = c.wallet as string;
    const arr = byWallet.get(w) ?? [];
    arr.push({
      onchain_id: Number(c.onchain_id),
      stance: Number(c.stance ?? 0),
      stance_side: c.stance_side as BeliefFactor["stance_side"],
      conviction: Number(c.conviction ?? 0),
    });
    byWallet.set(w, arr);
  }

  const scored: MatchRow[] = [];
  for (const [w, arr] of byWallet) {
    const m = matchScore(factorsA, arr);
    if (m.insufficient) continue;
    scored.push({
      matched_wallet: w,
      match_score: m.match_score,
      shared_markets: m.shared,
      agreements: m.agreements,
      disagreements: m.disagreements,
    });
  }
  scored.sort((a, b) => b.match_score - a.match_score);
  const top = scored.slice(0, MAX_MATCHES);

  // Persist cache with service client
  if (top.length > 0) {
    const svc = serviceClient();
    const nowIso = new Date().toISOString();
    await svc.from("wallet_matches").delete().eq("wallet", wallet);
    await svc.from("wallet_matches").upsert(
      top.map((r) => ({ ...r, wallet, calculated_at: nowIso })),
      { onConflict: "wallet,matched_wallet" },
    );
  }

  return { insufficient: false, wallet, matches: top, cached: false };
}

export const getMatchesForWallet = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string }) => z.object({ wallet: z.string().min(3) }).parse(d))
  .handler(async ({ data }) => ensureMatchesForWallet(data.wallet));
