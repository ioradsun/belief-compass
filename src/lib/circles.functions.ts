/**
 * Job M v2 — Circle (per-domain) DNA matcher.
 *
 * RULE 1: Only surface Circles above the shared-market floor (5).
 * RULE 2: Category assignment read from stored markets.category (POV frozen).
 * Cached in wallet_matches with `domain` set.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  matchScore,
  MIN_SHARED_MARKETS,
  type BeliefFactor,
  type MatchResult,
} from "@/domain/domain";
import { categoryToDomain, DOMAINS, type Domain } from "@/domain/categories";

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_PER_CIRCLE = 10;

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

export interface CircleSummary {
  domain: Domain;
  insufficient: boolean;
  shared_markets: number;
  top_ally: { wallet: string; match_score: number; shared: number } | null;
  top_rival: { wallet: string; match_score: number; shared: number } | null;
}

export interface CirclesResponse {
  wallet: string;
  overall_insufficient: boolean;
  overall_shared: number;
  circles: CircleSummary[]; // one per DOMAINS entry, in fixed order
  cached: boolean;
}

export const getCirclesForWallet = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string }) => z.object({ wallet: z.string().min(3) }).parse(d))
  .handler(async ({ data }): Promise<CirclesResponse> => {
    const wallet = data.wallet.toLowerCase();
    const pub = publicClient();

    // 1. Viewer's directional beliefs (categories fetched separately — there is
    // no FK from wallet_beliefs.onchain_id to markets, so PostgREST can't join).
    const { data: myBeliefs } = await pub
      .from("wallet_beliefs")
      .select("onchain_id, stance, stance_side, conviction, last_trade_at")
      .eq("wallet", wallet)
      .in("stance_side", ["YES", "NO"]);

    const emptyCircles: CircleSummary[] = DOMAINS.map((d) => ({
      domain: d, insufficient: true, shared_markets: 0, top_ally: null, top_rival: null,
    }));

    if (!myBeliefs || myBeliefs.length === 0) {
      return { wallet, overall_insufficient: true, overall_shared: 0, circles: emptyCircles, cached: false };
    }

    const categoryById = new Map<number, string | null>();
    {
      const ids = Array.from(new Set(myBeliefs.map((r) => Number(r.onchain_id))));
      for (let i = 0; i < ids.length; i += 500) {
        const { data: mk } = await pub
          .from("markets")
          .select("onchain_id, category")
          .in("onchain_id", ids.slice(i, i + 500));
        for (const m of mk ?? [])
          categoryById.set(Number(m.onchain_id), (m.category as string | null) ?? null);
      }
    }

    // Build viewer factor list + domain map
    const domainOf = new Map<number, Domain>();
    const myFactors: BeliefFactor[] = [];
    for (const r of myBeliefs) {
      const id = Number(r.onchain_id);
      const cat = categoryById.get(id) ?? null;
      const dom = categoryToDomain(cat);
      if (dom) domainOf.set(id, dom);
      myFactors.push({
        onchain_id: id,
        stance: Number(r.stance ?? 0),
        stance_side: r.stance_side as BeliefFactor["stance_side"],
        conviction: Number(r.conviction ?? 0),
      });
    }


    const lastTradeAt = myBeliefs
      .map((r) => (r.last_trade_at ? new Date(r.last_trade_at as string).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);

    // 2. Cache check (per-domain rows)
    const { data: cached } = await pub
      .from("wallet_matches")
      .select("matched_wallet, match_score, shared_markets, agreements, disagreements, calculated_at, domain")
      .eq("wallet", wallet)
      .not("domain", "is", null)
      .order("match_score", { ascending: false });

    const cachedAt = cached?.[0]?.calculated_at
      ? new Date(cached[0].calculated_at as string).getTime()
      : 0;

    if (cached && cached.length > 0 && Date.now() - cachedAt < CACHE_TTL_MS && lastTradeAt <= cachedAt) {
      return buildResponse(wallet, myFactors, domainOf, cached, true);
    }

    // 3. Recompute: candidate wallets over my markets
    const myMarkets = Array.from(domainOf.keys());
    if (myMarkets.length === 0) {
      const overallShared = countOverallShared(myFactors);
      return {
        wallet,
        overall_insufficient: overallShared < MIN_SHARED_MARKETS,
        overall_shared: overallShared,
        circles: emptyCircles,
        cached: false,
      };
    }

    const { data: candidates } = await pub
      .from("wallet_beliefs")
      .select("wallet, onchain_id, stance, stance_side, conviction")
      .in("onchain_id", myMarkets)
      .in("stance_side", ["YES", "NO"])
      .neq("wallet", wallet)
      .limit(50_000);

    // Per-wallet factor bundle
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

    // Per domain, compute matches per candidate wallet, keep top ally + top rival
    type Row = {
      wallet: string; matched_wallet: string; domain: Domain;
      match_score: number; shared_markets: number; agreements: number; disagreements: number;
    };
    const persistRows: Row[] = [];
    const perDomain = new Map<Domain, Array<Row>>();

    for (const dom of DOMAINS) {
      const myBucket = myFactors.filter((f) => domainOf.get(Number(f.onchain_id)) === dom);
      if (myBucket.length < MIN_SHARED_MARKETS) continue;
      for (const [w, arr] of byWallet) {
        const otherBucket = arr.filter((f) => domainOf.get(Number(f.onchain_id)) === dom);
        if (otherBucket.length === 0) continue;
        const m = matchScore(myBucket, otherBucket);
        if (m.insufficient) continue;
        const row: Row = {
          wallet, matched_wallet: w, domain: dom,
          match_score: m.match_score,
          shared_markets: m.shared,
          agreements: m.agreements,
          disagreements: m.disagreements,
        };
        const arrD = perDomain.get(dom) ?? [];
        arrD.push(row);
        perDomain.set(dom, arrD);
      }
    }

    for (const [, rows] of perDomain) {
      rows.sort((a, b) => b.match_score - a.match_score);
      const allies = rows.slice(0, MAX_PER_CIRCLE);
      // rivals sorted ascending
      const rivals = [...rows].sort((a, b) => a.match_score - b.match_score).slice(0, MAX_PER_CIRCLE);
      persistRows.push(...allies, ...rivals);
    }

    if (persistRows.length > 0) {
      const svc = serviceClient();
      const nowIso = new Date().toISOString();
      // Wipe existing per-domain cache for this wallet then reinsert
      await svc.from("wallet_matches").delete().eq("wallet", wallet).not("domain", "is", null);
      // dedupe (matched_wallet,domain)
      const seen = new Set<string>();
      const dedup = persistRows.filter((r) => {
        const k = `${r.matched_wallet}|${r.domain}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      await svc.from("wallet_matches").insert(
        dedup.map((r) => ({ ...r, calculated_at: nowIso })),
      );
    }

    const rebuild = await pub
      .from("wallet_matches")
      .select("matched_wallet, match_score, shared_markets, agreements, disagreements, calculated_at, domain")
      .eq("wallet", wallet)
      .not("domain", "is", null)
      .order("match_score", { ascending: false });
    return buildResponse(wallet, myFactors, domainOf, rebuild.data ?? [], false);
  });

function countOverallShared(_myFactors: BeliefFactor[]): number {
  // Overall shared isn't a viewer-vs-self concept; upstream `getMatchesForWallet` handles overall.
  // Here we only report circle-level insufficiency.
  return _myFactors.length;
}

function buildResponse(
  wallet: string,
  myFactors: BeliefFactor[],
  domainOf: Map<number, Domain>,
  rows: Array<{
    matched_wallet: string;
    match_score: number;
    shared_markets: number;
    domain: string | null;
  }>,
  cached: boolean,
): CirclesResponse {
  const perDomain = new Map<Domain, typeof rows>();
  for (const r of rows) {
    if (!r.domain) continue;
    const d = r.domain as Domain;
    const arr = perDomain.get(d) ?? [];
    arr.push(r);
    perDomain.set(d, arr);
  }

  const myPerDomainCount = new Map<Domain, number>();
  for (const f of myFactors) {
    const d = domainOf.get(Number(f.onchain_id));
    if (!d) continue;
    myPerDomainCount.set(d, (myPerDomainCount.get(d) ?? 0) + 1);
  }

  const circles: CircleSummary[] = DOMAINS.map((d) => {
    const rowsD = perDomain.get(d) ?? [];
    const myCount = myPerDomainCount.get(d) ?? 0;
    if (rowsD.length === 0) {
      return {
        domain: d,
        insufficient: true,
        shared_markets: myCount,
        top_ally: null,
        top_rival: null,
      };
    }
    const sorted = [...rowsD].sort((a, b) => b.match_score - a.match_score);
    const ally = sorted[0];
    const rival = sorted[sorted.length - 1];
    return {
      domain: d,
      insufficient: false,
      shared_markets: myCount,
      top_ally: { wallet: ally.matched_wallet, match_score: Number(ally.match_score), shared: ally.shared_markets },
      top_rival: rival && rival !== ally
        ? { wallet: rival.matched_wallet, match_score: Number(rival.match_score), shared: rival.shared_markets }
        : null,
    };
  });

  return {
    wallet,
    overall_insufficient: myFactors.length < MIN_SHARED_MARKETS,
    overall_shared: myFactors.length,
    circles,
    cached,
  };
}
