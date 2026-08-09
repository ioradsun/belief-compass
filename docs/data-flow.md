# Data flow (post Phase 2.5)

Implementation-specific note on how a chain trade becomes position state, and the
rules that keep exactly one active path. Phase 3 (incremental position updates)
depends on these invariants.

## Invariants

| Concept | Definition |
|---|---|
| **`events`** | Canonical immutable history. The source of truth for "what happened". |
| **`trades`** | Temporary compatibility projection, maintained **only** from canonical trade events. Not authoritative. No new feature reads it. |
| **`feed_events`** | Legacy non-trade history only. **Never** authoritative for chain trades. No new trade rows are written. |
| **`wallet_beliefs`** | Current derived position/belief state. |
| **event query module** (`src/lib/events.functions.ts`) | The only application-level entry point for chronological activity reads. |

## The one permitted chain-trade path

```
Base log
  → decoded (src/chain/decoder.ts)
  → canonical event                     (events, via ingest_chain_chunk)
  → temporary trade projection          (trades, via ingest_chain_chunk — same txn)
  → existing position/belief calc       (wallet_beliefs: poller re-fold + belief-rollup)
```

There is no alternate writer, duplicate activity path, or component query that can
bypass this sequence.

- **Single chain-write entry point:** `public.ingest_chain_chunk()` (Postgres,
  `SECURITY DEFINER`). In one transaction it (1) inserts/reconciles canonical
  events, (2) reconciles reorg orphans, (3) maintains the `trades` projection
  (stamping `event_source_key` provenance), (4) returns affected `(wallet, market)`
  pairs, (5) reports durable counts. Only the chain-poller calls it.
- **Projection is locked:** `trades` grants no write to `anon`/`authenticated`,
  RLS has no write policy, and a guard trigger rejects direct writes from the
  public API roles. Only the canonical ingest (definer) and service-role
  maintenance may write it.
- **Provenance:** every `trades` row carries `event_source_key`
  (`chain:{chain_id}:{tx_hash}:{log_index}`), unique, resolving 1:1 to its event.
- **Recency uses `occurred_at` only.** No reader falls back to `ingested_at` /
  `created_at`. `EVENT_READ_COLUMNS` (src/lib/events.ts) omits those columns.

## Active writers (after Phase 2.5)

| File | Function | Table | Reason | Allowed after this phase? |
|---|---|---|---|---|
| `ingest_chain_chunk()` (SQL) | canonical ingest | `events`, `trades` | the single chain-write entry point | ✅ yes — the only chain trade writer |
| `chain-poller.ts` | poller | `markets` (stub), `wallet_beliefs`, `ingest_state` | market stubs; belief re-fold from projection; cursor/lease | ✅ yes |
| `belief-rollup.ts` | rollup | `wallet_beliefs`, `market_state` | normal position/belief derivation | ✅ yes |
| `pov-poller.ts` | POV poller | `markets`, `market_state`, `price_snapshots`, `profiles`, `events` (market_created) | market metadata + one deterministic market_created event | ✅ yes |
| `conviction-ingest.functions.ts` | `ensureConviction` | `wallet_beliefs`, `match_queue`, `profiles` | on-connect **POV-sourced** positions (not chain) | ⚠️ retained, documented — **Phase 3 must reconcile** this non-chain position writer |
| `match.functions.ts`, `dna-batch.server.ts`, `circles.functions.ts` | matching | `wallet_matches` | DNA/match cache (not positions/history) | ✅ yes |
| `match-worker.ts` | worker | `match_queue` | background match queue | ✅ yes |
| `wallet-link.functions.ts` | link | `wallet_links` | wallet linking | ✅ yes |
| `profiles.server.ts` | profiles | `profiles` | POV profile cache | ✅ yes |
| `backfill-block-times.ts` | repair | `trades.occurred_at` | documented historical block-time backfill (service role) | ✅ yes — documented repair |
| `backfill-events.ts` | backfill | `events` | historical projection of trades/feed_events → events | ✅ yes — documented backfill |

**No code writes trade-driven `feed_events`.** The chain poller's write was removed
in Phase 2; the block-time backfill's propagation was removed in Phase 2.5.

## Readers

- **Chronological activity (product):** only via `events.functions.ts`
  (`listLatestEvents`, `listMarketEvents`, `listWalletEvents`,
  `readLatestTradeEvents`). Consumers today: `markets.functions.ts`
  (`listMarketPulses`, `getMarket`) and `belief-rollup.ts` (new-believers window);
  the Insider's tape source (`lib/insider/source.server.ts`) reads through the same
  module. The old `feed.functions.ts` / `conviction-feed.ts` spine is deleted — the
  feed is now the Insider `now` projection over these same canonical reads. Legacy
  DTO preserved via `toLegacyFeedEventRow`.

- **`trades` readers (compatibility/diagnostic only):** `chain-poller` re-fold,
  `belief-rollup` (velocity + market selection), `getIngestStatus` (diagnostic
  counts), backfill/diagnostic scripts. No product feature reads `trades`.
- **`feed_events` readers:** `getIngestStatus` (a diagnostic count only) and
  `backfill-events.ts` (classification). No chronological product read remains.

## Scheduled jobs

