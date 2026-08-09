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

## Interpretation: The Insider

Everything above answers **what is true**. The **Insider** (`src/domain/insider`)
is the single owner of **what is interesting about what is true** — the
interpretation layer between canonical facts and every product surface. Its
constitutional rule (`INSIDER_CONSTITUTION`):

> No product surface calculates market intelligence. Facts are produced by
> canonical data systems (events, wallet_beliefs, market_state). The Insider
> interprets those facts. Product surfaces only filter, aggregate, personalize,
> and render Insider output.

| Concern | Canonical owner | Allowed producers | Allowed consumers | Prohibited | Status |
|---|---|---|---|---|---|
| **Insider signals / pulse / stories / read** | `src/domain/insider` | the Insider builder (reads `events` + `wallet_beliefs` + `market_state`) | product surfaces (activity/insight/now/read projections) | any card/route/component that scores momentum, significance, discovery, opportunity, or a viewer read on its own | contract landed; projections migrating (see `docs/insider-architecture.md`) |

The four projections (Insider Activity / Insight / Now / Read) are cache scopes,
not separate engines: `InsiderMarket` (per-market) and `InsiderNow` (global feed)
keep global facts cacheable and layer the viewer overlay on afterward. Full surface
inventory + migration plan: `docs/insider-architecture.md`.

## Live market readers
`getMarkets` (center candidates, ordered by `opportunity_score`) and `getMarket`
(detail) are the current live market readers. They read `market_state` +
`markets`; they do not recompute market-level facts.

## Enforcement
`npm run check:ownership` statically rejects: `scoreFeed()` calls, `feed-lenses`
imports, retired opportunity types in the engine, full-refold outside repair
modules, chronological `feed_events` reads, and non-diagnostic `trades` product
reads.

`npm run check:insider` enforces the interpretation boundary above. Alongside the
contract invariants it now runs a STATIC pass: nothing under `src/components` or
`src/routes` may import an intelligence primitive (`mixFeed`, `arrangeFeed`,
`tailState`, `pulseLabel`, `unusualness`, `dailyBaseline`, `relativeMove`,
`scoreFeed`) — each has a projection that owns it. Constants, types and attention
mechanics (`HEARTBEAT_MS`, `MixCandidate`, reveal paging) are not intelligence and
stay allowed, which is why `LiveTape` can keep its scheduler while owning no
judgement. The same gate asserts the three superseded modules deleted in
migration step 7 (`domain/conviction.ts`, `domain/side-feed.ts`,
`domain/what-connects-you.ts`) do not come back.

## Blockers (honest)
- **Phase 6 (personal relevance / `rank-for-viewer`) was never built** — this repo
  went Phase 5 → 6.5. So there is no relevance module to own final personalization,
  and the criteria about "client relevance scoring removed" are vacuously true
  (none exists). The old right-column ranking engine that used to be the honest
  exception here is **gone**: `ConvictionFeed.tsx`, `feed.functions.ts`,
  `conviction-feed.ts` and `feed-copy.ts` no longer exist, and the live tape now
  reads the Insider `now` projection. What remains unowned is the *concept* —
  personal relevance is applied as a viewer overlay inside the Insider rather than
  by a dedicated relevance module.

