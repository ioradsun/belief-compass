/**
 * backfill-position-cursors — give existing wallet_beliefs rows their Phase-3
 * application cursor + state hash WITHOUT changing position math.
 *
 * For every existing position: find the latest canonical trade event for the
 * pair, populate the cursor (event id/source_key/block/log), count canonical
 * trade events into applied_trade_count, and store a deterministic reducer-state
 * hash of the CURRENT stored state. Shares/costs/sides/timestamps are untouched.
 *
 * A pair whose stored trade count cannot be reconciled with canonical history is
 * marked needs_rebuild = 'cursor_backfill_mismatch' (never guessed).
 *
 * Resumable, idempotent, bounded. Run once after the schema migration.
 *
 * Run:  npx tsx scripts/backfill-position-cursors.ts   (npm run backfill:position-cursors)
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (required)
 *       BACKFILL_POS_BATCH   pairs per page   (default 300)
 */
import { createClient } from "@supabase/supabase-js";
import { reducerStateHash } from "../src/lib/positions/position-core";
import type { BeliefRow } from "../src/domain/domain";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const BATCH = Number(process.env.BACKFILL_POS_BATCH ?? "300");

function rowFromDb(r: Record<string, unknown>): BeliefRow {
  return {
    yes_shares: Number(r.yes_shares ?? 0),
    no_shares: Number(r.no_shares ?? 0),
    yes_cost: Number(r.yes_cost ?? 0),
    no_cost: Number(r.no_cost ?? 0),
    expressed_side: (r.expressed_side as BeliefRow["expressed_side"]) ?? "INACTIVE",
    directional_since: r.directional_since ? new Date(r.directional_since as string) : null,
    first_backed_at: r.first_backed_at ? new Date(r.first_backed_at as string) : null,
    last_trade_at: r.last_trade_at ? new Date(r.last_trade_at as string) : null,
  };
}

async function run() {
  let processed = 0;
  let cursored = 0;
  let noHistory = 0;
  // Keyset over (wallet, onchain_id).
  let lastWallet = "";
  let lastMarket = -1;

  for (;;) {
    const { data, error } = await sb
      .from("wallet_beliefs")
      .select(
        "wallet, onchain_id, yes_shares, no_shares, yes_cost, no_cost, expressed_side, directional_since, first_backed_at, last_trade_at, applied_trade_count",
      )
      .or(`wallet.gt.${lastWallet},and(wallet.eq.${lastWallet},onchain_id.gt.${lastMarket})`)
      .order("wallet", { ascending: true })
      .order("onchain_id", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const r of rows) {
      processed += 1;
      const wallet = String(r.wallet);
      const market = Number(r.onchain_id);

      // Latest canonical trade event for the pair.
      const { data: latest } = await sb
        .from("events")
        .select("id, source_key, block_number, log_index")
        .eq("is_canonical", true)
        .eq("kind", "trade")
        .eq("wallet", wallet)
        .eq("market_id", String(market))
        .order("block_number", { ascending: false })
        .order("log_index", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: canonicalCount } = await sb
        .from("events")
        .select("*", { count: "exact", head: true })
        .eq("is_canonical", true)
        .eq("kind", "trade")
        .eq("wallet", wallet)
        .eq("market_id", String(market));

      const hash = reducerStateHash(
        rowFromDb(r as Record<string, unknown>),
        (latest?.source_key as string) ?? null,
      );

      if (!latest) {
        // A position with shares but no canonical history cannot be trusted.
        const hasShares = Number(r.yes_shares ?? 0) > 0 || Number(r.no_shares ?? 0) > 0;
        if (hasShares) {
          noHistory += 1;
          await sb
            .from("wallet_beliefs")
            .update({
              needs_rebuild: true,
              rebuild_reason: "cursor_backfill_mismatch",
              rebuild_requested_at: new Date().toISOString(),
              state_hash: hash,
            })
            .eq("wallet", wallet)
            .eq("onchain_id", market);
        } else {
          await sb
            .from("wallet_beliefs")
            .update({ state_hash: hash })
            .eq("wallet", wallet)
            .eq("onchain_id", market);
        }
      } else {
        cursored += 1;
        await sb
          .from("wallet_beliefs")
          .update({
            last_applied_event_id: latest.id,
            last_applied_source_key: latest.source_key,
            last_applied_block_number: latest.block_number,
            last_applied_log_index: latest.log_index,
            applied_trade_count: canonicalCount ?? 0,
            state_hash: hash,
          })
          .eq("wallet", wallet)
          .eq("onchain_id", market);
      }
    }

    const last = rows[rows.length - 1];
    lastWallet = String(last.wallet);
    lastMarket = Number(last.onchain_id);
    console.log(
      `[backfill-cursors] processed=${processed} cursored=${cursored} no_history=${noHistory}`,
    );
  }

  console.log(
    `[backfill-cursors] DONE — processed=${processed} cursored=${cursored} ` +
      `no_canonical_history(marked_dirty)=${noHistory}`,
  );
}

run().catch((e) => {
  console.error("[backfill-cursors] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
