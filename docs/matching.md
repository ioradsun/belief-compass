# Conviction DNA — viewer-centered matching (Phase 8)

Matching scales with a viewer's relevant neighborhood, not with the total number
of wallets squared. There is **no production job that compares every wallet with
every other wallet.** The old global O(W²) pass (`dna-batch.server.ts` /
`wallet_matches`) is deleted.

## The one path

```
viewer directional positions
  → wallets sharing those markets        (find_match_candidates RPC, bounded)
  → candidate evidence threshold          (prune < MIN_SHARED_OVERALL, cap MAX_CANDIDATES)
  → exact DNA over the bounded pool        (matchScore, set-based load — never 1 query/candidate)
  → bounded top Tribe / Rivals / closest   (buildViewerMatchOutput)
  → viewer_match_cache
```

One candidate generator (`find_match_candidates` SQL RPC →
`src/lib/matches/find-candidates.server.ts`), one exact scorer
(`matchScore` in `src/domain/domain.ts`), one cache writer
(`src/lib/matches/viewer-cache.server.ts`), one refresh path
(`match-worker` route draining `match_queue` via `computeViewerMatches`).

## Exact DNA formula (owner: `src/domain/domain.ts`)

`matchScore(a, b)` — unchanged from prior phases. Weighted directional agreement
× shared-evidence confidence:

- weight per shared market = `sqrt(convA · convB)`
- `raw` = Σ(weight · stanceA · stanceB) / Σ weight ∈ [−1, 1]
- `raw_score` = 50·(raw + 1) ∈ [0, 100]
- `confidence` = shared / (shared + 8)
- `match_score` = 50 + confidence·(raw_score − 50)

**Score interpretation:** 100 = strongest agreement, 50 = neutral, 0 = strongest
opposition. Performance in Phase 8 comes from scoring **fewer pairs**, never from
weakening this formula. Per-domain matching uses the same formula restricted to a
domain (`circleMatches`).

## Relationship semantics (`src/domain/match.ts`)

Neutral canonical types — product copy (Twin/Bizarro/Opp) stays in the UI:

| type | meaning |
|---|---|
| `tribe` | `match_score ≥ TRIBE_SCORE_THRESHOLD` with sufficient evidence |
| `rival` | `match_score ≤ RIVAL_SCORE_THRESHOLD` with sufficient evidence |
| `neutral` | enough evidence, no strong lean — **not cached** |
| `insufficient_evidence` | shared < minimum or confidence < minimum — **no claim** |

Ranking is confidence-adjusted (`agreementStrength = (match_score − 50)·confidence`)
so a 94% match over 60 markets can outrank a 98% match over 5.

## Thresholds (owner: `src/domain/match-config.ts`)

| key | value |
|---|---|
| `ENGINE_VERSION` | 1 |
| `MIN_SHARED_OVERALL` | 5 |
| `MIN_SHARED_DOMAIN` | 5 |
| `MIN_MATCH_CONFIDENCE` | 0.3 |
| `TRIBE_SCORE_THRESHOLD` | 60 |
| `RIVAL_SCORE_THRESHOLD` | 40 |
| `MAX_CANDIDATES` | 500 |
| `MAX_TRIBE_RESULTS` / `MAX_RIVAL_RESULTS` | 20 |
| `MAX_DOMAIN_RESULTS` | 10 |
| `CACHE_TTL_MS` | 1h |

## Candidate generation

`find_match_candidates(p_viewer, p_min_shared, p_max_candidates)` — one set-based
query over the **directional slice** of `wallet_beliefs` (partial indexes
`wb_dir_market_idx`, `wb_dir_wallet_idx`). It aggregates per candidate wallet:
shared markets, same/opposite side, `last_shared_activity_at`, and a
**distinctiveness-weighted evidence** sum `Σ sqrt(convV·convC)·(1/log2(2+pop))`
where `pop` is the market's directional participant count. Rarer shared beliefs
weigh more, so one ubiquitous popular market cannot make everyone look related.
Prunes below `p_min_shared`, orders by weighted evidence, caps at
`p_max_candidates`. Distinctiveness mirrors `marketDistinctiveness()` in
`src/domain/candidates.ts` (retrieval heuristic only — never the user-facing
score).

Run `EXPLAIN ANALYZE` on the RPC against production data as part of the deploy
(see below); the partial indexes keep it index-only over the YES/NO slice.

## Cache schema (`viewer_match_cache`)

