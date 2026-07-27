/**
 * Market read-model reads — the ONE shared way product code gets current global
 * market facts. Joins `markets` (stable metadata + POV display) with `market_state`
 * (the canonical read model). Returns FACTS only — no viewer relevance, no ranking,
 * no opportunity type. Viewer-specific routes may COMPOSE these facts with a
 * viewer position, but must not recompute the global facts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicClient } from "@/lib/supabase-clients";
import { type JsonValue } from "@/lib/events";

// Global read-model columns product surfaces consume. Excludes raw internals.
const STATE_COLS =
  "onchain_id, yes_price_usd, no_price_usd, money_yes_pct, people_yes_pct, people_no_pct, divergence, " +
  "believers_yes, believers_no, believers_mixed, directional_believers, active_positions, " +
  "yes_capital_usd, no_capital_usd, capital_held_yes, capital_held_no, capital_held_total, " +
  "volume_total_usd, volume_24h_usd, volume_eth_1h, volume_eth_24h, volume_eth_7d, " +
  "trade_count_1h, trade_count_24h, trade_count_7d, buy_count_24h, sell_count_24h, " +
  "unique_wallets_1h, unique_wallets_24h, unique_wallets_7d, " +
  "new_believers_1h, new_believers_24h, new_believers_7d, side_flips_24h, " +
  "circulation_1h, circulation_24h, circulation_7d, buy_sell_ratio_24h, sell_rate_24h, side_balance, " +
  "yes_price_change_1h, yes_price_change_24h, chg_1h, chg_24h, boost_score, trending_score, " +
  "first_trade_at, last_trade_at, last_position_change_at, market_age_days, inactive_for_seconds, " +
  "avg_directional_days, median_directional_days, p75_directional_days, " +
  "avg_conviction_strength, median_conviction_strength, " +
  "live_line, live_line_kind, live_line_window, live_line_occurred_at, live_line_payload, " +
  "calculated_at, events_updated_at, positions_updated_at, pov_updated_at, read_model_version";

const META_COLS = "onchain_id, title, category, author_wallet, author_name, author_pfp, created_at";

type Row = Record<string, JsonValue>;
export type MarketReadModel = Row; // includes a nested `meta` object

function join(meta: Row[], state: Row[]): MarketReadModel[] {
  const metaById = new Map<number, Row>();
  for (const m of meta) metaById.set(Number(m.onchain_id), m);
  return state.map((s) => ({
    ...s,
    onchain_id: Number(s.onchain_id),
    meta: metaById.get(Number(s.onchain_id)) ?? null,
  }));
}

const asRows = (d: unknown): Row[] => (d as unknown as Row[]) ?? [];

/** One market's global read model (markets ⋈ market_state). */
export const getMarketReadModel = createServerFn({ method: "GET" })
  .inputValidator((d: { marketId: number }) => z.object({ marketId: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const [state, meta] = await Promise.all([
      sb.from("market_state").select(STATE_COLS).eq("onchain_id", data.marketId).maybeSingle(),
      sb.from("markets").select(META_COLS).eq("onchain_id", data.marketId).maybeSingle(),
    ]);
    if (!state.data)
      return { data: null as MarketReadModel | null, error: state.error?.message ?? null };
    const joined = join(meta.data ? [meta.data as unknown as Row] : [], [
      state.data as unknown as Row,
    ]);
    return { data: joined[0] as MarketReadModel | null, error: null };
  });

const listInput = z.object({
  ids: z.array(z.number().int()).max(500).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  orderBy: z
    .enum(["last_trade_at", "volume_eth_24h", "directional_believers", "circulation_24h"])
    .optional(),
});

/** Many markets' global read models. Facts for candidate lists (no ranking). */
export const listMarketReadModels = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof listInput> | undefined) => listInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const sb = publicClient();
    let q = sb.from("market_state").select(STATE_COLS);
    if (data.ids && data.ids.length > 0) q = q.in("onchain_id", data.ids);
    q = q
      .order(data.orderBy ?? "last_trade_at", { ascending: false, nullsFirst: false })
      .limit(data.limit ?? 100) as typeof q;
    const { data: state, error } = await q;
    if (error) return { data: [] as MarketReadModel[], error: error.message };
    const rows = asRows(state);
    const ids = rows.map((s) => Number(s.onchain_id));
    const { data: meta } = await sb.from("markets").select(META_COLS).in("onchain_id", ids);
    return { data: join(asRows(meta), rows), error: null };
  });
