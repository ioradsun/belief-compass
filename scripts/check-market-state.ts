/**
 * check-market-state — Phase 4 read-model integrity gate.
 *
 * Recomputes each market's aggregates from canonical sources and compares them to
 * the stored market_state row, reporting drift. Exits nonzero on critical drift.
 *
 * Scope: all markets (bounded pages) | --market M | --dirty (queued only) |
 *        --stale SECONDS (calculated_at older than N seconds)
 *
 * Run:  npx tsx scripts/check-market-state.ts [--market 42] [--dirty] [--stale 600] [--limit 500]
 *       (npm run check:market-state)
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { peopleYesPct } from "../src/lib/market-state/read-model";

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
  return i >= 0
    ? i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")
      ? process.argv[i + 1]
      : "true"
    : null;
}
const onlyMarket = arg("market") ? Number(arg("market")) : null;
const onlyDirty = arg("dirty") != null;
const staleSecs = arg("stale") ? Number(arg("stale")) : null;
const LIMIT = Number(arg("limit") ?? "500");

const counters = {
  checked: 0,
  missing_market_state: 0,
  missing_metadata: 0,
  believer_mismatch: 0,
  people_pct_mismatch: 0,
  event_window_mismatch: 0,
  new_believer_mismatch: 0,
  last_trade_mismatch: 0,
  circulation_missing_with_capital: 0,
  live_line_unsupported: 0,
  stale_sources: 0,
  version_anomaly: 0,
};

const approx = (a: number | null, b: number | null, tol = 1e-6): boolean => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tol + 1e-6 * Math.abs(b);
};

async function checkMarket(ms: Record<string, unknown>, now: string) {
  counters.checked += 1;
  const market = Number(ms.onchain_id);

  const { data: meta } = await sb
    .from("markets")
    .select("onchain_id")
    .eq("onchain_id", market)
    .maybeSingle();
  if (!meta) counters.missing_metadata += 1;

  const [{ data: ev }, { data: pos }, { data: tr }] = await Promise.all([
    sb.rpc("market_event_windows", { p_market: market, p_now: now }),
    sb.rpc("market_position_aggregates", { p_market: market, p_now: now }),
    sb.rpc("market_transition_windows", { p_market: market, p_now: now }),
  ]);
  const e = (ev ?? {}) as Record<string, number | string>;
  const p = (pos ?? {}) as Record<string, number | string>;
  const t = (tr ?? {}) as Record<string, number | string>;

  const by = Number(p.believers_yes ?? 0);
  const bn = Number(p.believers_no ?? 0);
  if (Number(ms.believers_yes ?? -1) !== by || Number(ms.believers_no ?? -1) !== bn)
    counters.believer_mismatch += 1;

  const expectPeople = peopleYesPct(by, bn);
  if (!approx(expectPeople, ms.people_yes_pct == null ? null : Number(ms.people_yes_pct), 0.01))
    counters.people_pct_mismatch += 1;

  if (Number(ms.trade_count_24h ?? -1) !== Number(e.trade_count_24h ?? 0))
    counters.event_window_mismatch += 1;
  if (Number(ms.new_believers_24h ?? -1) !== Number(t.new_believers_24h ?? 0))
    counters.new_believer_mismatch += 1;

  const lastTrade = (e.last_trade_at as string) ?? null;
  const storedLast = (ms.last_trade_at as string) ?? null;
  if ((lastTrade ?? "") !== (storedLast ?? "")) counters.last_trade_mismatch += 1;

  // circulation must be present when there is 24h volume AND capital.
  const totalCap = Number(ms.yes_capital_usd ?? 0) + Number(ms.no_capital_usd ?? 0);
  if (Number(ms.volume_eth_24h ?? 0) > 0 && totalCap > 0 && ms.circulation_24h == null)
    counters.circulation_missing_with_capital += 1;

  // live line must carry structured evidence.
  if (ms.live_line && !ms.live_line_payload) counters.live_line_unsupported += 1;

  // freshness
  if (staleSecs != null && ms.calculated_at) {
    const age = (Date.now() - new Date(ms.calculated_at as string).getTime()) / 1000;
    if (age > staleSecs) counters.stale_sources += 1;
  }
  if (Number(ms.read_model_version ?? 0) < 0) counters.version_anomaly += 1;
}

const MS_COLS =
  "onchain_id, believers_yes, believers_no, people_yes_pct, trade_count_24h, new_believers_24h, last_trade_at, volume_eth_24h, yes_capital_usd, no_capital_usd, circulation_24h, live_line, live_line_payload, calculated_at, read_model_version, needs_rebuild";

async function run() {
  const now = new Date().toISOString();
  if (onlyMarket != null) {
    const { data } = await sb
      .from("market_state")
      .select(MS_COLS)
      .eq("onchain_id", onlyMarket)
      .maybeSingle();
    if (!data) counters.missing_market_state += 1;
    else await checkMarket(data as Record<string, unknown>, now);
  } else {
    let last = -1;
    for (;;) {
      let q = sb.from("market_state").select(MS_COLS);
      if (onlyDirty) q = q.eq("needs_rebuild", true);
      if (staleSecs != null)
        q = q.lt("calculated_at", new Date(Date.now() - staleSecs * 1000).toISOString());
      const { data, error } = await q
        .gt("onchain_id", last)
        .order("onchain_id", { ascending: true })
        .limit(LIMIT);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      if (rows.length === 0) break;
      for (const r of rows) await checkMarket(r as Record<string, unknown>, now);
      last = Number(rows[rows.length - 1].onchain_id);
    }
  }

  console.log("[check-market-state] " + JSON.stringify(counters, null, 2));
  const critical =
    counters.believer_mismatch +
    counters.people_pct_mismatch +
    counters.event_window_mismatch +
    counters.new_believer_mismatch +
    counters.circulation_missing_with_capital +
    counters.live_line_unsupported;
  if (critical > 0) {
    console.error(`[check-market-state] FAILED — ${critical} critical drift issue(s)`);
    process.exit(1);
  }
  console.log("[check-market-state] OK");
}

run().catch((e) => {
  console.error("[check-market-state] error:", e instanceof Error ? e.message : e);
  process.exit(2);
});