One bounded row per viewer — never an all-pairs graph:

```
viewer_wallet            text primary key
viewer_position_version  bigint       -- match-relevant clock at compute time
match_engine_version     integer
closest_match            jsonb        -- MatchEntry | null
tribe_matches            jsonb        -- MatchEntry[]  (≤ MAX_TRIBE_RESULTS)
rival_matches            jsonb        -- MatchEntry[]  (≤ MAX_RIVAL_RESULTS)
domain_matches           jsonb        -- { [domain]: MatchEntry[] }
candidate_count          integer
scored_count             integer
calculated_at / expires_at / last_error
```

`MatchEntry = { wallet, score, confidence, sharedMarkets, agreements,
disagreements, relationship, scope }`.

## Invalidation — version-based, fan-out-free

`wallet_match_version(wallet, version)` is a **match-relevant** clock. The
`wallet_beliefs_match_version` trigger bumps it **only** when a wallet becomes
directional, stops being directional, or flips YES↔NO — never on price /
conviction drift / timestamp updates — and lazily expires **only that viewer's
own** cache.

A cache row is **fresh** iff `viewer_position_version` = current version **and**
`match_engine_version` = `MATCH.ENGINE_VERSION` **and** `now < expires_at`.

When wallet B changes a position we do **not** synchronously rebuild every viewer
who ever matched B. Other viewers' caches age out via TTL / their own next
request. The feed enqueues a bounded refresh (`request_viewer_match_refresh` RPC)
on a miss/stale; the `match-worker` drains `match_queue` (bounded batch, backoff,
`last_error`). No unbounded fan-out; active viewers are prioritized because they
are the ones who request.

## Engine versioning

Bump `MATCH.ENGINE_VERSION` when the formula, thresholds, candidate rules, or
domain mapping change materially. Every cache stamped with an older version reads
as stale and recomputes — outputs from different match definitions never mix.

## Consumers

- **Feed** (`markets.functions.ts listFeed`): reads `viewer_match_cache`
  (closest → Tribe[0] = "tribe", Rivals[0] = "opp"); on miss/stale enqueues a
  refresh and renders **globally without personalization**. The feed never
  computes DNA inline and never blocks on it.
- **Wallet page** (`/wallet/$addr`): `getViewerMatches` — computes on miss.
- **Connect** (`conviction-ingest`): enqueues `match_queue`, reports People from
  the cache.
- **Relevance** consumes the bounded Tribe/Rival wallet lists; it runs no new DNA
  scoring while ranking the feed.

## Domain map (one owner)

`categoryToDomain` in `src/domain/categories.ts` (`DOMAIN_MAP_VERSION`). Markets
carry a frozen POV `category`; unknown → null (no Circle). No matching job assigns
its own domains.

## Diagnostics

`npm run check:matches` (`scripts/check-matches.ts`):
`--viewer W` end-to-end trace · `--pair A B` exact score · `--domain D` ·
`--stale SECONDS`. Fails on: cached relationships below evidence gates, closest
below confidence, duplicate wallet across Tribe/Rival, non-canonical wallet,
candidate/scored cap exceeded, **`wallet_matches` still present**, or a cron job
still referencing `dna-matcher`.

## Deploy sequence (runtime steps — require a live database)

The code, schema, indexes, RPC, tests, and diagnostics ship in this change. The
following are **operational steps to run against the live DB** and are not
executable headless in CI:

1. Apply the migration (indexes, `viewer_match_cache`, version trigger, RPC,
   drop `wallet_matches`). Run `EXPLAIN ANALYZE` on `find_match_candidates` for a
   heavy viewer; confirm index-only scans.
2. **Shadow:** for a representative viewer set, compare the new bounded output to
   the pre-cutover results — inspect Tribe/Rival overlap, closest-match changes,
   and weak-confidence false positives. Exact parity with the old global batch is
   **not** required: the old graph included low-evidence and stale pairs the new
   gates reject.
3. **Backfill active viewers only** (recent `user_events` / active positions),
   most-active first, via `match_queue` + the worker. Historical wallets compute
   lazily. Report caches created / candidate counts / scored counts / failures.
4. Cut over (already wired here — the feed reads only `viewer_match_cache`), then
   observe cache hit rate, latency, candidate counts, and stale rates.

The global batch route is deleted and was never cron-scheduled, so there is no
schedule to remove; `check:matches` asserts none reappears.
