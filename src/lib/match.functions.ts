/**
 * Job M — on-demand DNA matcher.
 * Cache in wallet_matches; recompute only if stale or wallet traded since.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { matchScore, type BeliefFactor, MIN_SHARED_MARKETS } from "@/domain/domain";

const MAX_MATCHES = 50;
const CACHE_TTL_MS = 60 * 60 * 1000;

function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

function serviceClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const getMatchesForWallet = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string }) =>
    z.object({ wallet: z.string().min(3) }).parse(d))
  .handler(async ({ data }) => {
    const wallet = data.wallet.toLowerCase();
    const pub = publicClient();

    // Freshness check: last_trade_at across this wallet
    const { data: myBeliefs } = await pub
      .from("wallet_beliefs")
      .select("onchain_id, stance, stance_side, conviction, last_trade_at")
      .eq("wallet", wallet)
      .in("stance_side", ["YES", "NO"]);

    if (!myBeliefs || myBeliefs.length < MIN_SHARED_MARKETS) {
      return { insufficient: true, wallet, matches: [], factors: myBeliefs?.length ?? 0 };
    }
    const lastTradeAt = myBeliefs
      .map((r) => r.last_trade_at ? new Date(r.last_trade_at as string).getTime() : 0)
      .reduce((a, b) => Math.max(a, b), 0);

    // Cache check
    const { data: cached } = await pub
      .from("wallet_matches").select("matched_wallet, match_score, shared_markets, agreements, disagreements, calculated_at")
      .eq("wallet", wallet)
      .order("match_score", { ascending: false })
      .limit(MAX_MATCHES);
    const cachedAt = cached?.[0]?.calculated_at
      ? new Date(cached[0].calculated_at as string).getTime() : 0;
    if (cached && cached.length > 0
        && Date.now() - cachedAt < CACHE_TTL_MS
        && lastTradeAt <= cachedAt) {
      return { insufficient: false, wallet, matches: cached, cached: true };
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

    const scored: {
      matched_wallet: string; match_score: number;
      shared_markets: number; agreements: number; disagreements: number;
    }[] = [];
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
  });
