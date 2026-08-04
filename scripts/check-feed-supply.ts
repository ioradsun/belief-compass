/**
 * check-feed-supply — the canonical-trade → rendered-tape reconciliation.
 *
 * `check:data-flow` proves canonical trades EXIST. It says nothing about whether
 * they reach the Live tape, and those are different questions: a trade can be
 * perfectly indexed and still be discarded at admission, priced at $0, or sorted
 * behind an older system row.
 *
 * This walks the exact path, stage by stage, and reports the FIRST boundary each
 * recent trade fails at:
 *
 *   canonical trade
 *     → LIVE_KINDS eligible?
 *     → inside the 72h live window?
 *     → survives grouping (burst / wash collapse)?
 *     → priced (needs a usable eth_usd)?
 *     → material, or admitted by adaptive density?
 *
 * It stops at the API boundary on purpose: mixing and rendering are pure and
 * covered by unit tests, and everything that has actually gone wrong in
 * production went wrong before that point.
 *
 * RUNS AS THE APP DOES. It authenticates with the PUBLISHABLE (anon) key, not
 * the service role, because every table it touches is one the live tape reads
 * through `publicClient()` — and privilege is itself a failure mode. A
 * service-role diagnostic reported `eth_usd = 3500 ✓ healthy` while the feed saw
 * nothing at all, because `calc_cache` had RLS enabled and no anon policy: the
 * read returns HTTP 200 with zero rows, silently. A checker with more access
 * than the thing it checks will certify a broken system.
 *
 * Run:  npx tsx scripts/check-feed-supply.ts [--hours 2] [--rows 25]
 * Env:  SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)
 */
import { createClient } from "@supabase/supabase-js";
import { groupLiveRows, type LiveEventInput } from "../src/lib/live-tape";
import { scoreFeedEvent } from "../src/domain/feed-event";
import { adaptiveFloor, admitToFeed, DENSITY } from "../src/domain/feed-density";

const url = process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY");
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const HOURS = arg("hours", 2);
const ROWS = arg("rows", 25);

/** Must match LIVE_KINDS in src/lib/live.functions.ts. */
const LIVE_KINDS = [
  "trade",
  "market_created",
  "position_changed_side",
  "believer_milestone",
  "tribe_doubled",
  "market_transition",
  "conviction_cohort",
];
const LIVE_WINDOW_MS = 72 * 60 * 60_000;

const age = (iso: string | null | undefined): string => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60
    ? `${m}m ago`
    : m < 1440
      ? `${(m / 60).toFixed(1)}h ago`
      : `${(m / 1440).toFixed(1)}d ago`;
};

let failed = false;
const fail = (msg: string) => {
  failed = true;
  console.error(`  ✗ ${msg}`);
};

/**
 * Every table the live tape reads with the PUBLIC client. A read that 401s (no
 * grant) or silently returns zero rows (RLS with no policy) is the failure mode
 * that hid a dead feed for months, and neither one throws in application code.
 * `expectRows` marks tables that must not be empty in a live system, which is
 * what separates "invisible" from "genuinely empty".
 */
const ANON_READS: Array<{ table: string; expectRows: boolean }> = [
  { table: "events", expectRows: true },
  { table: "markets", expectRows: true },
  { table: "market_state", expectRows: true },
  { table: "calc_cache", expectRows: true },
];

async function checkAccess() {
  console.log(`\n═══ ACCESS (as the public client) ═══`);
  for (const { table, expectRows } of ANON_READS) {
    const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
    if (error) {
      fail(`${table}: ${error.message} — the app reads this with the anon key and cannot.`);
      continue;
    }
    const n = count ?? 0;
    if (expectRows && n === 0) {
      fail(
        `${table}: readable but EMPTY to anon. RLS with no SELECT policy returns 200 + zero rows, ` +
          `so this looks identical to an empty table from inside the app.`,
      );
      continue;
    }
    console.log(`  ✓ ${table.padEnd(16)} ${n} rows visible`);
  }
}