| Job | Schedule | Reads | Writes | Required? | Duplicate? |
|---|---|---|---|---|---|
| `conviction-pov-poller` | */2 min | POV API | markets, market_state, events(market_created) | yes | no |
| `conviction-chain-poller` | */1 min | Base logs | events, trades, wallet_beliefs | yes | no |
| `conviction-belief-rollup-incremental` | */1 min | trades, events, market_state | wallet_beliefs, market_state | yes | no |
| `conviction-belief-rollup-sweep` | */15 min | (full) | wallet_beliefs, market_state | yes | no |
| `match-worker-preview` | */1 min | match_queue, wallet_beliefs | wallet_matches, match_queue | yes | no |
| `*-preview` variants | as above | — | — | env-specific | dev-host mirrors, not purpose-duplicates |

No job duplicates trade activity into `feed_events` or rebuilds activity from
duplicate facts, so **no obsolete job is unscheduled in this phase**. The
`-preview` crons target the dev host and are made safe by the poller's lease;
they are a deployment concern, not a duplicate-activity concern.

## Diagnostics

- `npm run check:data-flow` (`scripts/check-data-flow.ts`) — fails nonzero on a
  broken invariant (missing/orphan projection, mismatched `occurred_at`, missing
  provenance, or any new trade-driven `feed_events`).
- `events_health()` / `scripts/events-parity.sql` — parity snapshot.

## Phase 3 — incremental position state

`wallet_beliefs` is now the **single canonical current position state** (no second
positions table). A new canonical trade updates exactly ONE pair, incrementally,
exactly once:

```
canonical trade event
  → load current wallet-market position (once)
  → apply ONLY the new event (domain applyTrade)
  → evaluate (domain evaluate) with current prices
  → atomically advance cursor + version (apply_position_events RPC)
```

**Field ownership**
- Incremental applier (`src/lib/positions/apply-events.server.ts`, driven by the
  chain poller) owns trade-driven fields: `yes/no_shares`, `yes/no_cost`,
  `expressed_side`, `directional_since`, `first_backed_at`, `last_trade_at`, and
  the cursor/version/`state_hash`/`applied_trade_count`.
- Evaluator (`belief-rollup`, price-change re-eval) owns `stance`, `stance_side`,
  `conviction`, `days_held`, `last_evaluated_at`. It never refolds trade history.
- Targeted rebuilder (`rebuild-position.server.ts`) owns repair — folds full
  canonical history from `events` (never `trades`).

**Exactly-once & safety**
- Identity + canonical order (`block_number ASC, log_index ASC`) decide every
  action; timestamps never do. Overlap replays are no-ops (cursor guard).
- Late/out-of-order/restored events and reorg orphans mark the pair
  `needs_rebuild` (reasons `late_or_out_of_order_event` / `reorg` / `version_conflict`
  / `cursor_backfill_mismatch`); a dirty pair accepts no incremental events until
  rebuilt. Reorgs are never reversed algebraically — the pair is refolded.
- Concurrency: `apply_position_events` locks the row + validates
  `position_version`; conflicts retry on fresh state, then mark dirty.
- `full_history_reads_hot_path` metric MUST stay 0 (asserted in the poller output).

**New RPCs:** `apply_position_events`, `rebuild_position`, `mark_positions_dirty`
(reducer math stays in TS; these only lock/validate/persist).

**New jobs:** `position-rebuilder` (dirty rebuild + inserted-but-unapplied
recovery, every 2m), `position-reconcile` (nightly rolling drift repair). The
obsolete full-refold was inline in the poller — removed, not a cron — so nothing
was unscheduled.

**Diagnostics:** `npm run check:positions`, `npm run backfill:position-cursors`.

## Phase 4 — one global market read model

`market_state` is the single canonical global read model for current market facts
(activity, participation, movement, live summary). One row per market, not
viewer-specific. `markets` stays stable metadata + authoritative POV display.

- **Ownership:** activity → canonical `events`; participation → `wallet_beliefs`;
  display/price → POV. Every metric has one definition (`docs/market-state-metrics.md`).
- **Transitions:** `events` gains `source='system'` position-transition kinds
  (`position_became_directional` etc.), emitted by the applier at the triggering
  trade's `occurred_at` — the durable basis for new-believers / side-flips.
- **Update path (dirty queue, coalesced):** `market_refresh_queue` enqueued by the
  chain poller (`activity`+`positions`), POV poller (`pov`), rebuilder
  (`positions`); drained by `market-refresher` via `claim_market_refresh`
  (SKIP LOCKED). `refresh-market.server.ts` recomputes one coherent row from the
  aggregation RPCs + the pure read-model formulas + the factual live line, bumps
  `read_model_version`, sets freshness. No per-trade queue rows; no broad sweeps.
- **Reads:** `getMarketReadModel` / `listMarketReadModels` (`read.functions.ts`)
  join `markets ⋈ market_state`. Owned positions receive the global `live_line`
  through the existing set-based `market_state` join (no per-position query).
  Chronological event lists stay on `events`.
- **Diagnostics:** `npm run check:market-state`.
- **Staged (deploy steps 6–7):** removing the duplicate window/price RPCs from the
  center loader waits until the refresher has warmed `market_state` in prod, so
  metrics never read empty pre-warm — matching the phase's own shadow→cutover order.

## Known items (still) for later phases

- `ensureConviction` writes `wallet_beliefs` from POV positions (a non-chain
  source). Phase 3's incremental event application must reconcile with it.
- `dna-matcher.ts` route has no cron registration in-repo — verify it is dead
  before any deletion (left in place this phase).
