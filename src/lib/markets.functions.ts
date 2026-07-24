/**
 * Public server functions used by the client. No auth required —
 * these read public tables via the publishable key.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

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

export const listFeed = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data, error } = await sb
    .from("market_state")
    .select(`
      onchain_id, yes_price_usd, no_price_usd, money_yes_pct, people_yes_pct,
      believers_yes, believers_no, believers_mixed, divergence,
      volume_total_usd, trending_score, chg_1h, chg_24h,
      new_believers_1h, velocity_5m,
      markets:onchain_id ( title, category, author_name, author_pfp )
    `)
    .order("trending_score", { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
});

export const getMarket = createServerFn({ method: "GET" })
  .inputValidator((d: { onchain_id: number }) =>
    z.object({ onchain_id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const [state, market, believers, events] = await Promise.all([
      sb.from("market_state").select("*").eq("onchain_id", data.onchain_id).maybeSingle(),
      sb.from("markets").select("*").eq("onchain_id", data.onchain_id).maybeSingle(),
      sb.from("wallet_beliefs").select("wallet, stance_side, stance, conviction, days_held, first_backed_at")
        .eq("onchain_id", data.onchain_id)
        .in("stance_side", ["YES", "NO"])
        .order("conviction", { ascending: false })
        .limit(50),
      sb.from("feed_events").select("*")
        .eq("onchain_id", data.onchain_id)
        .order("occurred_at", { ascending: false })
        .limit(30),
    ]);
    return {
      state: state.data ?? null,
      market: market.data ?? null,
      believers: believers.data ?? [],
      events: events.data ?? [],
    };
  });

export const getWallet = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string }) =>
    z.object({ wallet: z.string().min(3) }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const wallet = data.wallet.toLowerCase();
    const { data: positions } = await sb
      .from("wallet_beliefs")
      .select(`
        onchain_id, expressed_side, stance_side, stance, conviction, days_held,
        yes_shares, no_shares, first_backed_at,
        markets:onchain_id ( title, category )
      `)
      .eq("wallet", wallet)
      .order("conviction", { ascending: false })
      .limit(200);
    return { wallet, positions: positions ?? [] };
  });