async function main() {
  const sinceIso = new Date(Date.now() - HOURS * 3_600_000).toISOString();
  await checkAccess();

  // ── 1. The price. Everything downstream depends on it. ────────────────────
  console.log(`\n═══ ETH/USD ═══`);
  const { data: cal } = await sb
    .from("calc_cache")
    .select("value, updated_at")
    .eq("key", "eth_usd")
    .maybeSingle();
  const ethUsd = Number((cal as { value?: number } | null)?.value ?? 0) || 0;
  console.log(`  calc_cache.eth_usd = ${cal ? JSON.stringify(cal.value) : "(row missing)"}`);
  console.log(`  refreshed           ${age((cal as { updated_at?: string } | null)?.updated_at)}`);
  if (!(ethUsd > 0)) {
    fail("the feed cannot read an ETH price, so every trade is reported WITHOUT an amount.");
    console.error(
      cal == null
        ? "    cause: the row is INVISIBLE to the anon role — calc_cache has RLS on and no SELECT policy.\n" +
            "           Refreshing the value will not help; the feed reads it with the public client.\n" +
            "           fix: GRANT SELECT ON public.calc_cache TO anon, authenticated; + a permissive policy."
        : "    cause: the stored value is null or zero — eth_usd_calibration() returns NULL when no\n" +
            "           market has volume_total_usd > 0.\n" +
            "           fix: SELECT public.refresh_eth_usd_calibration();",
    );
  }

  // ── 2. Supply. Do canonical trades exist in the window at all? ────────────
  console.log(`\n═══ SUPPLY (last ${HOURS}h) ═══`);
  const { count: tradeCount } = await sb
    .from("events")
    .select("source_key", { count: "exact", head: true })
    .eq("is_canonical", true)
    .eq("kind", "trade")
    .gte("occurred_at", sinceIso);
  console.log(`  canonical trades     ${tradeCount ?? 0}`);

  const { data: kindRows } = await sb
    .from("events")
    .select("kind")
    .eq("is_canonical", true)
    .gte("occurred_at", sinceIso)
    .limit(5000);
  const byKind = new Map<string, number>();
  for (const r of (kindRows ?? []) as { kind: string }[])
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  console.log(`  events by kind:`);
  for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1]))
    console.log(`    ${LIVE_KINDS.includes(k) ? "live " : "SKIP "} ${k.padEnd(24)} ${n}`);
  // Not every kind SHOULD reach the tape. position_* rows mirror what a trade
  // already says with more detail (who, how much, what it did to their belief),
  // so listing them here is information, not an accusation.
  const unlisted = [...byKind.keys()].filter((k) => !LIVE_KINDS.includes(k));
  if (unlisted.length)
    console.log(
      `    not live-eligible: ${unlisted.join(", ")} — expected for position_* mirrors of trades.`,
    );

  // ── 3. Freshness. Where exactly does the gap open? ────────────────────────
  console.log(`\n═══ FRESHNESS ═══`);
  const newestOf = async (kind?: string) => {
    let q = sb
      .from("events")
      .select("occurred_at")
      .eq("is_canonical", true)
      .order("occurred_at", { ascending: false })
      .limit(1);
    q = kind ? q.eq("kind", kind) : q.in("kind", LIVE_KINDS);
    const { data } = await q;
    return (data?.[0] as { occurred_at?: string } | undefined)?.occurred_at ?? null;
  };
  const newestTrade = await newestOf("trade");
  const newestLive = await newestOf();
  console.log(`  newest canonical trade      ${age(newestTrade)}`);
  console.log(`  newest LIVE_KINDS event     ${age(newestLive)}`);
  if (newestTrade && Date.now() - Date.parse(newestTrade) > LIVE_WINDOW_MS)
    fail("newest trade is older than the 72h live window — the tape can only show system rows.");

  // ── 4. Admission. Replay the real pipeline over the newest rows. ──────────
  console.log(`\n═══ ADMISSION (newest ${ROWS} live-eligible events) ═══`);
  const { data: raw } = await sb
    .from("events")
    .select(
      "source_key, kind, market_id, side, action, amount_eth, wallet, occurred_at, block_number, log_index",
    )
    .eq("is_canonical", true)
    .in("kind", LIVE_KINDS)
    .gte("occurred_at", new Date(Date.now() - LIVE_WINDOW_MS).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(ROWS * 3);

  const events: LiveEventInput[] = ((raw ?? []) as Record<string, unknown>[]).map((r) => ({
    source_key: String(r.source_key),
    kind: String(r.kind),
    market_id: String(r.market_id),
    market_title: null,
    occurred_at: String(r.occurred_at),
    block_number: (r.block_number as number | null) ?? null,
    log_index: (r.log_index as number | null) ?? null,
    side: (r.side as "YES" | "NO" | null) ?? null,
    action: (r.action as "BUY" | "SELL" | null) ?? null,
    amount_eth: Number(r.amount_eth ?? 0) / 1e18,
    wallet: (r.wallet as string) ?? null,
    payload: null,
  }));
  console.log(`  fetched ${events.length} raw events`);

  const grouped = groupLiveRows(events, ethUsd).slice(0, ROWS);
  console.log(`  ${grouped.length} rows after grouping (bursts + wash collapse)`);

  // Market size drives market-relative magnitude, so read it for real.
  const ids = [...new Set(grouped.map((g) => Number(g.marketId)))];
  const believers = new Map<number, number>();
  if (ids.length) {
    const { data: ms } = await sb
      .from("market_state")
      .select("onchain_id, believers_yes, believers_no")
      .in("onchain_id", ids);
    for (const s of (ms ?? []) as Record<string, number>[])
      believers.set(
        Number(s.onchain_id),
        Number(s.believers_yes ?? 0) + Number(s.believers_no ?? 0),
      );
  }

  const cands = grouped.map((g) => ({
    row: g,
    c: {
      kind: g.kind,
      side: g.side,
      amountUsd: g.amountUsd,
      walletCount: g.walletCount,
      tradeCount: g.tradeCount,
      marketBelievers: believers.get(Number(g.marketId)) ?? null,
    },
  }));
  const { floor, relaxed } = adaptiveFloor(cands.map(({ c }) => scoreFeedEvent(c).score));
  console.log(`  density floor ${floor}${relaxed ? " (RELAXED — quiet window)" : " (standard)"}\n`);

  let admitted = 0;
  for (const { row, c } of cands) {
    const s = scoreFeedEvent(c);
    const ok = admitToFeed(c, floor);
    if (ok) admitted += 1;
    const why = ok
      ? "admitted"
      : row.kind === "round_trip"
        ? "REJECTED: wash (never admitted)"
        : c.amountUsd != null && c.amountUsd < DENSITY.dustUsd
          ? `REJECTED: dust (<$${DENSITY.dustUsd})`
          : `REJECTED: score ${s.score} < floor ${floor}`;
    console.log(
      `  ${ok ? "✓" : "✗"} ${age(row.occurredAt).padEnd(9)} ${row.kind.padEnd(14)} ` +
        `mkt ${String(row.marketId).padEnd(6)} ` +
        `${c.amountUsd == null ? "$?    " : `$${c.amountUsd.toFixed(2)}`.padEnd(9)} ` +
        `believers ${String(c.marketBelievers ?? "?").padEnd(5)} tier ${s.tier} score ${String(s.score).padEnd(3)} ${why}`,
    );
  }
  console.log(`\n  ${admitted}/${cands.length} admitted to the tape.`);
  if (cands.length > 0 && admitted === 0)
    fail("nothing was admitted. The tape will render empty regardless of mixing or UI.");

  console.log(
    failed
      ? "\n✗ feed supply is broken — see the failures above.\n"
      : "\n✓ feed supply is healthy: recent trades reach the tape.\n",
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
