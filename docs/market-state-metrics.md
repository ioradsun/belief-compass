# Market read model — metric contract (Phase 4)

`market_state` is the **single canonical global market read model**. One row per
market, not viewer-specific. `markets` holds stable metadata + authoritative POV
display fields. No `market_cards` table. Every metric below has ONE definition and
ONE source. Recency uses canonical `occurred_at`, never ingestion time.

## Source ownership

| Source | Authoritative for |
|---|---|
| **POV** (`markets` + POV display cols on `market_state`) | title, category, author, agent opinions, `yes_price_usd`, `no_price_usd`, `money_yes_pct`, reported volume, `yes/no_capital_usd`, `boost_score`, `trending_score`, `created_at`. Never recomputed from chain. |
| **Canonical events** (`events`, `kind='trade'`, `is_canonical`) | trade/buy/sell counts, volume windows, unique active wallets, first/last trade time. By `occurred_at`. |
| **Canonical positions** (`wallet_beliefs`) | believers YES/NO/MIXED, directional believers, people%, held capital (cost basis), tenure + conviction aggregates. |
| **Position-transition events** (`events`, `source='system'`) | new believers, side flips, last position change. |

## Metric definitions (selected — full list in the migration)

| Field | Definition | Source | Window | Null behavior |
|---|---|---|---|---|
| `believers_yes/no/mixed` | count of positions whose **evaluated economic** `stance_side` = that side; denylisted wallets excluded | positions | current | 0 |
| `directional_believers` | `believers_yes + believers_no` (MIXED/INACTIVE excluded) | positions | current | 0 |
| `people_yes_pct` | `believers_yes / (believers_yes + believers_no) × 100` | positions | current | NULL when no directional believers |
| `divergence` | `people_yes_pct − money_yes_pct`, **percentage points** | positions + POV | current | NULL if either input NULL |
| `trade_count_{1h,24h,7d}` | canonical trade events in window | events | by occurred_at | 0 |
| `volume_eth_{1h,24h,7d}` | Σ `amount_eth/1e18` of canonical trades in window | events | by occurred_at | 0 |
| `unique_wallets_{1h,24h,7d}` | **exact** distinct wallets (not summed hourly) | events | by occurred_at | 0 |
| `new_believers_{1h,24h,7d}` | count of `position_became_directional` transitions in window | transitions | by occurred_at | 0 |
| `side_flips_24h` | count of `position_changed_side` transitions in 24h | transitions | 24h | 0 |
| `sell_rate_24h` | `sell_count_24h / max(buy_count_24h + sell_count_24h, 1)` (trade-count share) | events | 24h | 0 |
| `buy_sell_ratio_24h` | `buy_count_24h / max(sell_count_24h, 1)` | events | 24h | — |
| `circulation_{1h,24h,7d}` | canonical trade volume (USD) in window ÷ `max(total POV market capital USD, ε)` | events + POV | by occurred_at | NULL when capital ≤ ε (never Infinity/0) |
| `side_balance` | `(believers_yes − believers_no) / max(directional, 1)`, −1..1 | positions | current | NULL when no directional |
| `capital_held_{yes,no,total}` | Σ cost-basis (`yes_cost`/`no_cost`) held — **distinct** from `yes/no_capital_usd` (POV market cap) | positions | current | 0 |
| `yes_price_change_{1h,24h}` | reused from the existing snapshot-based `chg_*` figures | POV snapshots | window | NULL when no prior observation (never 0) |
| `market_age_days` | `(now − created_at)/86400` | POV | — | NULL if no created_at |
| `inactive_for_seconds` | `(now − last_trade_at)` | events | — | NULL if never traded |
| `avg/median/p75_directional_days` | tenure of directional positions from `directional_since` | positions | current | NULL if none |
| `avg/median_conviction_strength` | conviction evidence over directional positions (NOT a classification) | positions | current | NULL if none |

### Believer
A wallet counts as a believer only when its **evaluated economic** side is
directional YES or NO. MIXED and INACTIVE never count.

### New believer
A wallet is newly directional in a window only when its position transitions
`INACTIVE|MIXED → YES|NO` during that window (a `position_became_directional`
event). Repeated same-side buys do **not** re-count. A YES→NO flip is **not** a new
believer (it's a `side_flips_24h`). Never inferred from raw trade counts.

## Transition-event taxonomy (`source='system'`)
`position_became_directional` · `position_changed_side` · `position_became_mixed`
· `position_became_inactive`. Deterministic key
`system:position:{wallet}:{market_id}:v{position_version}:{kind}`, structured
payload `{previous_side, new_side, trigger_event_id, position_version}`, timed at
the **triggering trade's** canonical `occurred_at`. Derived facts, not duplicate
trades. Price-driven side changes are reflected in current believer *counts* but
are **not** fabricated into narrow recency windows (no reliable price-change
occurrence time yet — deferred to Phase 5 buckets).

## Live line (`live_line*`)
One deterministic, globally factual current statement selected from canonical
metrics + structured evidence, on the evidence ladder **1h → 24h → 7d → all-time
milestone**. Priority: meaningful change → breadth → magnitude → recency → novelty.
`live_line_window` always records which window was used; `live_line_payload` stores
the structured evidence (so copy can change without recomputing the fact). It never
ranks markets, claims an opportunity type, mentions a viewer, uses false urgency,
or uses ingestion time. Returns nothing when unsupported by evidence.

## Update strategy (dirty-market queue, coalesced)
`market_refresh_queue` (one row per market; repeated changes OR the dirty flags
and keep the earliest `requested_at`). Enqueued by: chain poller (`activity` +
`positions`), POV poller (`pov`), position rebuilder (`positions`). Drained by the
`market-refresher` worker via `claim_market_refresh` (SKIP LOCKED, so two workers
never refresh the same market). Never one queue row per trade. No broad every-minute
all-market sweep — only dirty markets refresh.

## Reorg
A reorg orphans events + rebuilds positions (Phase 3) and marks affected markets
dirty; the refresher recomputes from **canonical** sources (orphaned events
excluded, rebuilt positions used) and bumps `read_model_version`. No per-field
algebraic subtraction — targeted recomputation only.

## Freshness
`pov_updated_at`, `events_updated_at`, `positions_updated_at`, `calculated_at`,
`read_model_version` are stored on every row. A stale source keeps the last known
factual value; a live line is not generated from unavailable fresh evidence; a
healthy row is never wiped because one source failed.

## Scale note
Unique wallets use exact `count(distinct)` at current scale (never summed hourly
buckets). Hourly aggregate buckets (`market_hourly`) are **not** created
preemptively — introduce only if measured latency requires, derived from canonical
events and rebuildable.
