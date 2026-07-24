
# Conviction.company — full build plan (steps 1–6)

This is a large, multi-part backend build. Reading the spec, everything downstream (feed, People%, DNA) depends on `wallet_beliefs` being *correct*, which depends on `domain.ts` being *pure and tested*. So the plan is strictly bottom-up. Nothing renders until belief math and canonical ingest are proven.

## Phase 0 — Infra

1. Enable Lovable Cloud (Postgres, cron, secrets, server functions).
2. Ask you for `BASE_RPC_URL` (Alchemy/QuickNode) via secure secret form. Store `POV_API_BASE=https://core.pov.co/api` as a plain secret.
3. Set `INGEST_RUN_SECRET` (generated) — cron endpoints require it as a bearer to prevent public invocation, since jobs live at `/api/public/*`.

## Phase 1 — ABI pinning + decoder (fail-loud)

- `scripts/pin-abi.ts`: at build time, fetch verified ABI for `impl 0xeEc4…488a` from Blockscout, write `src/chain/abi.json` and `src/chain/abi.meta.json` (impl address, fetched-at, sha256).
- `src/chain/decoder.ts`: inspect ABI events; identify the buy/sell/trade event by shape (wallet address, market id, share/eth amounts, side derivable from belief-token address vs `token 0x9017…553D`). If no event matches the required shape, **throw at module load** — build fails. Export `decodeTradeLog(log) → CanonicalTrade | null`.
- `bun add viem` for RPC + log decoding.
- Tests: fixture logs → expected `CanonicalTrade` shape.

## Phase 2 — Schema + `domain.ts` (the contract)

Single migration creates all 9 tables verbatim from the spec (markets, trades, wallet_beliefs, market_state, price_snapshots, feed_events, wallet_matches, ingest_state, user_events) with the indexes listed. Grants: `authenticated` SELECT on public-read tables (markets, market_state, feed_events, wallet_beliefs, wallet_matches), `service_role` ALL on everything. RLS on with read-only policies for `authenticated`/`anon` on the public tables. Writes go through service_role in jobs.

`src/domain/domain.ts` — zero-dependency:

```ts
export const THRESHOLD = 0.10;
export const EPSILON = 1e-9;
export const SIZE_CAP = 1000;
export const PERSIST_CAP_DAYS = 90;

export type Side = 'YES' | 'NO' | 'MIXED' | 'INACTIVE';
export interface BeliefRow { yes_shares; no_shares; yes_cost; no_cost;
  expressed_side: Side; directional_since: Date|null;
  first_backed_at: Date|null; last_trade_at: Date|null; }
export interface Trade { side:'YES'|'NO'; direction:'BUY'|'SELL';
  token_amount:number; eth_amount:number; ts:Date; }
export interface Prices { yesPriceUsd:number; noPriceUsd:number; }
export interface EvaluatedView { stance:number; stance_side:Side;
  yes_value:number; no_value:number; position_value_usd:number;
  days_held:number; conviction:number; }

export function applyTrade(prior:BeliefRow, t:Trade): BeliefRow;   // trade-driven only, no prices
export function evaluate(row:BeliefRow, p:Prices, now:Date): EvaluatedView;  // price-driven, pure
export function matchScore(a:Array<{stance,conviction,side}>, b:...): {raw,score,confidence,agreements,disagreements,shared};
```

Cost basis: weighted-average remaining acquisition (buy → add; partial sell → scale down proportionally; full exit → 0).

Expressed side from **token shares**, not USD, per spec formula. Directional_since transitions per the table.

`REDUCER-TESTS.md` + `src/domain/domain.test.ts` — asserts three invariants:
- (a) price-only `evaluate` calls never mutate `expressed_side` / `directional_since`.
- (b) `reduce(all) === reduce(a)+reduce(b)` for any split.
- (c) idempotent replay of same ordered trades yields same row.
Plus: threshold behavior, cost-basis math, days_held transitions, match score edge cases (thin evidence shrinks toward 50, <5 shared returns "not enough").

Run via `bunx vitest run`.

## Phase 3 — Job A: POV poller (cron 10s)

- Server route `src/routes/api/public/jobs/pov-poller.ts` (bearer-guarded).
- Paginates `/markets` via top-level `nextCursor`. Upserts `markets` and `market_state` (money_yes_pct = POV yesPercentage, volume, boost, trending, prices). Appends `price_snapshots` row. Computes `chg_1h`/`chg_24h` from snapshots. Prunes snapshots >30d.
- Never touches `wallet_beliefs`.
- Cron: `select cron.schedule('pov-poll','*/10 * * * * *', $$ select net.http_post(url, headers, body) $$)`.

## Phase 4 — Job B: chain poller (cron 5s) + backfill

