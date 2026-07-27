# Data ownership (Phase 6.5)

One responsibility → one active owner → one production path. For code review.

| Store / concern | Canonical owner | Allowed writers | Allowed readers | Prohibited | Status |
|---|---|---|---|---|---|
| **events** | canonical history | `ingest_chain_chunk` (chain), pov-poller (`market_created`), applier (position-transition), `backfill-events` | `events.functions.ts` (product chronology), positions apply/rebuild/reconcile, market-state aggregation RPCs, belief-rollup (velocity/new-believers) | representing the same trade as a second activity fact anywhere else | permanent |
| **wallet_beliefs** | current position + evaluated belief | `apply_position_events` / `rebuild_position` (via applier + rebuilder), belief-rollup (evaluated fields only), `ensureConviction` (POV-sourced, ⚠ see ledger) | position modules, market-state aggregation, feed/markets reads | any other path reconstructing + persisting position state | permanent |
| **market_state** | global market facts + opportunity | `refresh-market.server.ts` (the only writer of read-model + opportunity fields), pov-poller (POV display cols only) | `getMarkets`/`getMarket` (live), `belief-rollup` (counts) | any card/route/component rebuilding these facts or scoring opportunity | permanent |
| **rank-for-viewer** | personal ordering | — | — | client reranking | **not built** (Phase 6 skipped — see blockers) |
| **event chronology** | `events.functions.ts` | — | product routes | reading `feed_events` for live activity | permanent |
| **user_events** | viewer behavior only | client insert | service | feeding DNA / positions | permanent |
| **trades** | temporary compatibility projection | `ingest_chain_chunk` only | rollback/parity/diagnostics/backfill only | any product read | temporary (ledger) |
| **feed_events** | legacy only | none | `getIngestStatus` count (diagnostic) | any trade write / chronological product read | temporary (ledger) |

## Live market readers
`getMarkets` (center candidates, ordered by `opportunity_score`) and `getMarket`
(detail) are the current live market readers. They read `market_state` +
`markets`; they do not recompute market-level facts.

## Enforcement
`npm run check:ownership` statically rejects: `scoreFeed()` calls, `feed-lenses`
imports, retired opportunity types in the engine, full-refold outside repair
modules, chronological `feed_events` reads, and non-diagnostic `trades` product
reads.

## Blockers (honest)
- **Phase 6 (personal relevance / `rank-for-viewer`) was never built** — this repo
  went Phase 5 → 6.5. So there is no relevance module to own final personalization,
  and the criteria about "client relevance scoring removed" are vacuously true
  (none exists). The legacy `ConvictionFeed` right-column still uses the old
  `feed.functions`/`conviction-feed` ranking engine and is **live UI**; removing it
  would redesign the right Live tape (a non-goal) and needs the Phase-6 replacement
  first. Listed on the removal ledger.
