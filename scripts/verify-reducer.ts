/* eslint-disable @typescript-eslint/no-explicit-any -- parses untyped external JSON (POV API / viem logs) */
/**
 * verify-reducer — prove wallet_beliefs is the source of truth.
 *
 * For each wallet, reconstruct its conviction state from the wallet's OWN
 * on-chain trades (trade events are indexed by buyer/seller, so we can pull just
 * this wallet's history) folded through the PRODUCTION reducer (src/domain), and
 * diff it against POV's live /positions — the ground truth of what the wallet
 * actually holds right now.
 *
 * This intentionally does NOT read our Supabase copy: it verifies the reducer
 * LOGIC against reality, so a green run means the math is correct independent of
 * ingest. (Ingest gaps — an unindexed trade or a raw token transfer POV counts
 * but we don't — surface here as a shares mismatch, which is exactly what we
 * want to catch.)
 *
 * POV /positions exposes: side + current token balance + current value. It does
 * NOT expose cost basis, realized P&L, directional_since, or days_held — those
 * are reducer-internal with no POV oracle, so we COMPUTE and show them but never
 * claim they're "verified."
 *
 * Run:  npx tsx scripts/verify-reducer.ts <wallet> [<wallet> ...]
 *       BASE_RPC_URL=<paid rpc>  strongly recommended (public RPC is slow over
 *       the full range). --from-block=<n> narrows the scan for a quick smoke test.
 */
import { getBaseClient } from "../src/chain/client";
import { PROXY_ADDRESS, TRADE_EVENTS, decodeTradeLog } from "../src/chain/decoder";
import { applyTrade, evaluate, emptyRow, type Trade, type BeliefRow } from "../src/domain/domain";

const POV_BASE = process.env.POV_API_BASE || "https://core.pov.co/api";
const DEPLOY_BLOCK = BigInt(process.env.PROXY_DEPLOY_BLOCK ?? "45500000");
// Public Base RPC caps eth_getLogs at 10k blocks; a paid RPC allows far more —
// set VERIFY_CHUNK higher (and BASE_RPC_URL) for a fast full-range run.
const CHUNK = BigInt(process.env.VERIFY_CHUNK ?? "9000");
const SHARE_TOL = 1e-4; // relative tolerance on share balances (float vs wei)

const TokensBought = TRADE_EVENTS[0];
const TokensSold = TRADE_EVENTS[1];

interface PovPosition {
  onchainId: number;
  title: string;
  side: "YES" | "NO";
  shares: number;
  valueUsd: number;
}

