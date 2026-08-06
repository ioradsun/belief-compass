/**
 * THE ONE SERVER-SIDE PRODUCER OF "WHAT MOVED OVER THIS WINDOW", IN BULK.
 *
 * The client already has exactly one answer to that question: `useMarketChange`
 * (src/lib/market-change-query) pairs the authoritative current row with a
 * per-window snapshot baseline and hands both to src/domain/market-change.
 *
 * Server list loaders used to answer it a second way — reading the precomputed
 * `market_window_change` table (a SQL percentage over `price_snapshots`) while
 * other surfaces read `market_state.chg_24h_yes` (a different SQL job over the
 * same idea) and the panels read the snapshot baselines. Three producers, three
 * baselines, one fact. Cards and panels for the same market could disagree.
 *
 * So the list loaders now use THIS: the same history table
 * (`market_state_snapshots`), read in bulk, through the same derivation
 * (`changeFromBaseline` → `gain`). The stored percentages are no longer read
 * anywhere; the facts are stored once and the ratio is computed once.
 */
import { changeFromBaseline, type MarketChange } from "@/domain/market-change";
import { nowFromRow } from "@/lib/market-change-query";
import type { WindowBaseline } from "@/lib/markets.functions";

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

const fin = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

export interface WindowChanges {
  /** Per market: the full change shape every surface renders from. */
  byId: Map<number, MarketChange>;
  /** Oldest baseline boundary actually observed — "history since". */
  historyFrom: string | null;
}

/** Per-window baselines for many markets, from the single history table. */
export async function loadWindowBaselines(
  sb: unknown,
  ids: number[],
  win: string,
): Promise<{ baselines: Map<number, WindowBaseline>; historyFrom: string | null }> {
  const baselines = new Map<number, WindowBaseline>();
  let historyFrom: string | null = null;
  if (!ids.length) return { baselines, historyFrom };
  try {
    const { data, error } = await (sb as RpcClient).rpc("market_window_baselines_bulk", {
      p_ids: ids,
      p_window: win,
    });
    if (error || !Array.isArray(data)) return { baselines, historyFrom };
    for (const raw of data as Array<Record<string, unknown>>) {
      const id = Number(raw["onchain_id"]);
      if (!Number.isFinite(id)) continue;
      baselines.set(id, {
        believersYes: fin(raw["believers_yes"]),
        believersNo: fin(raw["believers_no"]),
        yesCapitalUsd: fin(raw["yes_capital_usd"]),
        noCapitalUsd: fin(raw["no_capital_usd"]),
        yesPriceUsd: fin(raw["yes_price_usd"]),
        noPriceUsd: fin(raw["no_price_usd"]),
      });
      const at = raw["captured_at"] == null ? null : String(raw["captured_at"]);
      if (at && (historyFrom == null || at < historyFrom)) historyFrom = at;
    }
  } catch {
    /* no history yet → every rank is "unknown", never a fabricated zero */
  }
  return { baselines, historyFrom };
}

/**
 * The change shape for a page of markets. `rows` must carry the authoritative
 * current state (`believers_*`, `*_capital_usd`, `*_price_usd`) — the same
 * fields `nowFromRow` reads on the client, so list and panel cannot drift.
 */
export async function loadWindowChanges(
  sb: unknown,
  rows: Array<Record<string, unknown>>,
  win: string,
): Promise<WindowChanges> {
  const ids = rows
    .map((r) => Number(r["onchain_id"]))
    .filter((n) => Number.isFinite(n)) as number[];
  const { baselines, historyFrom } = await loadWindowBaselines(sb, ids, win);
  const byId = new Map<number, MarketChange>();
  for (const r of rows) {
    const id = Number(r["onchain_id"]);
    if (!Number.isFinite(id)) continue;
    byId.set(id, changeFromBaseline(nowFromRow(r), baselines.get(id) ?? null, win));
  }
  return { byId, historyFrom };
}

/** The window price move for one side, as a percentage, or null when unknown. */
export function pricePct(change: MarketChange | undefined, side: "YES" | "NO"): number | null {
  const m = side === "YES" ? change?.yes.price : change?.no.price;
  return m?.pct ?? null;
}
