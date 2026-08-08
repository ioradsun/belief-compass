/**
 * check-position-integrity — Phase 3 position correctness gate.
 *
 * Reports (and exits nonzero on critical failures):
 *   • positions without a cursor            (have shares but never applied)
 *   • positions cursoring a noncanonical event
 *   • positions behind canonical history    (pending unapplied events)
 *   • positions ahead of canonical history  (cursor past all canonical events)
 *   • positions marked dirty
 *   • positions with a state-hash mismatch vs a full canonical refold
 *   • positions with invalid share balances (negative)
 *   • positions with invalid cost basis     (negative)
 *   • positions whose last_trade_at differs from the canonical last event
 *
 * Scope: all pairs (bounded pages) | --wallet W | --market M | --wallet W --market M
 *
 * Run:  npx tsx scripts/check-position-integrity.ts [--wallet 0x..] [--market 42] [--limit 500]
 *       (npm run check:positions)
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import {
  refold,
  reducerStateHash,
  type TradeEventForApply,
} from "../src/lib/positions/position-core";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    // NAME WHICH ONE. "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" was
    // reported as this script hanging, because a message that lists both when
    // only one is absent reads as a broken environment rather than a missing
    // key. It exits in well under a second; it just never said what to do.
    `Missing ${[!url && "SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"]
      .filter(Boolean)
      .join(
        " and ",
      )}.\n\nThis check reads tables the publishable key cannot see, so there is no\ndegraded mode — it needs the service role key or nothing it prints is true.`,
  );
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const onlyWallet = arg("wallet")?.toLowerCase() ?? null;
const onlyMarket = arg("market") ? Number(arg("market")) : null;
const LIMIT = Number(arg("limit") ?? "500");

const counters = {
  checked: 0,
  no_cursor_with_shares: 0,
  cursor_noncanonical: 0,
  behind_history: 0,
  ahead_of_history: 0,
  dirty: 0,
  state_hash_mismatch: 0,
  invalid_shares: 0,
  invalid_cost: 0,
  last_trade_at_mismatch: 0,
};

async function loadAllEvents(wallet: string, market: number): Promise<TradeEventForApply[]> {
  const { data } = await sb
    .from("events")
    .select(
      "id, source_key, wallet, market_id, side, action, amount_eth, shares, occurred_at, block_number, log_index",
    )
    .eq("is_canonical", true)
    .eq("kind", "trade")
    .eq("wallet", wallet)
    .eq("market_id", String(market))
    .order("block_number", { ascending: true })
    .order("log_index", { ascending: true })
    .limit(5000);
  return (data ?? []).map((r) => ({
    event_id: r.id as string,
    source_key: r.source_key as string,
    wallet: r.wallet as string,
    market_id: String(r.market_id),
    side: r.side as "YES" | "NO",
    action: r.action as "BUY" | "SELL",
    amount_eth: r.amount_eth as string,
    shares: r.shares as string,
    occurred_at: r.occurred_at as string,
    block_number: Number(r.block_number),
    log_index: Number(r.log_index),
  }));
}

async function checkPair(p: Record<string, unknown>) {
  counters.checked += 1;
  const wallet = String(p.wallet).toLowerCase();
  const market = Number(p.onchain_id);
  const hasShares = Number(p.yes_shares ?? 0) > 0 || Number(p.no_shares ?? 0) > 0;

  if (Number(p.yes_shares ?? 0) < 0 || Number(p.no_shares ?? 0) < 0) counters.invalid_shares += 1;
  if (Number(p.yes_cost ?? 0) < 0 || Number(p.no_cost ?? 0) < 0) counters.invalid_cost += 1;
  if (p.needs_rebuild) counters.dirty += 1;

  const events = await loadAllEvents(wallet, market);
  const cursorBlock =
    p.last_applied_block_number != null ? Number(p.last_applied_block_number) : null;
  const cursorLog = p.last_applied_log_index != null ? Number(p.last_applied_log_index) : null;

  if (cursorBlock == null && hasShares) counters.no_cursor_with_shares += 1;

  if (events.length > 0) {
    const last = events[events.length - 1];
    if (cursorBlock != null) {
      const atLast = cursorBlock === last.block_number && cursorLog === last.log_index;
      const beyond =
        cursorBlock > last.block_number ||
        (cursorBlock === last.block_number && (cursorLog ?? 0) > last.log_index);
      if (beyond) counters.ahead_of_history += 1;
      else if (!atLast) counters.behind_history += 1;
      // cursor source_key must be canonical (present in the events set).
      const keys = new Set(events.map((e) => e.source_key));
      if (p.last_applied_source_key && !keys.has(String(p.last_applied_source_key)))
        counters.cursor_noncanonical += 1;
      // last_trade_at should equal the last canonical event's time.
      if (
        p.last_trade_at &&
        new Date(p.last_trade_at as string).toISOString() !==
          new Date(last.occurred_at).toISOString()
      )
        counters.last_trade_at_mismatch += 1;
    }
    // State-hash drift vs a full canonical refold.
    if (!p.needs_rebuild && p.state_hash) {
      const fold = refold(events);
      const rebuilt = reducerStateHash(fold.row, fold.cursor.source_key);
      if (rebuilt !== String(p.state_hash)) counters.state_hash_mismatch += 1;
    }
  }
}

const COLS =
  "wallet, onchain_id, yes_shares, no_shares, yes_cost, no_cost, needs_rebuild, state_hash, last_trade_at, last_applied_block_number, last_applied_log_index, last_applied_source_key";

async function run() {
  if (onlyWallet && onlyMarket != null) {
    const { data } = await sb
      .from("wallet_beliefs")
      .select(COLS)
      .eq("wallet", onlyWallet)
      .eq("onchain_id", onlyMarket)
      .maybeSingle();
    if (data) await checkPair(data as Record<string, unknown>);
  } else {
    let lastWallet = "";
    let lastMarket = -1;
    for (;;) {
      let q = sb.from("wallet_beliefs").select(COLS);
      if (onlyWallet) q = q.eq("wallet", onlyWallet);
      if (onlyMarket != null) q = q.eq("onchain_id", onlyMarket);
      const { data, error } = await q
        .or(`wallet.gt.${lastWallet},and(wallet.eq.${lastWallet},onchain_id.gt.${lastMarket})`)
        .order("wallet", { ascending: true })
        .order("onchain_id", { ascending: true })
        .limit(LIMIT);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      if (rows.length === 0) break;
      for (const r of rows) await checkPair(r as Record<string, unknown>);
      const last = rows[rows.length - 1];
      lastWallet = String(last.wallet);
      lastMarket = Number(last.onchain_id);
      if (onlyWallet || onlyMarket != null) break;
    }
  }

  console.log("[check-positions] " + JSON.stringify(counters, null, 2));
  const critical =
    counters.cursor_noncanonical +
    counters.behind_history +
    counters.ahead_of_history +
    counters.state_hash_mismatch +
    counters.invalid_shares +
    counters.invalid_cost;
  if (critical > 0) {
    console.error(`[check-positions] FAILED — ${critical} critical correctness issue(s)`);
    process.exit(1);
  }
  console.log("[check-positions] OK");
}

run().catch((e) => {
  console.error("[check-positions] error:", e instanceof Error ? e.message : e);
  process.exit(2);
});
