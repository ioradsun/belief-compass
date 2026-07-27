# Compatibility removal ledger (Phase 6.5)

Every retained compatibility / superseded-but-live path. Nothing compatibility is
kept off this list.

| Component | Why it still exists | Active readers | Active writers | Risk if removed now | Removal phase | Verification |
|---|---|---|---|---|---|---|
| **`trades` projection** | rollback + parity vs canonical events; belief-rollup market-selection reads it | `getIngestStatus` (diagnostic), belief-rollup market-selection | `ingest_chain_chunk` | lose the rollback/parity net before events are proven in prod | Phase 7+ (drop table) | `events_health()` parity green over time |
| **legacy `feed_events`** | historical non-trade rows; `getIngestStatus` shows the count | `getIngestStatus` count only | none | lose legacy history continuity | later cleanup | zero trade-driven readers/writers (confirmed) |
| **`feed.functions` + `conviction-feed` + `feed-copy`/`feed-gates`/`feed-price`/`feed-sequence`** | powers the **live** `ConvictionFeed` right-column; Phase 6 `rank-for-viewer` (its intended replacement) was **never built** | `ConvictionFeed.tsx` (rendered by `index.tsx`) | — | redesigns the right Live tape (a non-goal) | Phase 6 (build relevance) then Phase 7 | ConvictionFeed reads relevance module instead |
| **`market-vitals` + `conviction-feed` utils (`hueFor`/`initialsFor`/`aliasFor`/`avatarRef`)** | shared avatar/pulse helpers used by live `MarketCard` | `MarketCard.tsx`, `markets.functions.ts`, `profiles.server.ts` | — | breaks live market cards | Phase 7 (UI simplify) | cards render without them |
| **`market_volume_window` / `market_change_window` RPCs** | serve the window-picker (1h/24h/7d/all) that `market_state`'s fixed windows don't replicate | `getMarkets`, `getWallet` | — | lose arbitrary-window volume/price in the UI | Phase 7 (window UI decision) | window UI reads market_state or is retired |
| **`listMarketPulses`** | single BATCHED chronological trade strip for the grid (one query for all cards, not per-card) | `index.tsx` / `MyConvictions` | — | lose the live pulse strips | Phase 7 | replaced by `live_line` if strips retired |
| **full-refold repair (`rebuild-position` / `reconcile`)** | reorg / late-event / drift repair | position-rebuilder, position-reconcile jobs | — | lose the only correct repair path | never (repair tooling) | — |
| **`ensureConviction` (POV-sourced `wallet_beliefs` writer)** | instant on-connect positions from POV before the chain backfill reaches a wallet | connect path | writes `wallet_beliefs` | lose instant-connect UX | Phase 6/8 reconcile with incremental ownership | — |
| **`dna-matcher.ts` route + `dna-batch.server.ts`** | batch DNA recompute; **currently unscheduled** (no cron); `match-worker` is the active per-wallet path | — (unscheduled) | `wallet_matches` | Phase 8 may want the batch | Phase 8 (DNA scaling) | Phase 8 decision |

## Not compatibility — already deleted this phase
- `src/lib/feed-lenses.ts` (+ test) — the dead client lens/`scoreFeed()` engine, unreferenced after the Phase 5 center cutover.
- `src/lib/market-state/read.functions.ts` — an unused aspirational read module (live readers are `getMarkets`/`getMarket`).
