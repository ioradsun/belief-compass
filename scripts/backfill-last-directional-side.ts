/**
 * backfill-last-directional-side — recover the side people held before they left.
 *
 * WHY A SCRIPT AND NOT SQL. The migration backfills the easy half: a position
 * that is directional right now obviously last went the way it is going. The
 * hard half — the 43.5% of positions that are fully exited, which are the entire
 * reason the column exists — is only recoverable from the trade tape, and the
 * tape must be folded by the PRODUCTION REDUCER. `applyTrade` owns share and
 * side math; re-deriving "which way were they facing" in SQL would be a second
 * implementation of it, which is the failure this codebase keeps repeating.
 *
 * WHY NOT THE TRANSITION EVENTS, which would be far cheaper. Because they are
 * incomplete, and measurably so: replaying the tape finds 75 wallet-market pairs
 * that switched sides, while only 26 `position_changed_side` events exist. The
 * rebuilder never emits transitions at all, and a side change caused purely by
 * price movement emits nothing. An event-driven backfill would write confident,
 * wrong sides for roughly two thirds of the switches — worse than leaving the
 * column null, because a wrong remembered side flips an agreement into a
 * disagreement in someone's DNA.
 *
 * WHAT IT WRITES: the most recent directional side per (wallet, market). One
 * field, one answer — YES → exit → NO → exit records NO. See the column comment.
 *
 * SAFE TO RE-RUN. It only ever fills a NULL, and it verifies against the stored
 * position before writing, so a pair whose row disagrees with the tape is
 * reported rather than silently overwritten.
 *
 * Run:  npx tsx scripts/backfill-last-directional-side.ts [--apply] [--limit N]
 *       (npm run backfill:last-directional-side -- --apply)
 *       Without --apply it is a DRY RUN and writes nothing.
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { applyTrade, emptyRow, type BeliefRow } from "../src/domain/domain";
import { weiToEth } from "../src/domain/money";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const APPLY = process.argv.includes("--apply");
const argOf = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : null;
};
const LIMIT = Number(argOf("limit") ?? "0");

const PAGE = 1000;

/** Every canonical trade, in chain order. Paged — Supabase caps a select at 1000. */
async function* tradeEvents() {
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("events")
      .select(
        "wallet, market_id, side, action, amount_eth, shares, occurred_at, block_number, log_index",
      )
      .eq("kind", "trade")
      .eq("is_canonical", true)
      .order("block_number", { ascending: true })
      .order("log_index", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`events: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) yield r as Record<string, unknown>;
    if (rows.length < PAGE) return;
  }
}

async function main() {
  console.log(APPLY ? "APPLYING" : "DRY RUN — pass --apply to write\n");

  // ── Fold the tape through the production reducer ──────────────────────────
  const rows = new Map<string, BeliefRow>();
  let events = 0;
  for await (const e of tradeEvents()) {
    const side = e.side === "NO" ? "NO" : "YES";
    if (e.side !== "YES" && e.side !== "NO") continue;
    if (e.action !== "BUY" && e.action !== "SELL") continue;
    const k = `${String(e.wallet).toLowerCase()}|${Number(e.market_id)}`;
    rows.set(
      k,
      applyTrade(rows.get(k) ?? emptyRow(), {
        side,
        direction: e.action as "BUY" | "SELL",
        token_amount: weiToEth(e.shares as string),
        eth_amount: weiToEth(e.amount_eth as string),
        ts: new Date(e.occurred_at as string),
      }),
    );
    events += 1;
  }
  console.log(`folded ${events} canonical trades into ${rows.size} wallet-market positions`);

  const recovered = new Map<string, "YES" | "NO">();
  for (const [k, row] of rows) {
    if (row.last_directional_side) recovered.set(k, row.last_directional_side);
  }
  console.log(`positions with a recoverable directional side: ${recovered.size}`);

  // ── Compare against what is stored ────────────────────────────────────────
  const toWrite: { wallet: string; onchain_id: number; side: "YES" | "NO" }[] = [];
  let alreadySet = 0;
  let agrees = 0;
  const conflicts: string[] = [];
  const missingRow: string[] = [];

  const keys = [...recovered.keys()];
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const wallets = [...new Set(chunk.map((k) => k.split("|")[0]))];
    const markets = [...new Set(chunk.map((k) => Number(k.split("|")[1])))];
    const { data, error } = await sb
      .from("wallet_beliefs")
      .select("wallet, onchain_id, last_directional_side")
      .in("wallet", wallets)
      .in("onchain_id", markets);
    if (error) throw new Error(`wallet_beliefs: ${error.message}`);
    const stored = new Map<string, string | null>();
    for (const r of (data ?? []) as {
      wallet: string;
      onchain_id: number;
      last_directional_side: string | null;
    }[]) {
      stored.set(
        `${String(r.wallet).toLowerCase()}|${Number(r.onchain_id)}`,
        r.last_directional_side,
      );
    }
    for (const k of chunk) {
      const want = recovered.get(k)!;
      if (!stored.has(k)) {
        missingRow.push(k);
        continue;
      }
      const have = stored.get(k);
      if (have == null) {
        toWrite.push({
          wallet: k.split("|")[0],
          onchain_id: Number(k.split("|")[1]),
          side: want,
        });
      } else if (have === want) {
        alreadySet += 1;
        agrees += 1;
      } else {
        // The row already remembers a DIFFERENT side than the tape produces.
        // Never overwritten — reported. Disagreement here means the stored
        // position and the canonical log have diverged, which is a rebuild
        // question, not a backfill one.
        alreadySet += 1;
        conflicts.push(`${k}: stored=${have} tape=${want}`);
      }
    }
  }

  console.log(`  already set and AGREEING with the tape: ${agrees}`);
  console.log(`  already set and DISAGREEING (never overwritten): ${conflicts.length}`);
  console.log(`  rows with no wallet_beliefs row at all: ${missingRow.length}`);
  console.log(`  to fill: ${toWrite.length}${LIMIT ? ` (capped at ${LIMIT})` : ""}`);
  if (conflicts.length) {
    console.log("\nCONFLICTS — inspect these, they indicate position drift, not a backfill gap:");
    for (const c of conflicts.slice(0, 20)) console.log(`  ${c}`);
    if (conflicts.length > 20) console.log(`  ... and ${conflicts.length - 20} more`);
  }

  if (!APPLY) {
    console.log("\nDry run complete. Nothing written.");
    return;
  }

  const batch = LIMIT > 0 ? toWrite.slice(0, LIMIT) : toWrite;
  let written = 0;
  for (const r of batch) {
    // Guarded by `is null` so a concurrent writer always wins over the backfill:
    // live reducer output is fresher than a replay by definition.
    const { error } = await sb
      .from("wallet_beliefs")
      .update({ last_directional_side: r.side })
      .eq("wallet", r.wallet)
      .eq("onchain_id", r.onchain_id)
      .is("last_directional_side", null);
    if (error) {
      console.error(`  failed ${r.wallet}|${r.onchain_id}: ${error.message}`);
      continue;
    }
    written += 1;
    if (written % 250 === 0) console.log(`  ...${written}/${batch.length}`);
  }
  console.log(`\nwrote ${written} remembered sides.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