async function povJson(path: string): Promise<any> {
  const res = await fetch(`${POV_BASE}/${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`POV ${path} → ${res.status}`);
  return res.json();
}

/** Map onchain market id → { uuid, title } across all POV markets. */
async function loadMarketMap(): Promise<Map<number, { uuid: string; title: string }>> {
  const byOnchain = new Map<number, { uuid: string; title: string }>();
  const byUuid = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = await povJson(`markets${cursor ? `?cursor=${cursor}` : ""}`);
    const rows = page.items ?? page.data ?? page.markets ?? [];
    for (const m of rows) {
      if (m.onChainMarketId != null && m.id) {
        byOnchain.set(Number(m.onChainMarketId), { uuid: m.id, title: m.title ?? "" });
        byUuid.set(m.id, Number(m.onChainMarketId));
      }
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  (byOnchain as any).__byUuid = byUuid;
  return byOnchain;
}

async function loadPovPositions(
  wallet: string,
  byUuid: Map<string, number>,
): Promise<Map<number, PovPosition>> {
  const out = new Map<number, PovPosition>();
  const seen = new Set<string>(); // marketId+side, to detect offset being ignored
  const PAGE = 50; // API caps limit at 50
  for (let offset = 0, pages = 0; pages < 40; offset += PAGE, pages++) {
    const page = await povJson(`users/${wallet}/positions?limit=${PAGE}&offset=${offset}`);
    const items = page.items ?? page.data ?? [];
    let added = 0;
    for (const it of items) {
      const key = `${it.marketId}:${it.side}`;
      if (seen.has(key)) continue;
      seen.add(key);
      added++;
      const onchainId = byUuid.get(it.marketId);
      if (onchainId == null) continue; // POV market we haven't mapped
      out.set(onchainId, {
        onchainId,
        title: it.marketTitle ?? "",
        side: String(it.side).toUpperCase() === "YES" ? "YES" : "NO",
        shares: Number(it.tokenBalance),
        valueUsd: Number(it.currentValueUsd),
      });
    }
    // Stop when the API says no more, a short page, or offset made no progress.
    if (page.hasMore !== true || items.length < PAGE || added === 0) break;
  }
  return out;
}

/** Pull this wallet's trades from chain, folded per market via the reducer. */
async function reduceWalletFromChain(
  wallet: string,
  head: bigint,
  fromBlock: bigint,
): Promise<Map<number, BeliefRow>> {
  const client = getBaseClient();
  const w = wallet.toLowerCase() as `0x${string}`;
  const raw: Array<{
    onchain_id: number;
    side: "YES" | "NO";
    direction: "BUY" | "SELL";
    token: number;
    eth: number;
    block: bigint;
    logIndex: number;
  }> = [];

  for (let start = fromBlock; start <= head; start += CHUNK) {
    const end = start + CHUNK - 1n > head ? head : start + CHUNK - 1n;
    const [bought, sold] = await Promise.all([
      client.getLogs({
        address: PROXY_ADDRESS,
        event: TokensBought,
        args: { buyer: w },
        fromBlock: start,
        toBlock: end,
      }),
      client.getLogs({
        address: PROXY_ADDRESS,
        event: TokensSold,
        args: { seller: w },
        fromBlock: start,
        toBlock: end,
      }),
    ]);
    for (const log of [...bought, ...sold]) {
      const t = decodeTradeLog(log as any);
      if (!t) continue;
      raw.push({
        onchain_id: Number(t.onchain_id),
        side: t.side,
        direction: t.direction,
        token: Number(t.token_amount) / 1e18,
        eth: Number(t.eth_amount) / 1e18,
        block: BigInt(t.block_number),
        logIndex: t.log_index,
      });
    }
  }

  // Timestamps for directional_since / days_held (unique blocks only).
  const blocks = [...new Set(raw.map((r) => r.block))];
  const tsByBlock = new Map<bigint, Date>();
  for (const b of blocks) {
    const blk = await client.getBlock({ blockNumber: b });
    tsByBlock.set(b, new Date(Number(blk.timestamp) * 1000));
  }

  // Deterministic order: block then logIndex, exactly as the poller folds.
  raw.sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));

  const byMarket = new Map<number, BeliefRow>();
  for (const r of raw) {
    const trade: Trade = {
      side: r.side,
      direction: r.direction,
      token_amount: r.token,
      eth_amount: r.eth,
      ts: tsByBlock.get(r.block)!,
    };
    byMarket.set(r.onchain_id, applyTrade(byMarket.get(r.onchain_id) ?? emptyRow(), trade));
  }
  return byMarket;
}

function fmtShares(n: number): string {
  return n.toFixed(4);
}
function nearlyEqual(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / scale <= SHARE_TOL;
}

async function verifyWallet(
  wallet: string,
  markets: Map<number, { uuid: string; title: string }>,
  head: bigint,
  fromBlock: bigint,
): Promise<{ matches: number; mismatches: number }> {
  const byUuid: Map<string, number> = (markets as any).__byUuid;
  const [pov, reduced] = await Promise.all([
    loadPovPositions(wallet, byUuid),
    reduceWalletFromChain(wallet, head, fromBlock),
  ]);

  const now = new Date();
  const ids = new Set<number>([...pov.keys()]);
  for (const [id, row] of reduced) if (row.yes_shares > 1e-9 || row.no_shares > 1e-9) ids.add(id);

  let matches = 0;
  let mismatches = 0;
  console.log(`\n${"═".repeat(70)}\nWallet  ${wallet}\n${"═".repeat(70)}`);

  for (const id of [...ids].sort((a, b) => a - b)) {
    const title = markets.get(id)?.title || pov.get(id)?.title || `market #${id}`;
    const p = pov.get(id);
    const row = reduced.get(id);
    const ev = row ? evaluate(row, { yesPriceUsd: 0, noPriceUsd: 0 }, now) : null;

    // Reducer's net side + shares on that side.
    const rSide = row ? (row.yes_shares >= row.no_shares ? "YES" : "NO") : null;
    const rShares = row ? (rSide === "YES" ? row.yes_shares : row.no_shares) : 0;
    const rMixed = row ? row.expressed_side === "MIXED" : false;

    const sideOk = p && rSide && p.side === rSide && !rMixed;
    const sharesOk = p && row ? nearlyEqual(rShares, p.shares) : false;
    const ok = Boolean(sideOk && sharesOk);
    if (ok) matches++;
    else mismatches++;

    console.log(`\nMarket  "${title}"`);
    console.log(
      `  POV      ${p ? `${p.side} ${fmtShares(p.shares)} sh · $${p.valueUsd.toFixed(2)}` : "— (no position)"}`,
    );
    console.log(
      `  Reducer  ${row ? `${rMixed ? "MIXED" : rSide} ${fmtShares(rShares)} sh${rMixed ? ` (YES ${fmtShares(row.yes_shares)} / NO ${fmtShares(row.no_shares)})` : ""}` : "— (no trades indexed)"}`,
    );
    if (ok) {
      console.log(`  ✅ MATCH`);
    } else {
      if (!p)
        console.log(`  ❌ reducer holds a position POV does not (sold off-book, or over-count)`);
      else if (!row)
        console.log(`  ❌ POV holds a position we have no trades for (missing ingest / transfer)`);
      else {
        if (!sideOk)
          console.log(`  ❌ side mismatch — POV ${p.side} vs reducer ${rMixed ? "MIXED" : rSide}`);
        if (!sharesOk)
          console.log(
            `  ❌ shares mismatch — POV ${fmtShares(p.shares)} vs reducer ${fmtShares(rShares)}`,
          );
      }
    }
    // Reducer-internal fields (no POV oracle) — shown for trust, not verified.
    if (row && ev) {
      console.log(
        `  ~ reducer-only: directional_since=${row.directional_since?.toISOString().slice(0, 10) ?? "—"} · days_held=${ev.days_held.toFixed(1)} · cost_basis=${(rSide === "YES" ? row.yes_cost : row.no_cost).toFixed(4)} ETH (no POV oracle)`,
      );
    }
  }

  console.log(`\n  ${matches} match · ${mismatches} mismatch`);
  return { matches, mismatches };
}

async function main() {
  const args = process.argv.slice(2);
  const fromArg = args.find((a) => a.startsWith("--from-block="));
  const fromBlock = fromArg ? BigInt(fromArg.split("=")[1]) : DEPLOY_BLOCK;
  const wallets = args.filter((a) => a.startsWith("0x"));
  if (wallets.length === 0) {
    console.error(
      "usage: npx tsx scripts/verify-reducer.ts <wallet> [<wallet> ...] [--from-block=N]",
    );
    process.exit(1);
  }

  console.log(`Loading POV market map…`);
  const markets = await loadMarketMap();
  console.log(`Mapped ${markets.size} markets. Reading chain from block ${fromBlock}…`);
  const client = getBaseClient();
  const head = await client.getBlockNumber();

  let matches = 0;
  let mismatches = 0;
  for (const w of wallets) {
    const r = await verifyWallet(w, markets, head, fromBlock);
    matches += r.matches;
    mismatches += r.mismatches;
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(
    `TOTAL  ${matches} match · ${mismatches} mismatch across ${wallets.length} wallet(s)`,
  );
  console.log(`${"═".repeat(70)}`);
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