- Server route `src/routes/api/public/jobs/chain-poller.ts`.
- Lease claim: `update ingest_state set lease_owner=:run_id, lease_expires_at=now()+'2 min' where id=1 and (lease_expires_at is null or lease_expires_at<now() or lease_owner=:run_id) returning last_block`. No row → exit clean.
- Viem `createPublicClient(http(BASE_RPC_URL))`. `eth_getLogs` for proxy `0xd4f4…3eB` from `max(deploy, last_block-12)` to `blockNumber`, in ≤10k-block chunks on first run.
- After RPC completes, single txn:
  1. `select last_block, lease_owner from ingest_state where id=1 for update` — abort if lease changed.
  2. Delete stored trades in range whose `(tx_hash, log_index)` not in canonical set (reorg orphans).
  3. Upsert canonical trades (incl. block_hash, raw_log). Stub `markets` row if unknown `onchain_id`.
  4. For each touched `(wallet, onchain_id)`: fold **all** ordered canonical trades through `applyTrade`, upsert row.
  5. Delete trade-driven `feed_events` for rebuilt (wallet, market, range) then regenerate with keys `new-believer:<w>:<m>:<tx>:<log_index>` / `belief-switched:...` / `belief-exited:...`.
  6. `update ingest_state set last_block=:latest, lease_owner=null, lease_expires_at=null where id=1 and lease_owner=:run_id`.
  7. Commit.
- On failure: clear lease only if still owner.

## Phase 5 — Job C: rollup (cron 30s incremental + nightly full)

- `src/routes/api/public/jobs/belief-rollup.ts`.
- Incremental: touched markets = `select distinct onchain_id from trades where ts >= now()-'2 min'`. Every ~10 min, sweep all active markets to catch price drift. Nightly full: rebuild `wallet_beliefs` trade state from `trades` and recompute all `evaluate` outputs.
- For each affected `(wallet, onchain_id)`: read current POV prices from `market_state`, call `evaluate`, persist only `stance/stance_side/conviction/days_held/updated_at`. Compare prior stored `stance_side` to new one — a change here is **price-driven → no feed_event**.
- After per-row updates, `GROUP BY onchain_id` to refresh `market_state.believers_{yes,no,mixed}`, `people_yes_pct`, `divergence`, `new_believers_1h` (from feed_events count), `velocity_5m` (from trades count).
- Enable Supabase Realtime on `market_state` and `feed_events`.
- Denylist table for contract/router/treasury wallets excluded from believer counts.

## Phase 6 — Job M: on-demand match (server function)

- `src/lib/match.functions.ts`: `getMatchesForWallet({ wallet })`.
- Cache freshness: skip recompute if `calculated_at` within 1h AND wallet's `last_trade_at ≤ calculated_at`.
- Candidate gen: `wallet_beliefs` rows where the target wallet is directional → find other wallets directional in those same markets → for each candidate compute `matchScore` from spec formula → keep top N (50).
- Never surface below 5 shared directional markets — return `insufficient_evidence` state.

## Phase 7 — Minimal client

- `/` — feed reading `market_state` join `markets`, sorted by trending; shows Money% (POV) and People% (chain) as **separate columns**, MIXED count separate, "directional wallets" language.
- `/market/$id` — detail with believers breakdown, recent feed_events (Realtime subscribed).
- `/wallet/$addr` — positions + DNA matches (calls `getMatchesForWallet`).
- Client only reads Supabase (`@/integrations/supabase/client`) — never POV, never RPC. On reconnect refetch `market_state` + `feed_events` after last id, then resume realtime.
- Head metadata per route with unique titles/descriptions. Placeholder index replaced.
- `sitemap.xml` + `robots.txt` per template rules.

## Files

```text
src/chain/{abi.json, abi.meta.json, decoder.ts, client.ts}
src/domain/{domain.ts, domain.test.ts}
src/lib/{markets.functions.ts, wallets.functions.ts, match.functions.ts}
src/routes/api/public/jobs/{pov-poller.ts, chain-poller.ts, belief-rollup.ts}
src/routes/{index.tsx, market.$id.tsx, wallet.$addr.tsx, sitemap[.]xml.ts}
scripts/pin-abi.ts
supabase migrations: 001_schema.sql, 002_cron.sql, 003_denylist.sql
REDUCER-TESTS.md
```

## Ship gates (non-negotiable)

- ABI decoder throws if event not found — build fails.
- `domain.test.ts` passes all three invariants + threshold/cost/match cases.
- Job B: reorg re-scan is a no-op on unchanged canonical set; feed_events regenerate deterministically.
- Client never imports server-only modules; publishable key only.
- No `expressed_side` mutation in `evaluate`; no price read in `applyTrade` (enforced by types — `applyTrade` signature has no `Prices` param).

## Explicit non-goals (deferred with seams left)

- WS worker replacing Job B polling.
- ERC-20 Transfer indexing (positions labeled "trade-derived estimate" in UI).
- Rollups/retention beyond 30d snapshot prune.
- Identity layer — UI says "directional wallets," never "people."

## What I need from you before I start Phase 0

- Confirm plan.
- Be ready to paste `BASE_RPC_URL` when the secure secret form opens (right after Cloud enables).

After you approve, I'll enable Cloud, request the RPC secret, then execute Phases 1→7 in order without stopping for confirmation between them. Expect several long turns; I'll surface test output and any ABI-event ambiguity immediately.
